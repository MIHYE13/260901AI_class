function buildFirebaseConfig() {
  if (process.env.FIREBASE_CONFIG) {
    try {
      return JSON.parse(process.env.FIREBASE_CONFIG);
    } catch {
      return null;
    }
  }

  const config = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
  };

  const cleaned = Object.fromEntries(
    Object.entries(config).filter(([, value]) => Boolean(value))
  );

  if (!cleaned.apiKey || !cleaned.projectId) return null;
  return cleaned;
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const firebase = buildFirebaseConfig();
  const geminiAvailable = Boolean(process.env.GEMINI_API_KEY);

  if (!firebase) {
    return res.status(200).json({
      configured: false,
      firebase: null,
      geminiAvailable,
      appId: process.env.FIREBASE_APP_ID_NAME || 'instructor1-schedule-2026-v1',
    });
  }

  return res.status(200).json({
    configured: true,
    firebase,
    geminiAvailable,
    appId: process.env.FIREBASE_APP_ID_NAME || 'instructor1-schedule-2026-v1',
  });
}
