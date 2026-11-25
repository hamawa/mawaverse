# MawaVerse

작은 모임이 함께 놀 수 있는 2D 픽셀 메타버스입니다. 브라우저에서 바로 접속해 돌아다니고, 수다 떨고, 낚시하고, 내기를 합니다.
서버 코드 없이 브라우저와 Firebase(Realtime Database 보안 규칙)만으로 동작하며, Firebase 무료(Spark) 플랜으로 운영할 수 있게 만들었습니다.

- 운영 주소: https://mawaverse.web.app
- 기능 명세: [SPEC.md](SPEC.md)
- 라이선스: [MIT](LICENSE)

## 주요 기능

- **마을**: 타일 단위 이동, 캐릭터 161종, 채팅·귓속말, 이모트, 밀치기·끌기, 말랑이 던지기
- **놀거리**: 낚시와 도감·주간 순위·낚시 대회, 곤충 채집, 경마, 슬롯·홀짝, 인디언 포커, 주사위 대결, 낚시 내기, 금광 채광, 겨울 얼음 낚시와 눈싸움, 마피아, 두더지 잡기, 보물 지도, 하루 룰렛, 게시판
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

### 경마공원 로컬 시험 (에뮬레이터)

마권 구매부터 추첨·결과 공개, 적중금 수령까지 실제 프로젝트 없이 내 PC 에서 해 봅니다. 늘 켜 두는 운영 프로그램은 없습니다(마감 뒤 게임 화면이 추첨하고 결과를 공개합니다). 위와 같이 Java 와 Firebase CLI 가 필요하고, 경주가 실제 시간(6분 주기)으로 돌아서 한 번 해 보는 데 최대 8분쯤 걸립니다.

1. `.env.local` 에 `VITE_USE_EMULATOR=1` 을 넣습니다.
2. 터미널 1: `npm run emulators` (규칙을 만들어 Auth 9099 · DB 9000 · UI 4000 에뮬레이터를 켭니다).
3. 터미널 2: `node tools/derby-emulator-seed.mjs`
   - 127.0.0.1 의 에뮬레이터에만 씁니다. 에뮬레이터가 응답하지 않으면 아무것도 쓰지 않고 멈춥니다(환경변수·`serviceAccount.json` 을 읽지 않습니다).
   - 만드는 것: 시험 플레이어 `racer` / `racer1234`(승인됨, 코인 100,000, 다음 로그인 때 경마공원 관람석 뒤 창구 앞에서 시작), 관리자 `admin` / `admin1234`, `config/raceHours`(매일 00:00~24:00 운영), `config/raceMax`(공원 100,000 · 분점 50,000. 시험용 값입니다: 설정이 없을 때의 기본값은 공원 10,000 · 분점 5,000), `config/hoursBlock` 끔, 공개 고정 자료 `raceData`, 공휴일 `holidays`, 숨은 결과표 `raceSecret`(지금 경주부터 2일치)과 그 범위 `race/cover`.
   - 경마공원에 가려고 맵을 바꾸지 않습니다: 플레이어의 시작 위치(`users/{uid}/lastPos`)만 공원 창구 앞으로 둡니다.
   - 다시 실행해도 됩니다. 플레이어의 코인과 시작 위치를 처음 값으로 되돌리고, 결과표는 덮은 범위 뒤에 잇습니다(시작 위치는 로그아웃한 상태에서 실행해야 다음 로그인에 적용됩니다).
4. 터미널 3: `npm run dev` → http://localhost:5173 에서 `racer` / `racer1234` 로 로그인합니다. 경마공원 창구 앞에서 시작합니다(공원을 나갔다면 3번을 다시 실행하고 다시 로그인).
5. 창구 옆에서 **F 마권 구매**를 누릅니다. 판 위쪽이 "발매 중"이면 승식과 마번을 골라 배율을 보고, 금액을 입력한 뒤 **즉시 구매**를 누릅니다. 코인이 빠지고 "내 마권"에 "발매됨"으로 보입니다. 마감(주기 4:00) 뒤에는 "발매 마감 · 경주 중", 결승 뒤 공개 전에는 "결과 집계 중"입니다.
6. 마감 직후 공원에 있는 화면(이 화면)이 추첨을 쓰고 숨은 결과표를 물어 결과를 공개합니다(개발자 도구 콘솔에 `race/q/...` 거부 경고가 20개쯤 보이는 것이 정상입니다). 결승(주기 4:40)이 지나면 판이 "결과 확정"과 확정 착순을 보이고, 맞힌 마권의 적중금이 자동으로 들어옵니다(그 전에는 "발매 마감 · 경주 중"입니다. "제n경주 적중! 💰 …" 안내, 마권은 "적중 +…" / "낙첨"). 마감 전에 로그아웃했다면 다음 로그인 때 그 화면이 추첨·공개하고 받습니다.
7. 경마분점: 로그아웃한 뒤 `node tools/derby-emulator-seed.mjs --branch` 를 실행하고 다시 로그인하면 광장 커피 거리의 경마분점(옛 경마장 건물) 문 앞에서 시작합니다. 위로 한 칸 걸어 들어가면 자리에 앉고, 분점 판(미니 중계 · 🚪 나가기)이 뜹니다. 같은 경주를 살 수 있고 한 경주 합계는 분점 한도 50,000 이며 공원에서 산 금액과 합쳐 봅니다(5번에서 산 금액만큼 덜 살 수 있습니다). 마감 뒤 추첨·공개·적중금은 6번과 같고, 분점에 앉아 있는 화면이 합니다.

같은 흐름을 자동으로 확인하려면 1~3번 뒤(2번 에뮬레이터는 켜 둔 채로) `node --test tests/derby-e2e.test.mjs` 를 실행합니다. 배포 규칙·실제 지갑 코드·실제 발매 연결로 창구 앞에서 마권 19장을 사고, 광장 경마분점에 앉아 같은 경주를 분점 한도까지 더 산 뒤(한도를 넘는 구매는 막힘), 마감 뒤 그 화면의 추첨·공개, 고정 배당대로의 적중금·영수증·잔액을 확인하며, 숨은 결과표 읽기 · 마감 전 추첨 · 두 번째 추첨 · 마감 뒤 구매 · 꾸민 공개 · 부풀린 적중금이 거부되는지도 봅니다. `npm run test:rules` 는 에뮬레이터를 스스로 띄우므로 `npm run emulators` 를 끈 뒤에 실행합니다.

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

가입 알림을 쓰려면 `DISCORD_WEBHOOK_URL` 도 넣습니다(아래 "가입 알림"). 없어도 배포는 됩니다.

직접 배포하려면 `firebase login` 후 `npm run deploy` 를 실행합니다.

## 운영 참고

### 쉬는 시간

평일 차단 중에 풀어 주는 쉬는 시간은 [hours.json](hours.json) 하나로 관리합니다. `["시작", "끝"]` 을 고치고 `main` 에 push 하면 화면과 보안 규칙에 함께 반영됩니다.

### 공휴일

이용 시간 차단을 켰을 때 쓰는 공휴일 목록은 [holidays.json](holidays.json) 하나로 관리합니다. 임시공휴일이 생기면 `"YYYY-MM-DD": "이름"` 한 줄을 추가하고 `main` 에 push 하면 반영됩니다. 해가 바뀌기 전에 다음 해 날짜를 채워야 합니다.

### 경마공원 결과표 올리기

경마공원에는 늘 켜 두는 운영 PC·서버가 없습니다. 결과는 관리자가 미리 올려 둔 **숨은 결과표**(`raceSecret`, 경주마다 칸 4개)와 마감 뒤 처음 쓴 사람의 서버 시각(칸 = 시각 % 4)으로 정해지고, 게임 화면이 규칙에 물어 공개합니다(설계는 SPEC "경마공원 > 결과 추첨과 공개"). 결과표는 아무도(관리자 화면 포함) 읽을 수 없고, 규칙만 대조에 씁니다. 결과표가 덮지 않은 경주는 팔지 않으므로 **한 달에 한 번쯤** 이어 올립니다.

준비: 관리자 CLI 와 같은 `serviceAccount.json`(프로젝트 루트)과 `.env.local` 의 `VITE_FIREBASE_DATABASE_URL`.

1. 공개 고정 자료가 바뀌었을 때만(결과 계산·배당 코드를 고친 뒤): `node tools/gen-derby.mjs` → `npx firebase database:set /raceData raceData.deploy.json --force` (약 36KB).
2. 결과표 잇기: `node tools/gen-derby.mjs secret` — 지금 경주부터 35일 뒤까지 비어 있는 경주의 칸을 암호학적 난수로 만들어 바로 올리고(파일로 남기지 않습니다. 35일치 약 1.1MB), `race/cover` 를 고칩니다. 이미 덮은 경주는 건드리지 않습니다. 기간은 `--days 1~60`.
3. 1번을 했다면 대신 `node tools/gen-derby.mjs secret --replace` — 다음 경주부터 결과표를 새로 만듭니다(지금·지난 경주는 그대로. 남은 칸도 화면이 칸에 적힌 그대로 공개하므로 정산됩니다). `race/cover` 의 `f` 가 새 버전 칸의 첫 경주가 됩니다. 도구가 `raceData/v` 와 결과표 버전이 다르면 알려 주고, 버전이 다른 범위 뒤에 `--replace` 없이 이으려 하면 아무것도 올리지 않고 멈춥니다.

남은 기간은 `race/cover` 의 `e`(덮은 마지막 경주 + 1. 경주 번호 = 서버 시각 ÷ 360000)로 봅니다. 결과가 공개된 지난 경주의 칸은 정산에 쓰이지 않지만(공개된 결과가 `race/x` 에 남습니다) 지우지 않아도 됩니다(한 달 약 1MB, 아무도 내려받지 않습니다).

### 가입 알림 (디스코드)

가입 신청이 들어오면 관리자의 디스코드로 알림을 보낼 수 있습니다(선택). 늘 켜 두는 서버가 없어서 GitHub Actions([.github/workflows/signup-notify.yml](.github/workflows/signup-notify.yml))가 5분마다 승인 대기 목록을 확인합니다. GitHub 의 예약 실행은 자주 밀리므로 알림은 보통 5~20분 뒤에 옵니다.

1. 디스코드에서 알림을 받을 채널의 **채널 편집 > 연동 > 웹후크 > 새 웹후크**를 만들고 **웹후크 URL 복사**를 누릅니다. 폰이 울리게 하려면 그 채널의 알림 설정을 **모든 메시지**로 둡니다("@mentions만"이면 글은 와도 알림이 울리지 않습니다).
2. 저장소 **Settings > Secrets and variables > Actions > New repository secret** 에 이름 `DISCORD_WEBHOOK_URL`, 값은 복사한 주소로 넣습니다.
3. 다음 확인 때 "가입 알림이 연결됐습니다"라는 글이 한 번 옵니다. 바로 보려면 Actions 탭의 **Signup notify > Run workflow**.

- 알림 글에는 건수와 관리자 페이지 주소만 들어갑니다. 실명·가입 사유·닉네임은 디스코드로 나가지 않고, 도구([tools/signup-notify.mjs](tools/signup-notify.mjs))도 그 값을 읽지 않습니다.
- 신청 하나에 알림은 한 번입니다.
- `DISCORD_WEBHOOK_URL` 이 없으면 아무것도 하지 않습니다. 끄려면 그 Secret 을 지우거나 Actions 탭에서 워크플로를 Disable 합니다.
- 웹후크 주소를 아는 사람은 그 채널에 글을 쓸 수 있습니다. 저장소나 채팅에 적지 않습니다.
- 저장소에 60일 동안 활동이 없으면 GitHub 이 예약 실행을 끕니다(Actions 탭에서 다시 켭니다).
- 카카오톡으로는 보내지 못합니다: "나에게 보내기"는 알림이 울리지 않는 메모 기능입니다.

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
