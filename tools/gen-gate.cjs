// 배포용 보안 규칙 만들기: database.rules.json (원본) → database.rules.deploy.json (실제로 배포·에뮬레이터가 쓰는 파일. git 에는 올리지 않는다)
//
// 원본 규칙의 "로그인했는가(auth != null)" 조건을 모두 "지금 이용할 수 있는 사람인가"로 바꿔 넣는다.
//   전체 조건 FULL : 관리자이거나, (가입이 승인됐고 그리고 이용 시간)      ← 게임의 모든 경로
//   시간 조건 TIME : 관리자이거나, 이용 시간                                ← 가입 신청에 필요한 경로 (내 프로필·아이디·닉네임·신청서, 내 승인 표시 지우기)
//   그대로   NONE : 로그인만                                                  ← 내가 관리자인지·승인됐는지 읽기
//   경마공원 DERBY : 관리자이거나 가입이 승인됨 (이용 시간과 무관)              ← race/ 아래 (마권·추첨·공개·환급. 발매 시간은 RACE_SALE_OPEN 이 따로 본다)
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

// 규칙 크기 줄이기 (2026-11-19): 한도는 256KB 인데 이 조건이 읽기·쓰기 규칙 145곳에 하나씩 붙는다(693자 × 135곳 ≈ 94KB 였다).
//  - 식 안의 공백을 전부 없앤다 (compact: 문자열·정규식 안은 그대로). 원본 규칙의 식도 배포 파일에서는 같이 줄인다
//  - 주말 판정을 날짜 번호 대신 시각으로 한 번에 한다: (KST 시각 / 하루 + 5) % 7 < 2  (토 0~1, 일 1~2. 1970-01-01 은 목요일)
//  - 배포 파일은 들여쓰기 없이 쓴다
// 뜻은 그대로다: tests/rules-gate.test.mjs 가 시각별·요일별 허용·거부를 본다 (시험용 규칙도 같은 식으로 만든다)
function compact(expr) {
  let out = '', q = null, re = false;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (q) { out += c; if (c === '\\') out += expr[++i]; else if (c === q) q = null; continue; }
    if (re) { out += c; if (c === '\\') out += expr[++i]; else if (c === '/') re = false; continue; }
    if (c === "'" || c === '"') { q = c; out += c; continue; }
    if (c === '/' && out.endsWith('matches(')) { re = true; out += c; continue; } // 정규식은 .matches(/…/) 안에만 있다 (그 밖의 / 는 나눗셈)
    if (c !== ' ') out += c;
  }
  return out;
}
const AUTH = 'auth != null';
// 경마공원 (2026-11-23). 원본 규칙의 자리 표시를 여기서 풀어 쓴다:
//  RACE_SALE_OPEN : 지금(NOW) 경주가 운영 시간에 드는가 (shared/derby/time.ts raceScheduled 와 같은 판정). config/raceHours 의 on 이 true 이고,
//                   그날 칸(공휴일이면 7)의 [s, e) 분 안에 발매 4분 전체가 들고, 차단 설정(config/hoursBlock)이 켜져 있으면 그 4분이 모두 이용 시간일 것.
//                   쉬는 시간은 hours.json 에서 읽는다 (이어진 구간은 합쳐서 본다: 쉬는 시간이 09:00·18:00 이나 다른 쉬는 시간에 붙어 있어도 화면 판정과 같게)
//  DERBY_CLAIM_AUTH : 환급 쓰기(지갑 + 영수증)는 이용 시간 밖에도 승인된 본인이면 (지갑의 FULL 조건 대신)
const SALE_TOKEN = 'RACE_SALE_OPEN';
const RACE_CYCLE_MS = 360000, RACE_SALE_MS = 240000; // shared/derby/time.ts DERBY_CYCLE_MS · DERBY_SALE_MS
const openSpans = (() => {
  const spans = [[0, 32400000], ...breaks, [64800000, 86400000]].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of spans) { const last = out[out.length - 1]; if (last && s <= last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]); }
  return out;
})();
function raceSaleOpen(NOW) {
  const T = `((${NOW}-${NOW}%${RACE_CYCLE_MS})+32400000)`;          // 지금 경주가 시작한 KST 시각 (경주는 하루를 넘지 않는다)
  const MS = `${T}%86400000`, DAY = `((${T}-${MS})/86400000)`, MIN = `(${MS})/60000`;
  const slot = (k) => `${MIN}>=root.child('config/raceHours/d/'+${k}+'/s').val()&&${MIN}+${RACE_SALE_MS / 60000}<=root.child('config/raceHours/d/'+${k}+'/e').val()`;
  const win = openSpans.map(([s, e]) => (s === 0 ? `${MS}+${RACE_SALE_MS}<=${e}` : e >= 86400000 ? `${MS}>=${s}` : `(${MS}>=${s}&&${MS}+${RACE_SALE_MS}<=${e})`)).join('||');
  // 공휴일이면 7번 칸(차단 없음), 아니면 요일 칸 + 차단 설정이 켜져 있으면 주말이거나 발매 4분이 모두 이용 시간
  return `(root.child('config/raceHours/on').val()===true&&(root.child('holidays/'+${DAY}).exists()?${slot(7)}:(${slot(`(${DAY}+4)%7`)}&&(root.child('config/hoursBlock').val()!=true||(${T}/86400000+5)%7<2||${win}))))`;
}
function gates(NOW) {
  const T = `(${NOW}+32400000)`;                                     // KST 시각
  const MS = `${T}%86400000`;                                        // 자정부터 지난 ms
  const DAY = `(${T}-${MS})/86400000`;                               // / binds before the surrounding path-string concatenation
  // 시각 비교는 UTC 의 하루 안 ms 로 한다 (2026-11-23, 크기): KST 09:00~18:00 = UTC 00:00~09:00 이라 날을 넘지 않는다.
  //  "09:00 전이거나 18:00 이후" = UTC 09:00 이후 한 번, 쉬는 시간 [s, e) = UTC [s − 9시간, e − 9시간). 뜻은 KST 로 비교하던 때와 같다 (tests/derby-rules.test.mjs 가 대조)
  const U = `${NOW}%86400000`;
  // 차단 설정이 꺼져 있거나(config/hoursBlock != true), 09:00 전이거나 18:00 이후이거나, 쉬는 시간이거나, 주말이거나, 공휴일
  const BREAK = breaks.map(([s, e]) => `||(${U}>=${s - 32400000}&&${U}<${e - 32400000})`).join('');                      // 쉬는 시간
  const OPEN = `(root.child('config/hoursBlock').val()!=true||${U}>=32400000${BREAK}||(${T}/86400000+5)%7<2||root.child('holidays/'+${DAY}).exists())`;
  const ADMIN = `root.child('admins/'+auth.uid).val()===true`;
  const APPROVED = `root.child('approved/'+auth.uid).val()===true`;
  const USER = 'auth!=null';
  return {
    FULL: `(${USER}&&(${ADMIN}||${APPROVED}&&${OPEN}))`,
    TIME: `(${USER}&&(${ADMIN}||${OPEN}))`,
    DERBY: `(${USER}&&(${ADMIN}||${APPROVED}))`,
    NONE: `(${USER})`,
    SALE: raceSaleOpen(NOW),
    CLAIM: `(${USER}&&auth.uid==$uid&&${APPROVED}&&newData.child('kn').isString()&&newData.child('kr').isString()&&!root.child('race/u/'+$uid+'/'+newData.child('kn').val()+'/'+newData.child('kr').val()).exists()&&newData.parent().parent().child('race/u/'+$uid+'/'+newData.child('kn').val()+'/'+newData.child('kr').val()).val()===true)`,
    RACENOW: NOW === 'now' ? null : NOW, // 시험용 규칙: race/ 아래의 now 도 _test/now 로 (발매·마감·추첨 시각을 시험이 정한다)
  };
}
// race/ 아래 식의 시각을 시험 시각으로 바꾸고(시험용만), 자리 표시를 풀어 쓴다. 로그인 조건(auth != null)은 build 가 따로 바꾼다
function race(v, p, G) {
  const s = G.RACENOW && p[0] === 'race' ? v.replace(/\bnow\b/g, G.RACENOW) : v;
  return s.split('DERBY_CLAIM_AUTH').join(G.CLAIM).split(SALE_TOKEN).join(G.SALE);
}

// 경로별 조건 종류. 여기 없는 경로는 모두 FULL
function classOf(p, key) {
  const at = p.join('/');
  if (p[0] === 'race') return 'DERBY';
  if (at === 'admins/$uid') return 'NONE';
  if (at === 'approved/$uid') return key === '.read' ? 'NONE' : 'TIME';
  if (p[0] === 'signups') return 'TIME';
  if (at === 'users/$uid' || at === 'ids/$key' || at === 'nicknames/$key') return 'TIME';
  return 'FULL';
}

const stats = { FULL: 0, TIME: 0, NONE: 0, DERBY: 0 };
const noAuth = [];
function build(node, p, G, count) {
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) { out[k] = build(v, [...p, k], G, count); continue; }
    if ((k === '.read' || k === '.write') && typeof v === 'string') {
      const cls = classOf(p, k);
      if (!v.includes(AUTH)) { if (count) noAuth.push(`${p.join('/')} ${k}: ${v}`); out[k] = v; continue; }
      if (count) stats[cls] += v.split(AUTH).length - 1;
      out[k] = compact(race(v, p, G).split(AUTH).join(G[cls]));
      continue;
    }
    out[k] = k === '.validate' && typeof v === 'string' ? compact(race(v, p, G)) : v;
  }
  return out;
}

const deploy = { rules: build(src.rules, [], gates('now'), true) };
// 로그인 조건 없이 열려 있는 읽기·쓰기 규칙이 있으면 차단을 비켜 가므로 멈춘다 (false 로 닫힌 것은 괜찮다).
// 일부러 열어 둔 것: config/hoursBlock 읽기 (차단 설정 여부. 로그인 전의 가입·로그인 화면이 읽는다)
const PUBLIC = new Set(['config/hoursBlock .read: true']);
const open = noAuth.filter((s) => !/: false$/.test(s) && !PUBLIC.has(s));
if (open.length) { console.error('로그인 조건이 없는 규칙이 있습니다 (차단이 걸리지 않음):\n  ' + open.join('\n  ')); process.exit(1); }
if (/RACE_SALE_OPEN|DERBY_CLAIM_AUTH/.test(JSON.stringify(deploy))) { console.error('경마공원 자리 표시가 풀리지 않았습니다 (.read/.write/.validate 밖에 있음)'); process.exit(1); }

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

const write = (f, o, pretty) => fs.writeFileSync(path.join(ROOT, f), JSON.stringify(o, null, pretty ? 1 : 0) + '\n');
write('database.rules.deploy.json', deploy);
write('database.rules.test.json', test);
write('holidays.deploy.json', hol, true);
const size = fs.statSync(path.join(ROOT, 'database.rules.deploy.json')).size;
if (size > 262144) throw new Error(`RTDB rules exceed 262144 bytes: ${size}`);
console.log(`규칙 생성: 전체 조건 ${stats.FULL}곳, 시간 조건 ${stats.TIME}곳, 그대로 ${stats.NONE}곳, 경마공원 ${stats.DERBY}곳 ·${(size / 1024).toFixed(0)}KB (${size}바이트 / 한도 262144, 남은 여유 ${((262144 - size) / 1024).toFixed(1)}KB) · 공휴일 ${Object.keys(hol).length}일`);
