import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

const CLOUD_DOC_ID = 'instructor1_schedule_main';
const CLOUD_DOC_SEGMENTS = ['schedules', CLOUD_DOC_ID];

let firebaseApp = null;
let firebaseAuth = null;
let db = null;
let isCloudMode = false;
let isCloudConfiguredFlag = false;
let isCloudWriteVerified = false;
let isApplyingRemoteUpdate = false;
let isSavingToCloud = false;
let cloudSaveTimer = null;
let pendingCloudPayload = null;
let appId = 'instructor1-schedule-2026-v1';
let geminiAvailable = false;
let cloudConfigHint = null;
let lastCloudSaveError = null;
let unsubscribeSnapshot = null;
let lastAppliedRemoteSavedAt = 0;
let cloudSyncStarted = false;
let activeCloudDocRef = null;

function updateCloudUI(state = {}) {
  const badge = document.getElementById('cloudStatusBadge');
  const geminiBtn = document.getElementById('geminiAdviceBtn');
  if (!badge) return;

  if (state.connected) {
    badge.textContent = 'Firebase 공유 동기화';
    badge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200';
    badge.title = '모든 사용자가 동일한 편성표를 실시간으로 공유합니다.';
  } else if (state.configured === false) {
    badge.textContent = '로컬 저장 (공유 불가)';
    badge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200';
    badge.title = 'Firebase 미설정 — Vercel 환경변수 FIREBASE_CONFIG를 등록하세요.';
  } else {
    badge.textContent = '연결 대기';
    badge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200';
    badge.title = 'Firebase 연결 중…';
  }

  if (geminiBtn) {
    geminiBtn.classList.toggle('hidden', !state.geminiAvailable);
  }
}

async function fetchRuntimeConfig() {
  const response = await fetch('/api/config', { cache: 'no-store' });
  if (!response.ok) throw new Error('설정 API 응답 오류');
  return response.json();
}

function getLegacyCloudDocRef() {
  return doc(db, 'artifacts', appId, 'public', 'data', CLOUD_DOC_ID);
}

function getPrimaryCloudDocRef() {
  return doc(db, ...CLOUD_DOC_SEGMENTS);
}

function getActiveCloudDocRef() {
  return activeCloudDocRef || getPrimaryCloudDocRef();
}

function sanitizeForFirestore(payload) {
  return JSON.parse(JSON.stringify(payload));
}

function formatCloudError(error) {
  const code = error?.code || '';
  const message = error?.message || String(error);

  if (code === 'permission-denied' || message.includes('Missing or insufficient permissions')) {
    return 'Firestore 권한 거부 — Firebase Console → Firestore → 규칙에 schedules 컬렉션 읽기·쓰기(익명 로그인)를 허용하세요.';
  }
  if (code === 'unauthenticated' || message.includes('UNAUTHENTICATED')) {
    return 'Firebase 인증 실패 — Authentication에서 익명(Anonymous) 로그인을 활성화하세요.';
  }
  if (code === 'invalid-argument' || message.includes('invalid data')) {
    return 'Firestore 데이터 형식 오류 — 페이지를 새로고침한 뒤 다시 저장하세요.';
  }
  if (message.includes('longer than')) {
    return '편성표 데이터가 Firestore 한도(1MB)를 초과했습니다.';
  }
  return message;
}

async function ensureAuthenticated() {
  if (!firebaseAuth) throw new Error('Firebase 인증이 초기화되지 않았습니다.');
  if (!firebaseAuth.currentUser) {
    await signInAnonymously(firebaseAuth);
  }
  return firebaseAuth.currentUser;
}

function getPayloadSavedAtMs(payload) {
  const raw = payload?.savedAt;
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function getLocalSavedAtMs() {
  if (typeof window.getCurrentScheduleSavedAt === 'function') {
    return window.getCurrentScheduleSavedAt();
  }
  return 0;
}

function hasUnsavedLocalChanges() {
  return typeof window.isScheduleDirty === 'function' && window.isScheduleDirty();
}

function shouldApplyRemotePayload(payload, options = {}) {
  const { force = false } = options;
  if (!payload || typeof payload.plannedTimetable !== 'object') return false;
  if (force) return true;
  const remoteMs = getPayloadSavedAtMs(payload);
  if (!remoteMs) return true;
  if (remoteMs <= lastAppliedRemoteSavedAt) return false;
  if (hasUnsavedLocalChanges()) return false;
  const localMs = getLocalSavedAtMs();
  return remoteMs >= localMs;
}

function cachePayloadLocally(payload) {
  if (typeof window.syncScheduleLocalCache === 'function') {
    window.syncScheduleLocalCache(payload);
  }
}

function applyRemotePayload(payload, options = {}) {
  const { notify = false, force = false } = options;
  if (!shouldApplyRemotePayload(payload, { force })) return false;
  if (typeof window.applySchedulePayload !== 'function') return false;

  isApplyingRemoteUpdate = true;
  try {
    const previousApplied = lastAppliedRemoteSavedAt;
    const applied = window.applySchedulePayload(payload);
    if (!applied) return false;

    const remoteMs = getPayloadSavedAtMs(payload);
    lastAppliedRemoteSavedAt = Math.max(lastAppliedRemoteSavedAt, remoteMs);
    cachePayloadLocally(payload);

    if (typeof window.refreshAllScheduleViews === 'function') {
      window.refreshAllScheduleViews(false);
    }
    if (typeof window.updateScheduleSaveStatus === 'function') {
      window.updateScheduleSaveStatus();
    }
    if (notify && remoteMs > previousApplied && typeof window.showToast === 'function') {
      window.showToast('다른 사용자의 편성 변경이 반영되었습니다.', 'info');
    }
    return true;
  } finally {
    isApplyingRemoteUpdate = false;
  }
}

async function loadPayloadFromRef(ref) {
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data();
}

async function resolveCloudDocRef() {
  const primary = getPrimaryCloudDocRef();
  const primaryData = await loadPayloadFromRef(primary);
  if (primaryData) {
    activeCloudDocRef = primary;
    return primary;
  }

  const legacy = getLegacyCloudDocRef();
  const legacyData = await loadPayloadFromRef(legacy);
  if (legacyData) {
    activeCloudDocRef = legacy;
    return legacy;
  }

  activeCloudDocRef = primary;
  return primary;
}

async function verifyCloudWriteAccess() {
  try {
    await ensureAuthenticated();
    const ref = getPrimaryCloudDocRef();
    await setDoc(ref, {
      _writeProbe: true,
      savedAt: new Date().toISOString(),
    }, { merge: true });
    activeCloudDocRef = ref;
    isCloudWriteVerified = true;
    cloudConfigHint = null;
    return true;
  } catch (error) {
    isCloudWriteVerified = false;
    cloudConfigHint = formatCloudError(error);
    console.warn('Cloud write probe failed:', error);
    return false;
  }
}

export async function initCloudIntegration() {
  try {
    const config = await fetchRuntimeConfig();
    geminiAvailable = Boolean(config.geminiAvailable);
    appId = config.appId || appId;
    cloudConfigHint = config.configHint || null;
    isCloudConfiguredFlag = Boolean(config.configured && config.firebase);
    updateCloudUI({ configured: config.configured, geminiAvailable });

    if (!config.configured || !config.firebase) {
      return { ok: false, geminiAvailable, configured: false, configHint: cloudConfigHint };
    }

    firebaseApp = initializeApp(config.firebase);
    firebaseAuth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    await ensureAuthenticated();
    isCloudMode = true;
    updateCloudUI({ connected: true, geminiAvailable });

    const writeOk = await verifyCloudWriteAccess();
    if (!writeOk) {
      updateCloudUI({ configured: true, geminiAvailable });
    }

    return { ok: true, geminiAvailable, configured: true, configHint: cloudConfigHint, writeOk };
  } catch (error) {
    console.warn('Cloud integration init failed:', error);
    isCloudConfiguredFlag = Boolean(error?.code !== 'permission-denied');
    isCloudMode = false;
    cloudConfigHint = window.location.protocol === 'file:'
      ? '로컬 HTML 파일에서는 Firebase API(/api/config)를 사용할 수 없습니다. Vercel 배포 URL로 접속하세요.'
      : formatCloudError(error);
    updateCloudUI({ configured: false, geminiAvailable });
    return { ok: false, geminiAvailable, configured: false, configHint: cloudConfigHint };
  }
}

export function isCloudConfigured() {
  return isCloudConfiguredFlag;
}

export function getCloudConfigHint() {
  return cloudConfigHint || lastCloudSaveError;
}

export function getLastCloudSaveError() {
  return lastCloudSaveError;
}

export function isCloudEnabled() {
  return isCloudMode && Boolean(db) && Boolean(firebaseAuth?.currentUser);
}

export function canCloudWrite() {
  return isCloudEnabled();
}

export async function loadFromCloud() {
  if (!isCloudEnabled()) return false;
  try {
    await resolveCloudDocRef();
    const data = await loadPayloadFromRef(getActiveCloudDocRef());
    if (!data || !data.plannedTimetable) return false;
    return applyRemotePayload(data, { force: true });
  } catch (error) {
    console.warn('Cloud load failed:', error);
    lastCloudSaveError = formatCloudError(error);
    return false;
  }
}

export async function saveToCloud(payload, options = {}) {
  const { silent = false, force = false, showSuccessToast = false } = options;

  if (!isCloudMode || !db) {
    lastCloudSaveError = 'Firebase가 연결되지 않았습니다.';
    return false;
  }
  if (isApplyingRemoteUpdate && !force) {
    lastCloudSaveError = '원격 동기화 중입니다. 잠시 후 다시 저장하세요.';
    return false;
  }

  const data = sanitizeForFirestore(payload || pendingCloudPayload);
  if (!data) return false;

  isSavingToCloud = true;
  try {
    await ensureAuthenticated();
    const ref = getPrimaryCloudDocRef();
    activeCloudDocRef = ref;
    await setDoc(ref, data, { merge: false });
    pendingCloudPayload = null;
    lastCloudSaveError = null;
    lastAppliedRemoteSavedAt = Math.max(lastAppliedRemoteSavedAt, getPayloadSavedAtMs(data));
    cachePayloadLocally(data);
    isCloudWriteVerified = true;
    if (showSuccessToast && typeof window.showToast === 'function') {
      window.showToast('Firebase 클라우드에 저장되었습니다.', 'success');
    }
    return true;
  } catch (error) {
    lastCloudSaveError = formatCloudError(error);
    console.warn('Cloud save failed:', error);
    if (!silent && typeof window.showToast === 'function') {
      window.showToast(`클라우드 저장 실패: ${lastCloudSaveError}`, 'error');
    }
    return false;
  } finally {
    isSavingToCloud = false;
    if (pendingCloudPayload && !isApplyingRemoteUpdate) {
      const queued = pendingCloudPayload;
      pendingCloudPayload = null;
      await saveToCloud(queued, { silent: true, force: true });
    }
  }
}

export function scheduleCloudSave(payloadBuilder) {
  if (!isCloudMode || !db) return;
  if (isApplyingRemoteUpdate) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(async () => {
    const payload = typeof payloadBuilder === 'function' ? payloadBuilder() : payloadBuilder;
    if (!payload) return;
    pendingCloudPayload = payload;
    await saveToCloud(payload, { silent: true, force: true });
  }, 900);
}

export function startCloudSync() {
  if (!isCloudEnabled() || cloudSyncStarted) return;
  cloudSyncStarted = true;
  if (unsubscribeSnapshot) unsubscribeSnapshot();

  const ref = getPrimaryCloudDocRef();
  activeCloudDocRef = ref;

  unsubscribeSnapshot = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    if (isSavingToCloud) return;
    applyRemotePayload(snap.data(), { notify: true });
  }, (error) => {
    console.warn('Cloud snapshot error:', error);
    lastCloudSaveError = formatCloudError(error);
    if (typeof window.showToast === 'function') {
      window.showToast(`실시간 동기화 오류: ${lastCloudSaveError}`, 'warning');
    }
  });
}

export async function askGemini(prompt, context) {
  if (!geminiAvailable) {
    throw new Error('Gemini API가 Vercel 환경변수에 등록되지 않았습니다.');
  }

  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, context }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Gemini 요청 실패');
  }
  return data.text;
}

window.CloudBridge = {
  initCloudIntegration,
  loadFromCloud,
  saveToCloud,
  scheduleCloudSave,
  startCloudSync,
  askGemini,
  isCloudEnabled,
  isCloudConfigured,
  canCloudWrite,
  getCloudConfigHint,
  getLastCloudSaveError,
  isGeminiAvailable: () => geminiAvailable,
};
