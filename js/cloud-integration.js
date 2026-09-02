import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

const CLOUD_DOC_ID = 'instructor1_schedule_main';

let db = null;
let isCloudMode = false;
let isApplyingRemoteUpdate = false;
let isSavingToCloud = false;
let cloudSaveTimer = null;
let appId = 'instructor1-schedule-2026-v1';
let geminiAvailable = false;
let unsubscribeSnapshot = null;

function updateCloudUI(state = {}) {
  const badge = document.getElementById('cloudStatusBadge');
  const geminiBtn = document.getElementById('geminiAdviceBtn');
  if (!badge) return;

  if (state.connected) {
    badge.textContent = 'Firebase 연동';
    badge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200';
  } else if (state.configured === false) {
    badge.textContent = '로컬 저장';
    badge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200';
  } else {
    badge.textContent = '연결 대기';
    badge.className = 'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200';
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

export async function initCloudIntegration() {
  try {
    const config = await fetchRuntimeConfig();
    geminiAvailable = Boolean(config.geminiAvailable);
    appId = config.appId || appId;
    updateCloudUI({ configured: config.configured, geminiAvailable });

    if (!config.configured || !config.firebase) {
      return { ok: false, geminiAvailable };
    }

    const app = initializeApp(config.firebase);
    const auth = getAuth(app);
    db = getFirestore(app);
    await signInAnonymously(auth);
    isCloudMode = true;
    updateCloudUI({ connected: true, geminiAvailable });
    subscribeCloudChanges();
    return { ok: true, geminiAvailable };
  } catch (error) {
    console.warn('Cloud integration init failed:', error);
    updateCloudUI({ configured: false, geminiAvailable });
    return { ok: false, geminiAvailable };
  }
}

export function isCloudEnabled() {
  return isCloudMode && Boolean(db);
}

export async function loadFromCloud() {
  if (!isCloudEnabled()) return false;
  try {
    const snap = await getDoc(getCloudDocRef());
    if (!snap.exists()) return false;
    const payload = snap.data();
    if (typeof window.applySchedulePayload === 'function') {
      return window.applySchedulePayload(payload);
    }
    return false;
  } catch (error) {
    console.warn('Cloud load failed:', error);
    return false;
  }
}

export async function saveToCloud(payload, options = {}) {
  if (!isCloudEnabled() || isApplyingRemoteUpdate) return false;
  if (isSavingToCloud) return false;

  isSavingToCloud = true;
  try {
    await setDoc(getCloudDocRef(), payload, { merge: false });
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
  }
}

export function scheduleCloudSave(payloadBuilder) {
  if (!isCloudEnabled() || isApplyingRemoteUpdate) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(async () => {
    const payload = typeof payloadBuilder === 'function' ? payloadBuilder() : payloadBuilder;
    if (payload) await saveToCloud(payload, { silent: true });
  }, 900);
}

function subscribeCloudChanges() {
  if (!isCloudEnabled()) return;
  if (unsubscribeSnapshot) unsubscribeSnapshot();

  unsubscribeSnapshot = onSnapshot(getCloudDocRef(), (snap) => {
    if (!snap.exists()) return;
    if (typeof window.applySchedulePayload !== 'function') return;

    isApplyingRemoteUpdate = true;
    try {
      window.applySchedulePayload(snap.data());
      if (typeof window.refreshAllScheduleViews === 'function') {
        window.refreshAllScheduleViews(false);
      }
      if (typeof window.updateScheduleSaveStatus === 'function') {
        window.updateScheduleSaveStatus();
      }
    } finally {
      isApplyingRemoteUpdate = false;
    }
  }, (error) => {
    console.warn('Cloud snapshot error:', error);
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
  askGemini,
  isCloudEnabled,
  isGeminiAvailable: () => geminiAvailable,
};
