export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'GEMINI_API_KEY가 Vercel 환경변수에 등록되지 않았습니다.' });
  }

  const { prompt, context } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt가 필요합니다.' });
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const userText = context ? `${context}\n\n---\n\n${prompt}` : prompt;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 2048,
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || 'Gemini API 오류';
      return res.status(response.status).json({ error: message });
    }

    const text = (data.candidates || [])
      .flatMap((candidate) => candidate.content?.parts || [])
      .map((part) => part.text || '')
      .join('')
      .trim();

    if (!text) {
      return res.status(502).json({ error: 'Gemini 응답이 비어 있습니다.' });
    }

    return res.status(200).json({ text, model });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Gemini 요청 실패' });
  }
}
