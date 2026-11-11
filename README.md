# MawaVerse

작은 모임이 함께 놀 수 있는 2D 픽셀 메타버스입니다. 브라우저에서 바로 접속해 돌아다니고, 수다 떨고, 낚시하고, 내기를 합니다.
서버 코드 없이 브라우저와 Firebase(Realtime Database 보안 규칙)만으로 동작하며, Firebase 무료(Spark) 플랜으로 운영할 수 있게 만들었습니다.

- 운영 주소: https://mawaverse.web.app
- 기능 명세: [SPEC.md](SPEC.md)
- 라이선스: [MIT](LICENSE)

## 주요 기능

- **마을**: 타일 단위 이동, 캐릭터 150종, 채팅·귓속말, 이모트, 밀치기·끌기, 말랑이 던지기
- **놀거리**: 낚시와 도감·주간 순위·낚시 대회, 곤충 채집, 커피 내기 방, 경마, 마피아, 두더지 잡기, 보물 지도, 하루 룰렛, 게시판
- **꾸미기**: 코인, 상점, 꾸미기 아이템, 펫과 탑승, 낚싯대 강화
- **모바일**: 조이스틱과 버튼으로 같은 기능을 씁니다
- **관리자 페이지**: 접속 현황, 로그, 사용자 관리, 가입 승인, 물고기·곤충 목록, 설정, 맵 편집기

그래픽은 전부 코드로 그립니다. 이미지 파일이 없어 번들이 작고 전송량도 적습니다.

## 이용 규칙

- **가입 승인제**: 가입 신청(아이디, 비밀번호, 실명, 닉네임, 가입 사유, 개인정보 수집 동의) 후 관리자가 승인해야 입장할 수 있습니다. 승인 전에는 대기 화면만 보입니다.
- **실명 보호**: 게임 안에서는 닉네임만 보입니다. 실명과 가입 사유는 관리자 페이지에서만 볼 수 있고, 거절되거나 탈퇴하면 바로 삭제됩니다.
- **이용 시간 차단(선택)**: 관리자가 관리자 페이지 설정에서 "평일 근무시간 이용 차단"을 켜면 평일(월~금) 09:00~18:00(한국 시간)에는 이용할 수 없습니다. 단 쉬는 시간(10:30~10:45, 12:00~13:00, 15:30~15:45)에는 이용할 수 있습니다. 차단이 시작되기 5분 전에 안내가 뜨고, 그 시각에 접속이 끊깁니다. 주말과 공휴일은 종일 이용할 수 있고, 관리자는 예외입니다. 기본값은 꺼짐입니다.
- **탈퇴**: 게임 안의 내 메뉴에서 직접 탈퇴할 수 있습니다. 계정과 개인정보가 바로 삭제됩니다.

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 화면 | Vite, TypeScript, Canvas 2D |
| 인증 | Firebase Authentication (이메일/비밀번호. 아이디는 내부에서 가짜 이메일로 바뀌며 메일은 발송되지 않습니다) |
| 데이터·실시간 | Firebase Realtime Database |
| 검증 | `database.rules.json` 보안 규칙 (서버 코드 없음) |
| 호스팅 | Firebase Hosting |
| 배포 | GitHub Actions (`main` 에 push 하면 자동 배포) |

## 로컬 실행

Node.js 24 이상이 필요합니다.

```bash
npm ci
```

### Firebase 프로젝트 없이 (에뮬레이터)

Java 11 이상과 Firebase CLI(`npm i -g firebase-tools`)가 필요합니다.

1. `.env.local` 파일을 만들고 `VITE_USE_EMULATOR=1` 한 줄을 넣습니다.
2. 터미널 1에서 `npm run emulators`, 터미널 2에서 `npm run dev` 를 실행합니다.
3. http://localhost:5173 에서 가입합니다. 에뮬레이터 UI(http://127.0.0.1:4000)의 Realtime Database 에서 `admins/<uid>` 를 `true` 로 넣으면 관리자가 됩니다.
4. 두 사용자를 동시에 보려면 한쪽은 http://127.0.0.1:5173 으로 접속합니다(로그인 세션이 분리됩니다).

에뮬레이터도 실제와 같은 규칙을 쓰므로, 가입 승인이 필요합니다. 에뮬레이터 UI 에서 `approved/<uid>` 를 `true` 로 넣거나 관리자 계정으로 승인하세요.

### 실제 Firebase 프로젝트로

1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트를 만듭니다.
2. **Authentication** 에서 로그인 방법 **이메일/비밀번호**를 켭니다.
3. **Realtime Database** 를 만듭니다(잠금 모드로 시작).
4. 프로젝트 설정 > 내 앱에서 **웹 앱**을 추가하고 `firebaseConfig` 값을 확인합니다.
5. `.env.example` 을 `.env.local` 로 복사해 값을 채웁니다.
6. `.firebaserc` 의 프로젝트 ID 를 내 프로젝트로 바꿉니다.
7. `firebase login` 후 `npm run deploy:rules` 로 규칙과 공휴일 목록을 올립니다.
8. `npm run dev` 로 실행합니다.

### 관리자 지정

1. 사이트에서 가입 신청을 합니다.
2. Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > **새 비공개 키 생성**으로 받은 파일을 프로젝트 루트에 `serviceAccount.json` 으로 저장합니다. 이 파일은 `.gitignore` 에 들어 있으며 절대 공유하지 않습니다.
3. `node tools/admin-cli.mjs set-admin <아이디>` 를 실행합니다.

관리자는 승인 없이 입장할 수 있고, 로그인하면 서버 입장과 관리자 모드(`/admin`)를 고를 수 있습니다.

## 환경변수

`.env.local` 에 넣습니다. 이름과 설명은 [.env.example](.env.example) 에도 있습니다.

| 이름 | 설명 |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase 웹 앱 설정의 `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_DATABASE_URL` | Realtime Database 주소 (`databaseURL`) |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_APP_ID` | `appId` |
| `VITE_USE_EMULATOR` | `1` 이면 로컬 에뮬레이터에 붙습니다. 평소에는 `0` |

값은 Firebase 콘솔 > 프로젝트 설정 > 일반 > 내 앱에서 다시 확인할 수 있습니다.

## 명령

| 명령 | 설명 |
|---|---|
| `npm run dev` | 로컬 개발 서버 |
| `npm run build` | 타입 검사와 프로덕션 빌드 (`dist/`) |
| `npm test` | 이용 시간 판정 테스트 |
| `npm run test:rules` | 보안 규칙 테스트 (에뮬레이터. Java 와 Firebase CLI 필요) |
| `npm run rules` | 배포용 규칙 파일과 공휴일 목록 생성 |
| `npm run emulators` | 로컬 에뮬레이터 |
| `npm run deploy` | 빌드 후 호스팅·규칙·공휴일 목록 수동 배포 |
| `npm run deploy:rules` | 규칙과 공휴일 목록만 수동 배포 |
| `node tools/admin-cli.mjs help` | 관리자 CLI (관리자 지정, 비밀번호 재설정, 계정 삭제 등) |

## 배포

`main` 브랜치에 push 하면 GitHub Actions([.github/workflows/deploy.yml](.github/workflows/deploy.yml))가 테스트 → 빌드 → Firebase 배포(호스팅, 보안 규칙, 공휴일 목록)를 합니다.

저장소 **Settings > Secrets and variables > Actions** 에 아래 Secrets 가 있어야 합니다.

| Secret | 값 |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | 배포 권한이 있는 서비스 계정 키(JSON 파일 내용 전체) |
| `VITE_FIREBASE_API_KEY` | 위 환경변수와 같은 값 |
| `VITE_FIREBASE_AUTH_DOMAIN` | 〃 |
| `VITE_FIREBASE_DATABASE_URL` | 〃 |
| `VITE_FIREBASE_PROJECT_ID` | 〃 |
| `VITE_FIREBASE_APP_ID` | 〃 |

직접 배포하려면 `firebase login` 후 `npm run deploy` 를 실행합니다.

## 운영 참고

### 쉬는 시간

평일 차단 중에 풀어 주는 쉬는 시간은 [hours.json](hours.json) 하나로 관리합니다. `["시작", "끝"]` 을 고치고 `main` 에 push 하면 화면과 보안 규칙에 함께 반영됩니다.

### 공휴일

이용 시간 차단을 켰을 때 쓰는 공휴일 목록은 [holidays.json](holidays.json) 하나로 관리합니다. 임시공휴일이 생기면 `"YYYY-MM-DD": "이름"` 한 줄을 추가하고 `main` 에 push 하면 반영됩니다. 해가 바뀌기 전에 다음 해 날짜를 채워야 합니다.

### 보안 규칙

`database.rules.json` 이 원본입니다. 배포할 때 `tools/gen-gate.cjs` 가 여기에 가입 승인과 이용 시간 조건을 넣어 `database.rules.deploy.json` 을 만들고, 그 파일이 배포됩니다.

### 무료 플랜 한도

| 항목 | 한도 | 확인 |
|---|---|---|
| 동시 접속 | 100 연결 | 관리자 설정의 최대 동시 접속자 |
| DB 다운로드 | 10 GB/월 (넘기면 그 달 말까지 DB 가 꺼집니다) | `node tools/usage.mjs` |
| DB 저장 | 1 GB | 관리자 페이지의 로그 정리 |
| 호스팅 전송 | 10 GB/월 | Firebase 콘솔 |

### 문제 해결

- **로그인은 되는데 아무것도 안 됨**: 규칙이 배포됐는지(`npm run deploy:rules`), 가입이 승인됐는지, 이용 시간 차단이 켜져 있는 시간인지 확인합니다.
- **"Firebase 설정이 없습니다"**: `.env.local` 값을 확인하고 개발 서버를 다시 시작합니다.
- **비밀번호를 잊음**: `node tools/admin-cli.mjs reset-password <아이디> <새비밀번호>`
- **나간 사람의 캐릭터가 남아 있음**: 최대 2분 안에 자동으로 정리됩니다.

## 라이선스

[MIT](LICENSE) © 2026 hamawa
