# 강사 1 일정 분석 및 학년 시간표 조율 시스템

단일 HTML 웹앱 + Vercel Serverless API입니다.

## 로컬 실행

`index.html`을 브라우저에서 열면 됩니다. (로컬 파일에서는 API·Firebase 연동 없이 localStorage만 사용)

## Vercel 환경변수 등록

[Vercel Dashboard](https://vercel.com) → 프로젝트 → **Settings → Environment Variables**

| 변수명 | 설명 |
|--------|------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) API 키 |
| `GEMINI_MODEL` | (선택) 기본값 `gemini-2.0-flash` |
| `FIREBASE_CONFIG` | Firebase 웹앱 설정 JSON (한 줄) |
| `FIREBASE_APP_ID_NAME` | (선택) Firestore 경로 네임스페이스 |

`FIREBASE_CONFIG` 대신 아래 개별 변수도 사용할 수 있습니다.

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`

`.env.example` 파일을 참고하세요.

## 연동 구조

```
브라우저 (index.html)
  ├─ GET /api/config     → Firebase 설정 + Gemini 사용 가능 여부
  ├─ POST /api/gemini    → Gemini API 프록시 (키는 서버만 보유)
  └─ Firebase Firestore  → 편성표 클라우드 저장·실시간 동기화
```

- **Gemini**: 헤더 **AI 조언** 버튼 (환경변수 등록 시 표시)
- **Firebase**: 헤더 **Firebase 연동** 배지, 저장 시 자동 클라우드 동기화
- **localStorage**: Firebase 미설정 시 기존처럼 브라우저 로컬 저장

## Firebase 설정 (Firestore)

1. [Firebase Console](https://console.firebase.google.com)에서 웹앱 생성
2. **Authentication → Sign-in method → 익명** 로그인 활성화
3. **Firestore Database** 생성
4. 웹앱 SDK 설정 JSON을 `FIREBASE_CONFIG` 환경변수에 등록
5. **Firestore 보안 규칙** — 프로젝트 루트 `firestore.rules` 내용을 Firebase Console → Firestore → **규칙**에 붙여넣고 **게시**:

```
match /schedules/{docId} {
  allow read, write: if request.auth != null;
}
```

> Authentication **익명 로그인**이 활성화되어 있어야 `request.auth != null` 조건을 통과합니다.

## 다중 사용자 공유

- **Firebase 연동 시**: Firestore가 단일 공유 저장소입니다. 한 사용자가 「저장」하면 모든 접속자에게 실시간 반영됩니다.
- **Firebase 미설정 시**: 브라우저 localStorage만 사용되어 **사용자마다 다른 편성표**가 표시됩니다. 배포 후 반드시 Firebase를 설정하세요.

## GitHub & Vercel 배포

1. GitHub 저장소 [260901AI_class](https://github.com/MIHYE13/260901AI_class)에 push
2. Vercel **Add New Project** → 저장소 연결
3. Framework Preset: **Other**
4. 환경변수 등록 후 **Deploy**

배포 URL 루트(`/`)에서 앱이 실행됩니다.

## 데이터 백업

- 앱 내 **내보내기 / 불러오기** (JSON)
- Firebase 연동 시 Firestore에 자동 저장
