import express from 'express';
import User from '../models/user.js';
import requireAuth from '../middleware/requireAuth.js';
import { decrypt, encrypt, mask } from '../utils/crypto.js';

const router = express.Router();

// GET /me  -> basic profile + whether Git is configured (no secrets)
router.get('/', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const patPlain = decrypt(user.github?.patEnc || '');
  const secretPlain = decrypt(user.github?.clientSecretEnc || '');

  const githubConfigured = Boolean(
    patPlain || (user.github?.clientId && secretPlain && user.github?.callbackUrl)
  );

  res.json({
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    githubConfigured,
    github: {
      patMasked: mask(patPlain || ''),
      clientId: user.github?.clientId || null,
      clientSecretMasked: mask(secretPlain || ''),
      callbackUrl: user.github?.callbackUrl || null,
      homepageUrl: user.github?.homepageUrl || null
    }
  });
});

// POST /me/config -> save PAT and/or OAuth app details
router.post('/config', requireAuth, async (req, res) => {
  const { pat, clientId, clientSecret, callbackUrl, homepageUrl } = req.body || {};
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.github = user.github || {};

  if (typeof pat === 'string' && pat.trim()) user.github.patEnc = encrypt(pat.trim());
  if (typeof clientId === 'string') user.github.clientId = clientId.trim() || null;
  if (typeof clientSecret === 'string' && clientSecret.trim())
    user.github.clientSecretEnc = encrypt(clientSecret.trim());
  if (typeof callbackUrl === 'string') user.github.callbackUrl = callbackUrl.trim() || null;
  if (typeof homepageUrl === 'string') user.github.homepageUrl = homepageUrl.trim() || null;

  await user.save();
  res.json({ ok: true });
});

export default router;

/**
 * @swagger
 * tags:
 *   name: Me
 *   description: Current user profile/config
 *
 * /me:
 *   get:
 *     summary: Get current profile and GitHub config status
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Profile }
 *
 * /me/config:
 *   post:
 *     summary: Save GitHub PAT and OAuth app details (encrypted at rest)
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pat: { type: string }
 *               clientId: { type: string }
 *               clientSecret: { type: string }
 *               callbackUrl: { type: string }
 *               homepageUrl: { type: string }
 *     responses:
 *       200: { description: Saved }
 */
