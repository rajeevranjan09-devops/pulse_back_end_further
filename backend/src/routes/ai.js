// src/routes/ai.js
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY not set — /ai/suggest will return 400');
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

/** Build a concise, instruction-following prompt */
function makePrompt(errorText = '', stepsLog = '') {
  // Keep logs to a safe size to avoid hitting request limits
  const LOG_LIMIT = 12000; // chars
  const logs = (stepsLog || '').slice(0, LOG_LIMIT);

  return `
You are a CI/CD assistant. Analyze GitHub Actions job logs and the error message.
Return a concise explanation and a step-by-step fix.

Rules:
- Output markdown with sections: "Root cause", "Fix", and "References" (if relevant).
- Keep it brief (<= 250 tokens).
- If the cause is uncertain, suggest the most likely causes with checks.

### Job Logs
${logs || '(no logs provided)'}

### Error
${errorText || '(no explicit error)'}
`;
}

router.post('/suggest', async (req, res) => {
  try {
    if (!genAI) return res.status(400).json({ error: 'GEMINI_API_KEY not configured' });

    const { errorText = '', stepsLog = '' } = req.body || {};
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = makePrompt(errorText, stepsLog);

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
      },
      // Optional: relax safety thresholds for logs that may contain harsh wording
      safetySettings: [
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    });

    const suggestion =
      result?.response?.text?.() ??
      result?.response?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ??
      'No suggestion';

    return res.json({ suggestion });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ error: e.message || 'Gemini call failed' });
  }
});

export default router;