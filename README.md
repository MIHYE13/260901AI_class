# 강사 1 일정 분석 및 학년 시간표 조율 시스템

단일 HTML 웹앱입니다. Vercel 등 정적 호스팅에 바로 배포할 수 있습니다.

## 로컬 실행

`index.html` 파일을 브라우저에서 열면 됩니다.

## 데이터 저장

- 편집 내용은 브라우저 **localStorage**에 자동 저장됩니다.
- 다른 기기·브라우저로 옮길 때는 앱 내 **내보내기 / 불러오기** (JSON)를 사용하세요.

## Vercel 배포

1. [Vercel](https://vercel.com)에 로그인
2. **Add New Project** → GitHub 저장소 `260901AI_class` 연결
3. Framework Preset: **Other** (빌드 명령 없음)
4. Deploy

배포 후 루트 URL에서 `index.html`이 자동으로 제공됩니다.
