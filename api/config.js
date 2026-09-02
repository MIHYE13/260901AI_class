function normalizeFirebaseConfigRaw(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let value = raw.trim();
  if (!value) return '';

  // Vercel에 바깥 따옴표까지 넣은 경우: "{\"apiKey\":...}"
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    const unwrapped = value.slice(1, -1);
    if (unwrapped.includes('apiKey') || unwrapped.startsWith('{')) {
      value = unwrapped.replace(/\\"/g, '"');
    }
  }

  return value.trim();
}

function parseFirebaseConfigJson(raw) {
  const normalized = normalizeFirebaseConfigRaw(raw);
  if (!normalized) return null;

  const attempts = [
    normalized,
    normalized.replace(/'/g, '"'),
  ];

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try next */
    }
  }

  return null;
}

function buildFirebaseConfig() {
  if (process.env.FIREBASE_CONFIG) {
    const parsed = parseFirebaseConfigJson(process.env.FIREBASE_CONFIG);
    if (parsed?.apiKey && parsed?.projectId) return parsed;
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

function getFirebaseConfigHint(firebase) {
  if (firebase) return null;

  const hasJson = Boolean(process.env.FIREBASE_CONFIG?.trim());
  const hasPartial = Boolean(
    process.env.FIREBASE_API_KEY
    || process.env.FIREBASE_PROJECT_ID
    || process.env.FIREBASE_AUTH_DOMAIN
  );

  if (hasJson) {
    const parsed = parseFirebaseConfigJson(process.env.FIREBASE_CONFIG);
    if (!parsed) {
      return 'FIREBASE_CONFIG JSON 파싱 실패 — 줄바꿈 없이 한 줄 JSON인지, 큰따옴표(")를 사용했는지 확인하세요.';
    }
    if (!parsed.apiKey || !parsed.projectId) {
      return 'FIREBASE_CONFIG에 apiKey와 projectId가 필요합니다.';
    }
  }

  if (hasPartial) {
    return '개별 Firebase 변수 중 FIREBASE_API_KEY와 FIREBASE_PROJECT_ID가 모두 필요합니다.';
  }

  return 'FIREBASE_CONFIG 환경변수가 없습니다. Vercel → Settings → Environment Variables에 등록 후 Redeploy 하세요.';
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
  const configHint = getFirebaseConfigHint(firebase);
  const appId = process.env.FIREBASE_APP_ID_NAME || 'instructor1-schedule-2026-v1';

  if (!firebase) {
    return res.status(200).json({
      configured: false,
      firebase: null,
      geminiAvailable,
      appId,
      configHint,
      hasFirebaseEnv: Boolean(process.env.FIREBASE_CONFIG?.trim() || process.env.FIREBASE_API_KEY),
    });
  }

  return res.status(200).json({
    configured: true,
    firebase,
    geminiAvailable,
    appId,
    configHint: null,
  });
}
