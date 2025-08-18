// backend/src/routes/github.js
import express from 'express';
import axios from 'axios';

import User from '../models/user.js';
import { decrypt } from '../utils/crypto.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: GitHub
 *   description: GitHub organization, workflow and run inspection APIs
 */

/**
 * maybeAuth:
 *  - If a session exists, populate req.userId (same as requireAuth would provide)
 *  - If no session, do NOT block the request (so .env token fallback still works)
 */
function maybeAuth(req, _res, next) {
  try {
    if (req.user?._id) {
      req.userId = req.user._id;
    } else if (req.session?.passport?.user) {
      req.userId = req.session.passport.user;
    }
  } catch (_) {}
  return next();
}

/**
 * Resolve a GitHub token in this order:
 *  1) User-specific PAT stored in DB (encrypted)
 *  2) x-github-token header (useful for Swagger/manual tests)
 *  3) GITHUB_PAT environment variable (global fallback)
 */
// --- replace ONLY this function ---
async function ensureGitHubToken(req, res, next) {
  try {
    let token = null;
    let source = 'none';

    // 1) User PAT from DB (if authenticated)
    if (req.userId) {
      try {
        const u = await User.findById(req.userId).lean();
        const pat = decrypt(u?.github?.patEnc || '');
        if (pat) {
          token = pat;
          source = 'db';
        }
      } catch (e) {
        // don’t block, just log
        console.warn('ensureGitHubToken: DB lookup failed:', e.message);
      }
    }

    // 2) Header (optional) — useful in Swagger/manual tests
    if (!token) {
      const tokenFromHeader = req.headers['x-github-token'];
      if (tokenFromHeader) {
        token = tokenFromHeader;
        source = 'header';
      }
    }

    // 3) Env fallback
    if (!token && process.env.GITHUB_PAT) {
      token = process.env.GITHUB_PAT;
      source = 'env';
    }

    if (!token) {
      console.warn('ensureGitHubToken: no token found (db/header/env)');
      return res.status(401).json({ error: 'Missing token' });
    }

    // Lightweight self-test to avoid hard-to-debug "bad credentials" later
    try {
      const who = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `token ${token}`, // for classic PATs
          Accept: 'application/vnd.github+json',
        },
      });
      // ok
      req.githubToken = token;
      req.githubTokenSource = source;
      return next();
    } catch (e) {
      const msg = e.response?.data?.message || e.message || 'Bad credentials';
      console.warn(`ensureGitHubToken: token check failed via ${source}: ${msg}`);
      return res.status(401).json({ error: 'Bad credentials' });
    }
  } catch (e) {
    next(e);
  }
}

/** Helper: fetch latest run for a workflow */
async function fetchLatestRun(owner, repo, workflowId, token) {
  const runsRes = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?per_page=1`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
      },
    }
  );
  const run = runsRes.data?.workflow_runs?.[0];
  if (!run) return null;
  return {
    runId: run.id,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    head_branch: run.head_branch,
    created_at: run.created_at,
    updated_at: run.updated_at,
    url: run.html_url,
    actor: run.actor?.login,
  };
}

/**
 * @swagger
 * /github/organizations:
 *   get:
 *     summary: Get organizations for the authenticated GitHub user
 *     description: |
 *       Returns orgs visible to the resolved token.
 *       Token order: user PAT (DB) -> x-github-token header -> GITHUB_PAT env.
 *     tags: [GitHub]
 *     parameters:
 *       - in: header
 *         name: x-github-token
 *         schema: { type: string }
 *         required: false
 *     responses:
 *       200: { description: Array of org logins }
 *       401: { description: Missing or invalid token }
 */
router.get('/organizations', maybeAuth, ensureGitHubToken, async (req, res) => {
  try {
    const { data } = await axios.get('https://api.github.com/user/orgs', {
      headers: {
        Authorization: `token ${req.githubToken}`,
        Accept: 'application/vnd.github+json',
      },
    });
    res.json(data.map((o) => o.login));
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

/**
 * @swagger
 * /github/pipelines:
 *   get:
 *     summary: Get workflows (pipelines) for all repos in an organization
 *     tags: [GitHub]
 *     parameters:
 *       - in: query
 *         name: org
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: includeRuns
 *         schema: { type: boolean, default: true }
 *       - in: header
 *         name: x-github-token
 *         schema: { type: string }
 *         required: false
 *     responses:
 *       200: { description: List of workflows with latest run (optional) }
 *       400: { description: Missing org }
 *       401: { description: Unauthorized }
 */
router.get('/pipelines', maybeAuth, ensureGitHubToken, async (req, res) => {
  const org = req.query.org;
  const includeRuns = String(req.query.includeRuns ?? 'true').toLowerCase() !== 'false';

  if (!org) return res.status(400).json({ error: 'Organization name is required' });

  try {
    // org repos -> fallback to user repos
    let reposRes;
    try {
      reposRes = await axios.get(
        `https://api.github.com/orgs/${org}/repos?type=all&per_page=100`,
        {
          headers: {
            Authorization: `token ${req.githubToken}`,
            Accept: 'application/vnd.github+json',
          },
        }
      );
    } catch (e) {
      if (e.response?.status === 404) {
        reposRes = await axios.get(
          `https://api.github.com/users/${org}/repos?per_page=100`,
          {
            headers: {
              Authorization: `token ${req.githubToken}`,
              Accept: 'application/vnd.github+json',
            },
          }
        );
      } else {
        throw e;
      }
    }

    const pipelines = [];

    for (const repo of reposRes.data) {
      const owner = repo.owner?.login || org;

      try {
        const wfRes = await axios.get(
          `https://api.github.com/repos/${owner}/${repo.name}/actions/workflows?per_page=100`,
          {
            headers: {
              Authorization: `token ${req.githubToken}`,
              Accept: 'application/vnd.github+json',
            },
          }
        );

        if (wfRes.data?.workflows?.length) {
          for (const wf of wfRes.data.workflows) {
            const latest_run = includeRuns
              ? await fetchLatestRun(owner, repo.name, wf.id, req.githubToken)
              : null;

            pipelines.push({
              owner,
              repo: repo.name,
              workflowId: wf.id,
              name: wf.name,
              path: wf.path,
              state: wf.state,
              created_at: wf.created_at,
              updated_at: wf.updated_at,
              url: wf.html_url,
              latest_run,
            });
          }
        }
      } catch (e) {
        if ([403, 404, 409].includes(e.response?.status)) continue;
        throw e;
      }
    }

    res.json(pipelines);
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

/**
 * @swagger
 * /github/run-jobs:
 *   get:
 *     summary: Get all jobs (and steps) for a specific workflow run
 *     tags: [GitHub]
 *     parameters:
 *       - in: query
 *         name: owner
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: repo
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: runId
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: run_id
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: id
 *         required: false
 *         schema: { type: string }
 *     responses:
 *       200: { description: Jobs with steps }
 *       400: { description: Missing params }
 */
router.get('/run-jobs', maybeAuth, ensureGitHubToken, async (req, res) => {
  const owner = req.query.owner;
  const repo = req.query.repo;
  const runId = req.query.runId || req.query.run_id || req.query.id;

  if (!owner || !repo || !runId) {
    return res.status(400).json({
      error: `owner/repo/runId required (owner: ${owner || '—'}, repo: ${repo || '—'})`,
    });
  }

  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`,
      {
        headers: {
          Authorization: `token ${req.githubToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );

    const jobs = (data.jobs || []).map((j) => ({
      id: j.id,
      name: j.name,
      status: j.status,
      conclusion: j.conclusion,
      started_at: j.started_at,
      completed_at: j.completed_at,
      url: j.html_url,
      steps: (j.steps || []).map((s) => ({
        number: s.number,
        name: s.name,
        status: s.status,
        conclusion: s.conclusion,
        started_at: s.started_at,
        completed_at: s.completed_at,
      })),
    }));

    res.json({ total_count: data.total_count || jobs.length, jobs });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

/**
 * @swagger
 * /github/job-log:
 *   get:
 *     summary: Build a concise text log for a job/step (for AI suggestion)
 *     tags: [GitHub]
 *     parameters:
 *       - in: query
 *         name: owner
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: repo
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: runId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Summary text for AI }
 */
router.get('/job-log', maybeAuth, ensureGitHubToken, async (req, res) => {
  const { owner, repo, runId, jobId } = req.query;
  if (!owner || !repo || !runId || !jobId) {
    return res.status(400).json({ error: 'owner, repo, runId and jobId are required' });
  }

  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`,
      {
        headers: {
          Authorization: `token ${req.githubToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );

    const job = (data.jobs || []).find((j) => String(j.id) === String(jobId));
    if (!job) return res.json({ text: '(No job found to assemble log)' });

    const lines = [];
    lines.push(`Job: ${job.name} | status: ${job.status} | conclusion: ${job.conclusion}`);
    lines.push(`Started: ${job.started_at || '—'} | Completed: ${job.completed_at || '—'}`);
    lines.push('');
    lines.push('Steps:');
    for (const s of job.steps || []) {
      lines.push(
        ` - #${s.number} ${s.name} | status: ${s.status} | conclusion: ${s.conclusion} | started: ${s.started_at || '—'} | completed: ${s.completed_at || '—'}`
      );
    }
    lines.push('');
    lines.push('(Raw log not fetched: GH API returns ZIP; this is a synthesized summary text.)');

    res.json({ text: lines.join('\n') });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

export default router;