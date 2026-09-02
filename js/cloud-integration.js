import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

const CLOUD_DOC_ID = 'instructor1_schedule_main';

let db = null;
let isCloudMode = false;
let isCloudConfiguredFlag = false;
let isApplyingRemoteUpdate = false;
let isSavingToCloud = false;
let cloudSaveTimer = null;
let pendingCloudPayload = null;
let appId = 'instructor1-schedule-2026-v1';
let geminiAvailable = false;
let unsubscribeSnapshot = null;
let lastAppliedRemoteSavedAt = 0;
let cloudSyncStarted = false;

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
    badge.title = 'Firebase 미설정 — 이 브라우저에만 저장됩니다. Vercel 환경변수에 FIREBASE_CONFIG를 등록하세요.';
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

function getCloudDocRef() {
  return doc(db, 'artifacts', appId, 'public', 'data', CLOUD_DOC_ID);
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

function shouldApplyRemotePayload(payload) {
  if (!payload || typeof payload.plannedTimetable !== 'object') return false;
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
  const { notify = false } = options;
  if (!shouldApplyRemotePayload(payload)) return false;
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

export async function initCloudIntegration() {
  try {
    const config = await fetchRuntimeConfig();
    geminiAvailable = Boolean(config.geminiAvailable);
    appId = config.appId || appId;
    isCloudConfiguredFlag = Boolean(config.configured && config.firebase);
    updateCloudUI({ configured: config.configured, geminiAvailable });

    if (!config.configured || !config.firebase) {
      return { ok: false, geminiAvailable, configured: false };
    }

    const app = initializeApp(config.firebase);
    const auth = getAuth(app);
    db = getFirestore(app);
    await signInAnonymously(auth);
    isCloudMode = true;
    updateCloudUI({ connected: true, geminiAvailable });
    return { ok: true, geminiAvailable, configured: true };
  } catch (error) {
    console.warn('Cloud integration init failed:', error);
    isCloudConfiguredFlag = false;
    updateCloudUI({ configured: false, geminiAvailable });
    return { ok: false, geminiAvailable, configured: false };
  }
}

export function isCloudConfigured() {
  return isCloudConfiguredFlag;
}

export function isCloudEnabled() {
  return isCloudMode && Boolean(db);
}

export async function loadFromCloud() {
  if (!isCloudEnabled()) return false;
  try {
    const snap = await getDoc(getCloudDocRef());
    if (!snap.exists()) return false;
    return applyRemotePayload(snap.data());
  } catch (error) {
    console.warn('Cloud load failed:', error);
    return false;
  }
}

export async function saveToCloud(payload, options = {}) {
  if (!isCloudEnabled() || isApplyingRemoteUpdate) return false;

  const data = payload || pendingCloudPayload;
  if (!data) return false;

  isSavingToCloud = true;
  try {
    await setDoc(getCloudDocRef(), data, { merge: false });
    pendingCloudPayload = null;
    lastAppliedRemoteSavedAt = Math.max(lastAppliedRemoteSavedAt, getPayloadSavedAtMs(data));
    cachePayloadLocally(data);
    if (options.showSuccessToast && typeof window.showToast === 'function') {
      window.showToast('Firebase 클라우드에 저장되었습니다.', 'success');
    }
    return true;
  } catch (error) {
    console.warn('Cloud save failed:', error);
    if (!options.silent && typeof window.showToast === 'function') {
      window.showToast(`클라우드 저장 실패: ${error.message}`, 'error');
    }
    return false;
  } finally {
    isSavingToCloud = false;
    if (pendingCloudPayload && !isApplyingRemoteUpdate) {
      const queued = pendingCloudPayload;
      pendingCloudPayload = null;
      await saveToCloud(queued, { silent: true });
    }
  }
}

export function scheduleCloudSave(payloadBuilder) {
  if (!isCloudEnabled() || isApplyingRemoteUpdate) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(async () => {
    const payload = typeof payloadBuilder === 'function' ? payloadBuilder() : payloadBuilder;
    if (!payload) return;
    pendingCloudPayload = payload;
    await saveToCloud(payload, { silent: true });
  }, 900);
}

export function startCloudSync() {
  if (!isCloudEnabled() || cloudSyncStarted) return;
  cloudSyncStarted = true;
  if (unsubscribeSnapshot) unsubscribeSnapshot();

  unsubscribeSnapshot = onSnapshot(getCloudDocRef(), (snap) => {
    if (!snap.exists()) return;
    applyRemotePayload(snap.data(), { notify: true });
  }, (error) => {
    console.warn('Cloud snapshot error:', error);
    if (typeof window.showToast === 'function') {
      window.showToast('실시간 동기화 연결이 끊어졌습니다. 새로고침해 주세요.', 'warning');
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
  isGeminiAvailable: () => geminiAvailable,
};
