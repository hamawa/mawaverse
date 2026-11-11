# MawaVerse — 작업 메모 (Claude Code 용)

작은 모임용 2D 픽셀 메타버스. 서버 코드 없이 브라우저 + Firebase 로 동작하며 Firebase Spark(무료) 플랜을 전제로 한다. 기능 명세는 SPEC.md, 설치·운영은 README.md.

- 운영 주소: https://mawaverse.web.app (Firebase 프로젝트 `mawaverse`, DB 는 asia-southeast1)
- 저장소: GitHub `hamawa/mawaverse` (공개, MIT)

## 작업 원칙
- 사용자가 요청한 것만 바꾼다. 요청하지 않은 리팩터링·개선·디자인 변경·라이브러리 업그레이드는 하지 않는다. 고치고 싶은 것을 발견하면 고치지 말고 알린다.
- 게임 규칙·맵·아이템·밸런스·문구·화면 구성은 요청 없이 건드리지 않는다.
- UI 문구는 한국어.
- **커밋 작성자**: 이 저장소의 커밋은 각자 자기 개인 GitHub 계정으로 남긴다. 새로 clone 한 폴더에는 작성자 설정이 없어서 그대로 커밋하면 PC 의 전역 git 설정(다른 이름·이메일)이 공개 저장소에 들어간다. clone 직후, 첫 커밋 전에 그 폴더에서 작성자를 설정하고, 커밋하기 전에 `git var GIT_AUTHOR_IDENT` 로 확인할 것. 전역 설정은 건드리지 않는다.
  - 저장소 주인(hamawa)의 PC 에서만: `git config user.name "hamawa"` 와 `git config user.email "191250974+hamawa@users.noreply.github.com"`.
  - 다른 기여자는 hamawa 로 설정하지 않는다. 자기 GitHub 아이디와 자기 noreply 이메일(GitHub 설정 > Emails 에 나오는 `숫자+아이디@users.noreply.github.com`)을 쓴다. 누구의 PC 인지 모르면 설정하기 전에 사용자에게 물을 것.

## 반드시 지킬 규칙
- **이용 시간**: 관리자 페이지 설정의 "평일 근무시간 이용 차단"(`config/hoursBlock`)을 켜면 평일(월~금) 09:00~18:00 KST 에는 이용할 수 없다. 단 쉬는 시간(10:30~10:45, 12:00~13:00, 15:30~15:45)에는 풀린다. 주말과 공휴일은 종일 허용. 관리자(`admins/{uid}`)는 게임·관리자 페이지 모두 예외. 기본값은 꺼짐(값이 없거나 false 면 언제나 이용 가능)이고, 아래 내용은 켜져 있을 때의 동작이다.
  - 설정값 `config/hoursBlock` 만은 로그인 전에도 읽을 수 있다(가입·로그인 화면이 미리 알아야 한다). 쓰기는 관리자만. 게임 화면은 이 칸을 따로 구독하므로(`world.ts`), 관리자가 켜면 접속 중인 일반 사용자에게 바로 적용된다.
  - 판정은 서버가 한다: 보안 규칙이 서버 시각(`now`)으로 막는다(`tools/gen-gate.cjs` 가 넣는 조건). 화면 쪽(`src/shared/hours.ts`)은 안내와 타이머용이고 `serverNow()` 를 쓴다. 기기 시계로 판정하는 코드를 만들지 말 것.
  - 차단이 시작되기 5분 전(08:55, 그리고 쉬는 시간이 끝나기 5분 전인 10:40·12:55·15:40)에 접속자에게 "5분 뒤 이용 시간이 종료됩니다" 안내(그 사이에 들어온 사람에게도), 차단 시각(09:00, 10:45, 13:00, 15:45)에 일반 사용자를 내보내고 차단 안내 화면을 띄운다(`world.ts checkHours`, `main.ts showBlocked`). 화면은 차단 시각 3초 전에 내보낸다: 그 시각이 지나면 규칙이 퇴장 처리(접속 표시·자리 지우기)까지 막기 때문이다. 풀리는 쪽(쉬는 시간 시작, 18:00)은 당기지 않는다.
  - **쉬는 시간**은 `hours.json`(루트) 하나로 관리한다. 화면은 `src/shared/schedule.ts` 가 읽어 `hours.ts` 의 판정 함수에 넘기고, 규칙은 `tools/gen-gate.cjs` 가 같은 파일로 조건식을 만든다. 쉬는 시간을 바꾸면 차단 안내 문구(`blockMessage`)에도 자동으로 반영된다. 09:00·18:00 자체는 `hours.ts` 와 `gen-gate.cjs` 양쪽의 상수다(바꾸면 둘 다, 그리고 안내 문구도).
  - 차단 시간에도 로그인 화면은 보인다(관리자가 로그인해야 하므로). 일반 사용자는 로그인 직후 차단 안내가 뜨고 로그아웃된다. 가입 신청도 받지 않는다.
- **공휴일**: `holidays.json`(루트) 하나로 관리한다. `tools/gen-gate.cjs` 가 이를 `holidays.deploy.json`(KST 날짜 번호 → 이름)으로 바꾸고 배포 때 DB `holidays/` 에 올린다. 규칙은 DB 의 `holidays/{날짜 번호}` 를, 화면은 번들에 든 `holidays.json` 을 본다. 해가 바뀌기 전에 다음 해 날짜를 채울 것.
- **가입 승인**: 가입하면 프로필(`users`)·아이디(`ids`)·닉네임(`nicknames`)과 신청서(`signups/{uid}`: 실명 name, 가입 사유 reason, 시각 at)가 만들어지고, 관리자가 관리자 페이지의 가입 승인 탭에서 `approved/{uid}` 를 true 로 쓰기 전에는 대기 화면만 보인다. 규칙도 승인되지 않은 계정의 게임 경로 접근을 전부 막는다.
- **실명은 관리자만 본다**: 실명과 가입 사유는 `signups` 에만 둔다(관리자와 본인만 읽을 수 있다). `users`·`players` 등 다른 사용자에게 내려가는 데이터에 실명을 넣지 말 것. 게임 안에는 닉네임만 보인다.
- **거절·탈퇴**: 거절하면 관리자 화면이 신청서·승인 표시·프로필·아이디·닉네임을 바로 지운다(`admin/main.ts deleteUserData`). 로그인 계정 껍데기는 그 사람이 다음에 로그인할 때 스스로 지워진다(`main.ts enter` → `dropOrphanAccount`). 탈퇴는 본인이 내 메뉴 또는 대기 화면에서 한다(`auth.ts withdraw`: 비밀번호 재확인 → 내 정보 삭제 → 로그인 계정 삭제). 개인정보를 담는 경로를 새로 만들면 이 두 곳과 `tools/admin-cli.mjs delete-user` 에서도 지울 것.
- 비밀번호는 Firebase 인증이 해시로 보관한다. 앱은 비밀번호를 저장하지 않는다.

## 기술 스택과 구조
- Vite + TypeScript + Canvas 2D. Firebase Authentication(이메일/비밀번호. 아이디는 해시한 가짜 이메일로 바뀐다), Realtime Database, Hosting.
- `src/main.ts` 게임 진입(로그인·승인·차단 분기), `src/admin/main.ts` 관리자 대시보드(admin.html), `src/dev/main.ts` 그래픽 미리보기(dev.html, Firebase 불필요)
- `src/game/world.ts` 월드 오케스트레이터(이동, 메뉴, 상호작용). `net.ts` presence/위치 동기화, `chat.ts`, `rooms.ts`(커피 내기), `board.ts`+`boardui.ts`, `fishing.ts`+`fishui.ts`(낚시, 데이터는 `src/shared/fish.ts`), `wallet.ts`+`shopui.ts`+`cosmetics.ts`(코인·상점·꾸미기, 품목은 `src/shared/shop.ts`), `contest.ts`(낚시 대회, 일정 계산은 `src/shared/contest.ts`), `bugs.ts`(곤충 채집, 데이터는 `src/shared/bugs.ts`; 물고기·곤충 공용 로직은 `src/shared/collection.ts`), `toss.ts`(말랑이 던지기), `moleui.ts`(두더지 잡기 오락기), `dig.ts`+`digui.ts`(보물 지도), `rouletteui.ts`(하루 룰렛, 칸은 `src/shared/roulette.ts`), `casino.ts`+`casinoui.ts`(경마, 규칙 검증 설계는 `src/shared/casino.ts`), `mafia.ts`+`mafiaui.ts`(마피아, 상수·집계는 `src/shared/mafia.ts`), `pets.ts`(펫 따라다니기·탑승 그리기), `petride.ts`(펫 레벨·탑승·상시 효과), `catchlog.ts`(내 낚시·채집 기록), `ui.ts`(DOM HUD/모달/로그인·가입 폼), `render.ts`(캔버스), `engine.ts`(카메라/루프), `input.ts`
- `src/game/map.ts` 맵 데이터/기본 맵·포탈 정원 빌더, `portal.ts` 포탈·맵 전환에 쓰는 순수 함수, `tiles.ts` 타일 아트, `sprites/*` 캐릭터 생성기(150 프리셋)
- `src/firebase/*` 초기화/인증 헬퍼(가입·승인 확인·탈퇴), `src/shared/*` 타입/설정/유틸, `src/shared/hours.ts` 이용 시간 판정(순수 함수), `src/shared/schedule.ts` 공휴일·쉬는 시간 설정 읽기, `src/shared/maps.ts` 맵 id·자리 키
- `database.rules.json` 보안 규칙 원본 (서버 코드 없음: 모든 검증은 여기서). `tools/gen-gate.cjs` 가 여기에 승인·이용 시간 조건을 넣어 `database.rules.deploy.json` 을 만들고, 배포와 에뮬레이터는 그 파일을 쓴다(`firebase.json`). 생성된 파일(`database.rules.deploy.json`, `database.rules.test.json`, `holidays.deploy.json`)은 git 에 올리지 않는다.
- `tools/admin-cli.mjs` firebase-admin CLI (serviceAccount.json 필요), `tools/gen-rules.cjs` 지갑 규칙 생성기, `tools/usage.mjs` 사용량 점검
- `tests/hours.test.mjs` 이용 시간 판정 테스트, `tests/portals.test.mjs`·`tests/maps.test.mjs`·`tests/portal-runtime.test.mjs` 맵 id·포탈·맵 전환 테스트(`resolve-hook.mjs` 로 TS 소스를 바로 불러온다), `tests/rules-gate.test.mjs` 보안 규칙 테스트(에뮬레이터)

## 명령
- `npm run dev`, `npm run build`, `npm run typecheck`
- `npm test`: 이용 시간 판정과 맵·포탈 테스트(Node 내장 테스트. 시각을 넣어 본다). `npm run test:rules`: 에뮬레이터에서 승인·실명 보호·시간 차단·맵별 자리 규칙 시험(Java 와 firebase-tools 필요). 배포 작업은 `npm test` 만 돌리므로 규칙을 고쳤으면 `test:rules` 를 직접 돌릴 것. 시험용 규칙은 시각만 `_test/now` 에서 읽는다.
- `npm run rules`: 배포용 규칙과 공휴일 목록 생성. `npm run emulators`: 로컬 에뮬레이터(Auth 9099, DB 9000, UI 4000. `.env.local` 에 `VITE_USE_EMULATOR=1`).
- `npm run deploy`, `npm run deploy:rules`: 수동 배포(평소에는 쓰지 않는다. 아래 배포 구조 참고).
- Git Bash 에서 `firebase database:set /경로` 처럼 `/` 로 시작하는 인자를 넘길 때는 `MSYS_NO_PATHCONV=1` 을 앞에 붙인다(경로가 윈도우 경로로 바뀐다).
- 사용량 점검은 `node tools/usage.mjs`(Spark 한도 대비 이달 다운로드·저장·접속·호스팅, 일별·시간별). `window <시작ISO> <끝ISO> <초>` 로 구간을 분 단위로 본다. 서비스 계정은 모니터링 권한이 없어 firebase CLI 로그인 토큰을 쓴다. 실시간으로 어느 경로가 먹는지는 `npx firebase database:profile --duration 60 --raw -o <파일>`. 다운로드 한도(10GB/월)를 넘기면 그 달 말까지 DB 가 꺼진다. 프로파일러도 연산 하나마다 약 450B 를 내려받으니 짧게 돌릴 것. 프로파일의 client 에는 IP 만 있어 같은 IP 의 접속끼리는 구분되지 않는다(경로의 uid 나 연산 종류로 가려낸다). Claude 브라우저 pane 의 접속은 userAgentString 에 `Claude/` 가 들어 있어 그걸로 추릴 수 있다.

## 배포 구조
- GitHub `main` 에 push → GitHub Actions(`.github/workflows/deploy.yml`)가 `npm ci` → `npm test` → `npm run build` → `npm run rules` → Firebase 배포(호스팅 + 보안 규칙) → 공휴일 목록을 DB `holidays/` 에 올린다.
- 필요한 값은 저장소 Secrets 에 있다: `FIREBASE_SERVICE_ACCOUNT`(배포용 서비스 계정 키), `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. 값은 Firebase 콘솔 > 프로젝트 설정에서 다시 확인할 수 있다. 저장소에는 비밀값을 넣지 않는다(`.env.local`, `serviceAccount*.json` 은 `.gitignore`).
- 데이터는 전부 Firebase(인증·Realtime Database)에 있다. 로컬에만 있는 데이터는 없다.
- 옛 클라이언트가 못 쓰게 되는 변경(규칙·지갑 형식 등)을 배포할 때: `CLIENT_VERSION`(shared/config.ts)을 올리고, 배포가 끝난 뒤 `config/minVersion` 을 같은 값으로 올린다(관리자 설정 또는 admin SDK). 그러면 열려 있던 클라이언트가 스스로 새로고침한다. 점검 모드로 내보내면 그 페이지에서 다시 로그인해 옛 코드로 들어오므로 그 방법은 쓰지 말 것.

## 기술 메모 (지켜야 할 관례)
- 아이디→이메일, 비밀번호→키 파생은 `src/firebase/auth.ts` 와 `tools/admin-cli.mjs` 가 동일해야 함.
- DB 키에 사용자 입력을 쓸 때는 `safeKey()` 사용.
- 위치 동기화 페이로드는 짧은 키(n,a,x,y,d,...) 유지. 다운로드 10GB/월 한도 때문.
- presence 정리는 서버의 onDisconnect 와 45초 하트비트(`players/{uid}/hb`) + 2분 stale 정리에 맡긴다. `beforeunload` 에서 `net.leave()` 를 부르면 안 된다: 탭이 닫히는 중에 onDisconnect 취소만 전달되고 삭제는 유실되어 유령 캐릭터가 남는다(2026-11-02 실제 발생).
- Firebase 트랜잭션으로 "값이 X일 때만 삭제"를 하려면 로컬 캐시가 비어 있을 때(null) undefined 를 반환하면 서버에 묻지 않고 중단된다. get() 후 remove() 또는 null 일 때도 값을 반환하는 방식으로.
- 물고기 목록은 DB `fish/defs` 가 우선(관리자가 수정), 비어 있으면 `DEFAULT_FISH`. 게임 코드는 상수 대신 `fishDefs()/activeFish()/fishById()` 를 쓴다.
- 모바일 이동은 왼쪽 아래 조이스틱 `#joy`(ui.ts buildMobile). 화면을 4분할해 누르는 방식은 써 보니 불편해서 뺐다(2026-11-03). 캐릭터 톡 치기 메뉴는 world.ts 의 캔버스 터치 리스너.
- 물고기·곤충 기본 목록(`DEFAULT_FISH`/`DEFAULT_BUGS`)에 새 종류의 값(예: 시간대 `contest`)을 넣으면 `database.rules.json` 의 `fish/defs`·`bug/defs` 검증도 같이 고친다. 안 그러면 관리자 화면의 첫 저장(기본 목록을 DB 로 복사)이 통째로 PERMISSION_DENIED 가 된다(2026-11-05 실제 발생: 대회 전용 물고기 2종). 규칙은 admin SDK 의 `databaseAuthVariableOverride: { uid }` 로 실제 프로젝트에서 특정 uid 인 척 시험할 수 있다.
- 지갑·보유·착용 규칙(치팅 방지)은 `tools/gen-rules.cjs` 가 원본 `database.rules.json` 안에 만들어 넣는 긴 식이다. 직접 고치지 말고 생성기를 고친 뒤 `node tools/gen-rules.cjs sandbox` + 배포로 시험용 경로 `rtest/` 에 올리고, `node tools/rules-test.mjs` 가 전부 통과하면 `node tools/gen-rules.cjs final` 후 배포한다. 시험은 admin SDK 의 `databaseAuthVariableOverride` 로 가짜 uid 인 척 한다. 배포되는 규칙에는 승인·이용 시간 조건이 붙으므로(`gen-gate.cjs`) 시험 uid 는 `approved/` 에 있어야 하고(스크립트가 넣는다), 평일 09~18시에는 관리자가 아닌 uid 의 쓰기가 전부 거부된다는 점을 잊지 말 것.
- 규칙이 가격을 `config/prices/{id}` 에서 읽는다. 상점 품목을 새로 추가하면 관리자 설정을 한 번 저장하거나 admin SDK 로 그 가격을 넣어야 살 수 있다(없으면 구매 쓰기가 거부됨).
- 지갑 쓰기 형식을 지켜야 한다: 획득은 `WalletMgr.earn`(금액 제한 없음. 10분 창 상한 wt/we·신화 md 분기는 2026-11-10 에 없앴고 옛 칸은 earn 이 지운다), 사용은 `spend(품목 id, 가격)`(b 기록, 선물이면 gt 에 받는 uid). 펫 먹이는 `feedPet(펫, 기본가, 개수)`(b='petfood', pp, px/{펫}; 금액은 트랜잭션 안에서 `foodCost(기본가, 먹은 수, 개수)` 로 정한다. 먹을수록 비싸지는 폭 `PET_FOOD_STEP` 은 shop.ts 와 gen-rules.cjs 양쪽에 같은 값), 주문서는 `buyScrolls`(es), 강화는 `enhanceRod`(es −1 과 함께만 rs 변경) → 실패면 `breakRod`. 지갑을 직접 쓰는 새 코드를 만들지 말 것. 보관함 품목을 새로 만들면 `isOwnItem`(kind !== 'fish')에 걸리는지 확인하고, 자동 버프 품목 id 는 `autoreel*`/`autobug*` 접두사를 유지(규칙이 beginsWith 로 본다).
- 이동·밀림 처리는 화면 갱신(rAF)에 묶여 있다. 뒤쪽 탭에서도 돌아야 하는 로직은 `world.framesStalled()` 를 보고 즉시 처리하거나(밀치기), 워커 타이머(자동 낚시)를 쓴다.
- 키 입력과 모바일 버튼은 `isTrusted` 가 아니면 무시한다. 브라우저 자동화로 시험할 때는 실제 입력(CDP)으로 눌러야 한다.
- 밀치기(push)·끌기(pull)·관리자 이동(tp)은 모두 `players/{상대}/…` 에 잠깐 쓰고 받는 쪽 클라이언트가 검증 후 스스로 움직이는 방식. 새 상호작용을 만들 때도 이 패턴(받는 쪽이 보낸 사람의 위치·방향·보유를 확인)을 따를 것. 끌기는 내 걸음이 서버에 반영된 뒤(`startStep` 의 `onDone`) 보내야 상대가 내 옛 자리의 점유를 얻는다.
- 라이브 맵은 관리자 편집본 `maps/custom1`(`config/activeMap`)이다. `buildDefaultMap` 을 고쳐도 라이브에는 반영되지 않으니, 맵 구조를 바꿀 때는 admin SDK 로 그 맵의 해당 영역·zone 을 덧씌우고 `updatedAt` 을 올려야 한다(안 올리면 브라우저에 둔 사본이 계속 쓰인다. 2026-11-09 커피 거리 개편 때 `buildCoffeeStreet` + 스크래치 patch-map.cjs 로 함. `npx tsc src/game/map.ts src/shared/hash.ts --outDir <임시> --module commonjs --target es2022 --ignoreConfig` 로 CJS 로 컴파일해 Node 에서 불렀다).
- 코인이 오가는 새 놀이(카지노 등)는 결과를 서버 타임스탬프에서 뽑고(`at == now` 규칙), 지갑 쓰기 한 번으로 정산하며 규칙이 금액을 그 노드와 대조하는 패턴을 따른다(`shared/casino.ts` 머리말). 지갑에 새 칸을 넣으면 `noSpend`·`buyBait`·`buyOne` 에 "안 바뀜" 조건을 꼭 추가할 것(다른 구매에 끼워 넣는 치팅 방지).
- 내 클라이언트가 serverTimestamp 로 쓴 값은 onValue 에 로컬 추정값 → 서버값 두 번 온다. "한 번만" 처리하는 키로 그 값을 쓰지 말 것(마피아 종료 보상이 두 번 지급된 적 있음, 2026-11-09).
- 관리자 코인 지급·회수는 `src/admin/main.ts` 의 `grantCoins`(사용자 탭). 지갑 규칙의 관리자 예외와 `gf` 칸(관리자만 변경, 받는 쪽 알림용)에 기대고 있으니 규칙 생성기를 고칠 때 이 예외를 빼지 말 것.
- 등급은 0~4(신화 4, `MYTHIC`). 등급별 배열(`RARITY_*`, `REACT_MS`, `CATCH_CHANCE`)은 다섯 칸이어야 하고, 규칙 `fish/defs`·`bug/defs` 의 rarity ≤ 4 도 같이 본다. 신화는 `collection.pick` 이 장비·미끼 배수 전에 따로 굴리므로 새 배수 옵션을 넣어도 신화에는 안 붙는다. 신화 1000 코인도 보통 `earn` 으로 준다(2026-11-10 상한 삭제). 라이브 `fish/defs` 는 DB 가 우선이라 기본 목록에 종을 추가해도 admin SDK 로 DB 에 넣어야 나온다(곤충은 DB 가 비어 있어 기본 목록이 바로 쓰임).
- 뒤쪽 탭·복귀 직후에는 `Net.quiet()` 가 true 라 유령 정리와 입퇴장 알림이 멈춘다. 복귀 직후 DB 캐시가 옛것일 수 있으니 "캐시 값 vs 현재 시각" 으로 판단하는 로직을 새로 만들면 같은 보호를 넣을 것. 토스트는 동시에 3개·복귀 때 만료분 삭제(ui.ts). 폰에서 다른 앱에 갔다 오면 타이머가 멈춰 있었다는 점을 잊지 말 것.
- `stats` 는 관리자만 읽을 수 있다. 일반 클라이언트가 그 아래에 트랜잭션을 걸면 리슨부터 거부된다. 최대 동시 접속(`stats/{날짜}/peak`)은 `Net.recordPeak` 가 내가 오늘 써 본 값보다 많아졌을 때만 `set` 하고, "지금 값보다 클 때만(1~100)"은 규칙이 본다(손으로 넣은 줄, 생성기와 무관). 예전엔 `players` 이벤트마다 트랜잭션을 보내 전체 연산의 58% 가 거부된 요청이었다(2026-11-10). `players` 이벤트는 누가 한 걸음 걸을 때마다 오니, 그 콜백에서 DB 요청을 보내는 코드를 만들지 말 것.
- 전송량 줄이기(2026-11-10, v16). 요금은 응답 하나마다 약 85B + 내용이라 "요청 수"가 곧 비용이다. 아래를 되돌리지 말 것:
  - 걸음은 `Net.step` 이 쓰기 한 번으로 보낸다(`occ/새칸`=내 uid, `occ/옛칸`=null, `players/{uid}/x·y·d`). 자리 겹침은 `occ` 규칙이 막는다: 비었거나, 내 것이거나, 적힌 사람이 접속해 있지 않거나 실제로는 다른 칸에 있거나(찌꺼기), 마피아 진행 중 유령과 산 사람 사이일 때만 허용. occ 에 트랜잭션을 다시 걸지 말 것(한 걸음에 왕복 5번이었다). 입장·재등록(`join`/`reclaim`)도 자리와 presence 를 한 번에 쓴다(따로 쓰면 그 사이에 자리를 뺏길 수 있다).
  - 방향은 걸음에 실려 간다. `net.setDir` 는 걸음이 안 나갈 때(돌아서기만, 막힘, 걸음 거부)만 부른다.
  - 자동 낚시 중에는 찌(`players/{uid}/f`)를 잡을 때마다 다시 쓰지 않는다(`Fishing.shown`/`show()`). 자리를 뜨면 `cancel()` 이나 `autoTick` 이 거둔다. 낚시를 멈추게 하는 새 경로를 만들면 `fishing.cancel()` 을 `active` 확인 없이 부를 것.
  - 잡을 때 내 기록을 다시 읽지 않는다: 도감 칸은 `readOwn/rememberOwn/forgetOwn`(firebase/db.ts), 주간·대회 점수는 `increment`, 최고 기록 트랜잭션은 `bestSeen` 보다 클 때만.
  - 통계는 `Net.stat` 이 모아 1분에 한 번 보낸다. 채팅·소식처럼 "지금부터 새 것만" 받는 리스너는 `onNewChild(path, since, n, cb)` 를 쓴다(`startAt(지금)` 만 걸면 재접속할 때마다 그 뒤 전부를 다시 받는다).
  - 맵은 `maps/{id}/updatedAt` 이 브라우저 사본(localStorage `mv-map-{id}`)과 같으면 내려받지 않는다. 맵을 admin SDK 로 고칠 때 `updatedAt` 을 꼭 올릴 것(관리자 편집기는 알아서 올린다).
- 포탈·여러 맵(2026-11-11, v17). 아래를 지킬 것:
  - 맵 id 는 논리 id 다(`shared/maps.ts`, `portal.ts mapSource`): 기본 맵은 `main`(실제 데이터는 `config/activeMap` 이 가리키는 맵이고 `MapData.id` 와 다르다), 포탈 정원 `portal-garden` 은 코드에 든 맵(`buildPortalGarden`), 그 밖의 id 는 저장된 `maps/{id}`. 기본 맵으로 가는 포탈의 목적지는 반드시 `main`: 활성 맵의 실제 id(`custom1`)를 적으면 서로 안 보이는 별개 공간이 생긴다.
  - 맵은 기본 맵일 때 싣지 않는다(옛 형식과 같게, 전송량): presence `players/{uid}/m`, 공개 채팅 `m`, `users/{uid}/lastPos.m`. 읽을 때는 `playerMapId()` / `w.onMyMap(st)`. 내가 있는 맵은 `w.mapId`·`w.map`, 기본 맵은 `w.mainMap`.
  - 자리 키는 `occupancyKey(mapId, x, y)` 로만 만든다: 기본 맵 `x_y`, 그 밖 `{맵 id}~x_y`. 규칙이 키를 내 presence 의 맵·좌표와 대조하고(`.validate`), 삭제도 본다(`.write`): 비었거나, 내 것이거나, 적힌 사람이 접속해 있지 않거나 실제로는 다른 칸에 있거나, 마피아 유령과 산 사람이 겹친 자리일 때만. 남의 자리를 지우는 쓰기는 통째로 거부되므로 `Net.ownsOcc` 가 true 일 때만 옛 칸을 같이 지운다(입장·재등록 때 자리를 못 잡았으면 false).
  - 맵 이동은 `world.usePortal` → `Net.changeMap` 이 쓰기 한 번으로 한다(`portal.ts mapSwitchUpdate`: 새 자리 + m·x·y·d + 옛 맵에 걸려 있던 f·e·push·pull·toss·tp 비우기 + 내 옛 자리). 그동안 `w.switching` 이 true 이고 이동·낚시·채집·이모트·공개 채팅을 막는다. 옛 맵에 묶인 화면 상태(벌레·말랑이·펫 자리·말풍선)는 `enterMap` 에서 비우니, 맵 좌표에 묶인 상태를 새로 만들면 거기서도 비울 것. 맵을 옮기기 전에 보낸 비동기 응답은 `mapGen` 으로 가려낸다.
  - `w.players` 에는 모든 맵의 접속자가 들어 있다. 좌표로 사람을 찾을 때는 `playerAt`/`occupied`(같은 맵만 본다)를 쓰고, `players` 를 직접 돌 때는 `onMyMap(rp.st)` 로 거른다. 밀치기·끌기·말랑이·관리자 이동은 받는 쪽이 보낸 사람이 같은 맵인지 확인하고, 규칙도 같은 맵끼리만 허용한다.
  - 기본 맵에서만 되는 것: 커피 내기 방·카지노(`primaryOnlyRoom`. 방 상태 `rooms/{zone id}` 가 맵 구분 없이 하나라서), 보물 지도, 마피아(모집·참가·미션·시체. 참가 중에는 포탈을 못 탄다). 이들의 좌표는 `w.mainMap` 기준이다. 낚시·곤충 채집은 어느 맵에서나 된다.
  - 포탈은 zone `kind: 'portal'`(`targetMap`, `targetSpawn`)이고 옆 1칸(대각선 포함)에서 F. 포탈 옆에서는 F 가 포탈을 타지만(`canvasHint`. 낚시 시작·표지판·오락기보다 앞), 직접 던진 낚시·바로 옆 벌레·삽질 중·발밑 보물 자리가 있으면 그쪽이 먼저다(`portal.ts portalYields`). F 로 하는 일을 새로 만들면 포탈 옆에서 어느 쪽이 먼저인지 여기서 정할 것. 관리자 편집기의 포탈 도구로 넣는다. 라이브 맵(`maps/custom1`)의 포탈은 정원 길 남쪽 끝(29~30, 36)에 admin SDK 로 넣은 zone 이고(2026-11-11), `buildDefaultMap` 에 든 공사 펜스는 라이브에 없다.
  - 규칙의 `players/$uid/m` 검증에 `'portal-garden'` 이 글자로 들어 있다. 코드에 든 맵을 더 만들면 규칙·`mapSource`·`isReservedMapId` 를 같이 고칠 것.
- 원본 `database.rules.json` 을 JSON 으로 읽어 다시 직렬화해 쓰지 말 것. 서식이 바뀌면 `gen-rules.cjs` 의 글자 치환이 깨진다. 손으로 넣는 규칙(occ, stats/peak, signups, approved)은 글자 치환이나 직접 편집으로 넣는다. 원본에는 "로그인했는가(`auth != null`)"만 적는다: 승인·이용 시간 조건은 `gen-gate.cjs` 가 배포용 파일을 만들 때 모든 `.read`/`.write` 에 넣는다. 로그인 조건 없이 열린 읽기·쓰기 규칙을 원본에 넣으면 차단을 비켜 가므로 생성기가 멈춘다. 새 규칙은 에뮬레이터(`npm run test:rules`)에서 가짜 uid 로 시험한다.
- 파티 기능은 2026-11-10 에 통째로 삭제했다(코드·규칙·DB). 되살리지 말 것. 관리자 채팅 로그의 옛 `p` 채널만 남는다.
- 상점 모달은 지갑이 바뀔 때마다 통째로 다시 그린다(`shopui.ts render`). 스크롤·포커스를 보존하는 코드가 있으니 새 탭·카드를 만들 때 버튼에 `data-*` 로 자리를 남기고 `render(선택자)` 로 돌려줄 것(먹이 연타가 맨 위로 튀던 일, 2026-11-10).
- 상점 소모품(kind 'use': 펫 먹이·강화 주문서)은 `isOwnItem` 에서 빠지고 지갑에만 기록된다. 새 소모품을 만들면 규칙 생성기의 `noSpend`·`buyBait`·`buyOne`·`bet` 에 "안 바뀜" 조건을 넣고 전용 구매 분기를 추가할 것. 펫 종류 목록 `PET_IDS`(shop.ts)와 생성기의 `PET_IDS` 는 같아야 한다(px 칸을 하나씩 열거해 검사).
- presence 에 `pl`(펫 누적 먹이, 규칙이 지갑 px 와 대조) 칸이 있다. 펫 효과는 종류 무관 상시(`shared/shop.ts` petSpeedMul·petCalm·petGuard, 2026-11-10 밤). Lv8 방어는 받는 쪽이 `w.petGuard()` 로 판정하고 미는 쪽은 `petGuardOf(rp.st)` 로 미리 건너뛴다(갑옷 pa/ta 와 같은 자리). 되받아치기(80%)는 `push.r`/`toss.r` 표시로 무한 핑퐁을 막는다. Q 스킬·🐾 버튼·presence sh/sk·그 규칙은 삭제했으니 되살리지 말 것(사용자: 종류별 밸런스 불가). 규칙 JSON 의 players 블록을 손으로 고칠 때 `"pt": …` 줄은 users/eq 에도 같은 문자열이 있으니 첫 일치로 치환하지 말 것(2026-11-10 에 그렇게 해서 eq 에 들어갔다가 final 생성 때 사라진 적 있음).
- 펫 탑승 그림은 `cosmetics.ts` MOUNT_ART(펫 6종 × side/front/back, 1배 픽셀, seat 줄에 캐릭터 아랫단). render.ts 가 캐릭터 다리 아래 최대 9줄을 잘라 앉힌다(수영 자르기와 같은 방식). 펫을 키운 12px 그림을 확대해 까는 방식은 도트 크기가 섞여 보여 버렸다(2026-11-10). 물속에선 탈것을 안 그린다. 새 펫을 추가하면 PET_ART 와 MOUNT_ART 둘 다.
- 마피아 미션 자리는 `TASK_DEFS[].at` 좌표(라이브 맵 기준)이고 긴급 소집은 게시판 zone. 회의 판은 `#mafia-meet` 전체 화면이라 `#hud` 가 z-index 23 으로 그 위에 있다.
- 브라우저 pane 으로 시험할 때 rAF 는 스크린샷을 찍는 순간에만 돈다(배경 탭 취급). 상태 확인은 `__mv.*` 를 직접 부르고(`mafiaHud.update()` 등) 화면은 스크린샷으로 본다. 규칙 시험 `rules-test.mjs` 를 실제 경로(PRE='')로 돌리면 `players/zz-rules-test` 를 잠깐 만들어 접속자에게 입퇴장 알림이 뜬다.
