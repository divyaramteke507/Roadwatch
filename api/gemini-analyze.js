// Vercel Serverless Function: /api/gemini/analyze
// The GEMINI_API_KEY is set as a Vercel Environment Variable — never sent to the browser.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured. Add GEMINI_API_KEY to Vercel Environment Variables.' });
  }

  const { base64Image, mimeType } = req.body || {};
  if (!base64Image) return res.status(400).json({ error: 'Missing base64Image in request body.' });

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
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
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('[Gemini] API error:', errText);
      return res.status(geminiRes.status).json({ error: 'Gemini API error', details: errText });
    }

    const data = await geminiRes.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Strip markdown fences if Gemini wraps the JSON
    const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      return res.json({ success: true, result: parsed });
    } catch {
      return res.json({ success: true, result: { raw: cleaned } });
    }

  } catch (err) {
    console.error('[Gemini] Fetch error:', err);
    return res.status(500).json({ error: 'Failed to contact Gemini API', details: err.message });
  }
};
