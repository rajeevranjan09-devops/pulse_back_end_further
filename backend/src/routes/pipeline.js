import express from 'express';
import axios from 'axios';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Pipelines
 *   description: Pipeline monitoring endpoints (top-level)
 */

// helper: fetch latest run for a workflow
async function fetchLatestRun(owner, repo, workflowId, token) {
  const runsRes = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?per_page=1`,
    { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } }
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
    actor: run.actor?.login
  };
}

/**
 * @swagger
 * /pipelines:
 *   get:
 *     summary: Get pipelines (workflows) for all repos under an organization (used by dashboard)
 *     tags: [Pipelines]
 *     parameters:
 *       - in: query
 *         name: org
 *         required: true
 *         schema:
 *           type: string
 *         description: GitHub organization (or username)
 *       - in: query
 *         name: includeRuns
 *         schema:
 *           type: boolean
 *           default: true
 *         required: false
 *         description: Include latest run status for each workflow (default true)
 *       - in: header
 *         name: x-github-token
 *         schema:
 *           type: string
 *         required: false
 *         description: GitHub PAT (optional if OAuth session exists; .env fallback used)
 *     responses:
 *       200:
 *         description: List of workflows with latest run (if requested)
 *       400:
 *         description: Missing org
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  const org = req.query.org;
  const includeRuns = String(req.query.includeRuns ?? 'true').toLowerCase() !== 'false';

  if (!org) return res.status(400).json({ error: 'Organization is required' });

  const tokenFromOAuth = req.user?.accessToken;
  const tokenFromHeader = req.headers['x-github-token'];
  const token = tokenFromOAuth || tokenFromHeader || process.env.GITHUB_PAT;

  if (!token) return res.status(401).json({ error: 'GitHub token required (oauth/header/.env)' });

  try {
    let reposRes;
    try {
      reposRes = await axios.get(
        `https://api.github.com/orgs/${org}/repos?type=all&per_page=100`,
        { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } }
      );
    } catch (e) {
      if (e.response?.status === 404) {
        reposRes = await axios.get(
          `https://api.github.com/users/${org}/repos?per_page=100`,
          { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } }
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
          { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } }
        );

        if (wfRes.data?.workflows?.length) {
          for (const wf of wfRes.data.workflows) {
            const latest_run = includeRuns
              ? await fetchLatestRun(owner, repo.name, wf.id, token)
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
              latest_run
            });
          }
        }
      } catch (e) {
        if ([403, 404, 409].includes(e.response?.status)) continue;
        throw e;
      }
    }

    return res.json(pipelines);
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ error: `Organization or user '${org}' not found` });
    }
    const msg = err.response?.data?.message || err.message;
    return res.status(err.response?.status || 500).json({ error: msg });
  }
});

export default router;
