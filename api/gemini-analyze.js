// Vercel Serverless Function: /api/gemini/analyze
// The GEMINI_API_KEY is set as a Vercel Environment Variable — never sent to the browser.

// List of models to try in order of preference.
// gemini-2.5-flash and gemini-3.5-flash work successfully with the new key.
const ATTEMPTS = [
  { version: 'v1beta', model: 'gemini-2.5-flash' },
  { version: 'v1beta', model: 'gemini-3.5-flash' },
  { version: 'v1beta', model: 'gemini-flash-latest' },
  { version: 'v1beta', model: 'gemini-2.0-flash' },
  { version: 'v1beta', model: 'gemini-1.5-flash' },
];

async function callGemini({ version, model }, key, base64Image, mimeType) {
  const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${key}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: mimeType || 'image/jpeg',
              data: base64Image
            }
          },
          {
            text: `You are an AI assistant for a government infrastructure damage reporting portal in India.
Analyze this image and return ONLY a valid JSON object (no markdown, no extra text) with these exact keys:
{
  "category": "one of: Road Damage, Pothole, Bridge Damage, Waterlogging, Street Light Failure, Garbage Overflow, Sewage Issue, Building Damage, Other",
  "severity": "one of: Low, Medium, High, Critical",
  "description": "A clear 1-2 sentence description of the damage visible in the image",
  "confidence": "a percentage like 92%"
}`
          }
        ]
      }]
    })
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not set in Vercel Environment Variables.' });
  }

  const { base64Image, mimeType } = req.body || {};
  if (!base64Image) return res.status(400).json({ error: 'Missing base64Image in request body.' });

  let lastError = null;

  for (const attempt of ATTEMPTS) {
    try {
      console.log(`[Gemini] Trying ${attempt.version}/${attempt.model}`);
      const geminiRes = await callGemini(attempt, GEMINI_KEY, base64Image, mimeType);

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        console.error(`[Gemini] ${attempt.version}/${attempt.model} failed (${geminiRes.status}):`, errText);
        lastError = `${attempt.version}/${attempt.model} → HTTP ${geminiRes.status}: ${errText}`;
        continue; // try next
      }

      const data = await geminiRes.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Strip markdown fences if Gemini wraps the JSON
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      try {
        const parsed = JSON.parse(cleaned);
        console.log(`[Gemini] Success: ${attempt.version}/${attempt.model}`);
        return res.json({ success: true, result: parsed, model: `${attempt.version}/${attempt.model}` });
      } catch {
        return res.json({ success: true, result: { raw: cleaned }, model: `${attempt.version}/${attempt.model}` });
      }

    } catch (err) {
      console.error(`[Gemini] Fetch error (${attempt.version}/${attempt.model}):`, err.message);
      lastError = err.message;
    }
  }

  return res.status(500).json({
    error: lastError || 'All Gemini models failed',
    details: lastError
  });
};
