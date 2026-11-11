// 배포용 보안 규칙 만들기: database.rules.json (원본) → database.rules.deploy.json (실제로 배포·에뮬레이터가 쓰는 파일. git 에는 올리지 않는다)
//
// 원본 규칙의 "로그인했는가(auth != null)" 조건을 모두 "지금 이용할 수 있는 사람인가"로 바꿔 넣는다.
//   전체 조건 FULL : 관리자이거나, (가입이 승인됐고 그리고 이용 시간)      ← 게임의 모든 경로
//   시간 조건 TIME : 관리자이거나, 이용 시간                                ← 가입 신청에 필요한 경로 (내 프로필·아이디·닉네임·신청서, 내 승인 표시 지우기)
//   그대로   NONE : 로그인만                                                ← 내가 관리자인지·승인됐는지 읽기 (화면이 어떤 안내를 띄울지 정하는 데 쓴다)
// 이용 시간 = 평일(월~금) 09:00~18:00 KST 가 아닐 때, 그 안의 쉬는 시간(hours.json)일 때, 또는 공휴일(holidays/{KST 날짜 번호} 가 있을 때). 판정은 서버 시각(now)으로 한다.
// 시간 차단은 관리자 설정 config/hoursBlock 이 true 일 때만 건다 (기본 꺼짐: 값이 없거나 false 면 언제나 이용 시간으로 본다). 가입 승인 조건은 설정과 무관하게 늘 건다.
//
// 공휴일은 holidays.json 하나로 관리한다. 이 스크립트가 DB 에 올릴 holidays.deploy.json 도 같이 만든다 (npm run deploy:holidays 가 올린다).
// 규칙 시험용 database.rules.test.json 도 만든다: 조건식은 같고, 시각만 now 대신 _test/now 에서 읽는다 (tests/rules-gate.test.mjs 가 시각을 넣어 본다).
// 원본(database.rules.json)은 손으로 고치는 파일이고 이 스크립트는 건드리지 않는다. 사용: node tools/gen-gate.cjs
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8'));
const holidays = JSON.parse(fs.readFileSync(path.join(ROOT, 'holidays.json'), 'utf8'));
// 쉬는 시간(hours.json): 평일 09:00~18:00 차단 중에도 풀어 주는 구간. 화면(src/shared/hours.ts)도 같은 파일을 읽는다
const breaks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hours.json'), 'utf8')).breaks.map(([a, b]) => {
  const toMs = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s); if (!m) { console.error(`hours.json 형식 오류: "${s}"`); process.exit(1); } return (+m[1] * 60 + +m[2]) * 60000; };
  const s = toMs(a), e = toMs(b);
  if (!(s < e) || s < 32400000 || e > 64800000) { console.error(`hours.json: 쉬는 시간이 잘못됐습니다 "${a}"~"${b}"`); process.exit(1); }
  return [s, e];
});

const AUTH = 'auth != null';
function gates(NOW) {
  const T = `(${NOW} + 32400000)`;                                   // KST 시각
  const MS = `${T} % 86400000`;                                      // 자정부터 지난 ms
  const DAY = `((${T} - ${MS}) / 86400000)`;                         // KST 날짜 번호 (1970-01-01 = 0, 목요일)
  // 주말은 (날짜+4)%7 이 0=일 또는 6=토
  // 차단 설정이 꺼져 있거나(config/hoursBlock != true), 09:00 전이거나 18:00 이후이거나, 쉬는 시간이거나, 주말이거나, 공휴일
  const BREAK = breaks.map(([s, e]) => ` || (${MS} >= ${s} && ${MS} < ${e})`).join('');             // 쉬는 시간
  const OPEN = `(root.child('config/hoursBlock').val() != true || ${MS} < 32400000 || ${MS} >= 64800000${BREAK} || ((${DAY} + 4) % 7) % 6 == 0 || root.child('holidays/' + ${DAY}).exists())`;
  const ADMIN = `root.child('admins/' + auth.uid).val() === true`;
  const APPROVED = `root.child('approved/' + auth.uid).val() === true`;
  return {
    FULL: `(${AUTH} && (${ADMIN} || (${APPROVED} && ${OPEN})))`,
    TIME: `(${AUTH} && (${ADMIN} || ${OPEN}))`,
    NONE: AUTH,
  };
}

// 경로별 조건 종류. 여기 없는 경로는 모두 FULL
function classOf(p, key) {
  const at = p.join('/');
  if (at === 'admins/$uid') return 'NONE';
  if (at === 'approved/$uid') return key === '.read' ? 'NONE' : 'TIME';
  if (p[0] === 'signups') return 'TIME';
  if (at === 'users/$uid' || at === 'ids/$key' || at === 'nicknames/$key') return 'TIME';
  return 'FULL';
}

const stats = { FULL: 0, TIME: 0, NONE: 0 };
const noAuth = [];
function build(node, p, G, count) {
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) { out[k] = build(v, [...p, k], G, count); continue; }
    if ((k === '.read' || k === '.write') && typeof v === 'string') {
      const cls = classOf(p, k);
      if (!v.includes(AUTH)) { if (count) noAuth.push(`${p.join('/')} ${k}: ${v}`); out[k] = v; continue; }
      if (count) stats[cls] += v.split(AUTH).length - 1;
      out[k] = v.split(AUTH).join(G[cls]);
      continue;
    }
    out[k] = v;
  }
  return out;
}

const deploy = { rules: build(src.rules, [], gates('now'), true) };
// 로그인 조건 없이 열려 있는 읽기·쓰기 규칙이 있으면 차단을 비켜 가므로 멈춘다 (false 로 닫힌 것은 괜찮다).
// 일부러 열어 둔 것: config/hoursBlock 읽기 (차단 설정 여부. 로그인 전의 가입·로그인 화면이 읽는다)
const PUBLIC = new Set(['config/hoursBlock .read: true']);
const open = noAuth.filter((s) => !/: false$/.test(s) && !PUBLIC.has(s));
if (open.length) { console.error('로그인 조건이 없는 규칙이 있습니다 (차단이 걸리지 않음):\n  ' + open.join('\n  ')); process.exit(1); }

const test = { rules: build(src.rules, [], gates(`root.child('_test/now').val()`), false) };
test.rules._test = { '.read': true, '.write': true };

// 공휴일: "YYYY-MM-DD" → KST 날짜 번호
const hol = {};
for (const [k, name] of Object.entries(holidays)) {
  if (k.startsWith('_')) continue;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
  if (!m || typeof name !== 'string') { console.error(`holidays.json 형식 오류: "${k}"`); process.exit(1); }
  const day = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000;
  if (new Date(day * 86400000).toISOString().slice(0, 10) !== k) { console.error(`holidays.json 에 없는 날짜: "${k}"`); process.exit(1); }
  hol[day] = `${k} ${name}`;
}

const write = (f, o) => fs.writeFileSync(path.join(ROOT, f), JSON.stringify(o, null, 1) + '\n');
write('database.rules.deploy.json', deploy);
write('database.rules.test.json', test);
write('holidays.deploy.json', hol);
const size = fs.statSync(path.join(ROOT, 'database.rules.deploy.json')).size;
console.log(`규칙 생성: 전체 조건 ${stats.FULL}곳, 시간 조건 ${stats.TIME}곳, 그대로 ${stats.NONE}곳 · ${(size / 1024).toFixed(0)}KB · 공휴일 ${Object.keys(hol).length}일`);
