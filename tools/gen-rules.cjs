// 치팅 방지 규칙 생성기 (지갑·보유·착용·입장 버전). 사용: node tools/gen-rules.cjs sandbox|final|strip  → 그 뒤 npm run deploy:rules
//  sandbox: 지금 규칙은 그대로 두고, 같은 새 규칙을 시험용 경로 rtest/ 아래에 덧붙인다 (실서비스 영향 없음)
//  final  : 실제 경로(wallet, users/own·eq, players)에 새 규칙을 적용하고 rtest 는 뺀다
//  strip  : rtest 만 뺀다
const fs = require('fs');
const FILE = require('path').join(__dirname, '..', 'database.rules.json');
const mode = process.argv[2];
let t = fs.readFileSync(FILE, 'utf8');

// ---- 식 조립 ----
const d = (k, def = '0') => `(data.child('${k}').exists() ? data.child('${k}').val() : ${def})`;
const n = (k, def = '0') => `(newData.child('${k}').exists() ? newData.child('${k}').val() : ${def})`;
const dE = `(newData.child('e').val() - ${d('e')})`;      // 이번 쓰기의 획득량
const dS = `(${n('sp')} - ${d('sp')})`;                    // 이번 쓰기의 사용량
const TODAY = `((now + 32400000) - (now + 32400000) % 86400000)`; // KST 오늘 0시(ms)
const price = (id) => `root.child('config/prices/${id}').val()`;
const priceB = `root.child('config/prices/' + newData.child('b').val()).val()`;
const sameAr = `${n('ar')} == ${d('ar')}`, sameAb = `${n('ab')} == ${d('ab')}`, baitNoUp = `${n('bait')} <= ${d('bait')}`;
const bIs = (id) => `newData.child('b').val() == '${id}'`;
// 펫 종류 (shared/shop.ts 의 PET_IDS 와 같아야 한다). 먹이 쓰기에서 pp 에 적은 펫만 px 가 오르고 나머지는 그대로
const PET_IDS = ['petdog', 'petcat', 'petchick', 'petrabbit', 'petslime', 'petturtle'];
const PET_FOOD_STEP = 4;  // 먹이 하나마다 다음 먹이 +4 코인 (shared/shop.ts 의 PET_FOOD_STEP 과 같아야 한다)
const pxSame = PET_IDS.map((id) => `${n('px/' + id)} == ${d('px/' + id)}`).join(' && ');
// 강화 주문서(es)·성(rs): 안 사면 es 는 늘 수 없고, rs 는 "es 가 1 줄어드는 쓰기"에서만 +1 또는 0 으로 바뀐다 (2026-11-10)
const esNoUp = `${n('es')} <= ${d('es')}`, rsSame = `${n('rs')} == ${d('rs')}`;
const enhance = `(${n('es')} == ${d('es')} - 1 && (${n('rs')} == ${d('rs')} + 1 || ${n('rs')} == 0) && ${n('rs')} <= 30)`;

function walletValidate(pre = '') {
  const base = `newData.hasChildren(['c', 'e']) && newData.child('c').isNumber() && newData.child('e').isNumber() && newData.child('c').val() >= 0`;
  const mono = `${dE} >= 0 && ${dS} >= 0`; // 누적 획득·누적 사용은 줄지 않는다
  // 잔액 증가 ≤ 획득 − 사용
  const balance = `newData.child('c').val() - ${d('c')} <= ${dE} - ${dS}`;
  // 획득 (2026-11-10 속도 상한 삭제: 한 번 200·10분 3000 상한과 신화 md 분기를 없앴다. 정상 플레이에서 지급이 막히는 일이 있어서. 옛 wt/we/md 칸은 숫자면 그대로 둔다)
  //  - 룰렛: 날짜(rd)가 오늘로 바뀌는 쓰기 한 번에 1000 까지
  //  - 경마 배당 수령: cr 이 커지는 쓰기 한 번. 그 라운드가 마감됐고(at), 내 배팅 말이 at % 5 와 같고, 획득이 배팅 × 4.5 와 정확히 같아야
  //  - 보통 획득: rd·cr 이 그대로인 쓰기 (금액 제한 없음)
  const crSame = `${n('cr', "''")} == ${d('cr', "''")}`;
  const roulette = `(${n('rd')} != ${d('rd')} && ${n('rd')} == ${TODAY} && ${dE} <= 1000 && ${crSame})`;
  const R = `root.child('casino/r/' + newData.child('cr').val()`;
  const race = `(${n('cr', "''")} != ${d('cr', "''")} && newData.child('cr').isString() && (!data.child('cr').exists() || newData.child('cr').val() > data.child('cr').val()) && ${R} + '/at').exists() && ${R} + '/bets/' + auth.uid + '/h').val() == ${R} + '/at').val() % 5 && ${dE} == ${R} + '/bets/' + auth.uid + '/a').val() * 9 / 2 && ${n('rd')} == ${d('rd')})`;
  const normal = `(${n('rd')} == ${d('rd')} && ${crSame})`;
  // 사용: 안 썼으면 구매 표시(b)·자동 버프·미끼·주문서 증가·펫 먹이·성 변경 불가(강화 쓰기만 예외). 썼으면 b 에 산 품목을 적고 금액이 가격표와 정확히 같아야 한다
  // 선물 대상 gt 는 구매 쓰기에서만 바뀐다 (안 쓰면 그대로). 그래서 한 번 결제로 나와 상대 둘 다 등록하는 일이 없다
  // 경마 배팅 표시 cb/ch/ca 는 b='race' 결제 쓰기에서만 바뀐다 (다른 구매에 끼워 넣어 싸게 배팅하지 못하게)
  const cbSame = `${n('cb', "''")} == ${d('cb', "''")} && ${n('ch', '-1')} == ${d('ch', '-1')} && ${n('ca', '0')} == ${d('ca', '0')}`;
  const gearSame = `${pxSame} && ${esNoUp} && ${rsSame}`; // 먹이·주문서·성: 그 전용 쓰기가 아니면 그대로 (es 는 소모만)
  const noSpend = `(${dS} == 0 && ${n('b', "''")} == ${d('b', "''")} && ${n('gt', "''")} == ${d('gt', "''")} && ${cbSame} && ${sameAr} && ${sameAb} && ${baitNoUp} && ${pxSame} && (${enhance} || (${esNoUp} && ${rsSame})))`;
  const buyBait = `(${bIs('bait')} && ${n('bait')} > ${d('bait')} && ${dS} == ${price('bait')} * (${n('bait')} - ${d('bait')}) && ${sameAr} && ${sameAb} && ${cbSame} && ${gearSame})`;
  // 강화 주문서 묶음 구매: es 가 늘어난 만큼 × 가격 (2026-11-10)
  const buyScroll = `(${bIs('scroll')} && ${n('es')} > ${d('es')} && ${dS} == ${price('scroll')} * (${n('es')} - ${d('es')}) && ${sameAr} && ${sameAb} && ${cbSame} && ${baitNoUp} && ${pxSame} && ${rsSame})`;
  // 펫 먹이 = 구매와 동시에 먹이기 (2026-11-10): pp 에 적은 펫의 px 만 k 개 오르고 나머지 펫은 그대로.
  //  가격은 먹은 수에 비례해 오른다 (shared/shop.ts foodCost 와 같은 식): 사용액 == 기본가 × k + STEP × (k × 먹은 수 + k(k−1)/2)
  const PX = `newData.child('px/' + newData.child('pp').val()).val()`, PXD = `(data.child('px/' + newData.child('pp').val()).exists() ? data.child('px/' + newData.child('pp').val()).val() : 0)`;
  const K = `(${PX} - ${PXD})`;
  const feedCost = `(${price('petfood')} * ${K} + ${PET_FOOD_STEP} * (${K} * ${PXD} + ${K} * (${K} - 1) / 2))`;
  const feed = `(${bIs('petfood')} && newData.child('pp').isString() && ${price('petfood')} > 0 && newData.child('px/' + newData.child('pp').val()).isNumber() && ${K} >= 1 && ${K} % 1 == 0 && ${dS} == ${feedCost} && (${PET_IDS.map((id) => `(newData.child('pp').val() == '${id}' || ${n('px/' + id)} == ${d('px/' + id)})`).join(' && ')}) && ${sameAr} && ${sameAb} && ${cbSame} && ${baitNoUp} && ${esNoUp} && ${rsSame})`;
  // 자동 버프 품목은 autoreel/autoreel30/autoreel60, autobug/autobug30/autobug60 (2026-11-09: 30분·1시간 추가). 그 구매 쓰기에서만 ar/ab 가 바뀔 수 있다
  const buyOne = `(newData.child('b').val() != 'bait' && newData.child('b').val() != 'race' && newData.child('b').val() != 'scroll' && newData.child('b').val() != 'petfood' && ${dS} == ${priceB} && ${baitNoUp} && ${cbSame} && ${gearSame} && (newData.child('b').val().beginsWith('autoreel') || ${sameAr}) && (newData.child('b').val().beginsWith('autobug') || ${sameAb}))`;
  // 경마 배팅 결제: 금액은 100 단위로 100 ~ config/casinoMax(기본 10000), 말은 0~4, 라운드는 열려 있어야(o 있고 at 없음). 수령 표시 cr 은 그대로
  const MAXBET = `(root.child('config/casinoMax').isNumber() ? root.child('config/casinoMax').val() : 10000)`;
  const CB = `root.child('casino/r/' + newData.child('cb').val()`;
  const bet = `(${bIs('race')} && ${dS} == ${n('ca')} && ${n('ca')} >= 100 && ${n('ca')} <= ${MAXBET} && ${n('ca')} % 100 == 0 && ${n('ch', '-1')} >= 0 && ${n('ch', '-1')} <= 4 && ${n('ch', '-1')} % 1 == 0 && newData.child('cb').isString() && ${CB} + '/o').exists() && !${CB} + '/at').exists() && ${crSame} && ${sameAr} && ${sameAb} && ${baitNoUp} && ${gearSame})`;
  const spend = `(${noSpend} || (${dS} > 0 && newData.child('b').isString() && (${buyBait} || ${buyScroll} || ${feed} || ${buyOne} || ${bet})))`;
  // 성(rs)이 0 보다 크면 명품 낚싯대를 가지고 있어야 한다 (부서지면 rs 도 0 으로 쓴다)
  const rodOwned = `(${n('rs')} == 0 || root.child('${pre}users/' + auth.uid + '/own/rod2').val() === true)`;
  // 관리자 지급(관리자 페이지의 코인 지급/회수): 관리자가 쓰는 지갑은 형식만 보고 나머지 검사를 건너뛴다. 지급 표시 gf 는 관리자만 바꿀 수 있다
  const admin = `root.child('admins/' + auth.uid).val() === true`;
  const gfSame = `newData.child('gf/at').val() == data.child('gf/at').val() && newData.child('gf/n').val() == data.child('gf/n').val()`;
  return `${base} && (${admin} || (${mono} && ${balance} && (${roulette} || ${normal} || ${race}) && ${spend} && ${rodOwned} && ${gfSame}))`;
}

const q = (s) => JSON.stringify(s);
function walletBlock(pre, ind) {
  const I = ind, J = ind + '  ', K = ind + '    ';
  const child = (k, v) => `${K}${q(k)}: { ".validate": ${q(v)} }`;
  return [
    `${I}"wallet": {`,
    ...(pre ? [] : [`${J}".read": "auth != null && root.child('admins/' + auth.uid).val() === true",`]), // 관리자 의심 지표 탭이 지갑 전체를 읽는다
    `${J}"$uid": {`,
    ...(pre ? [`${K}".write": "auth != null && (auth.uid == $uid || root.child('admins/' + auth.uid).val() === true)",`] : [
      `${K}".read": "auth != null && (auth.uid == $uid || root.child('admins/' + auth.uid).val() === true)",`,
      `${K}".write": "auth != null && (auth.uid == $uid || root.child('admins/' + auth.uid).val() === true)",`,
    ]),
    `${K}".validate": ${q(walletValidate(pre))},`,
    [
      child('c', 'newData.isNumber() && newData.val() >= 0'),
      child('e', 'newData.isNumber() && newData.val() >= 0'),
      child('sp', 'newData.isNumber() && newData.val() >= 0'),
      child('bait', 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 999'),
      child('ar', 'newData.isNumber() && newData.val() <= now + 3660000'), // 자동 버프는 남은 시간 포함 최대 1시간 (+1분 여유)
      child('ab', 'newData.isNumber() && newData.val() <= now + 3660000'),
      child('bu', 'newData.isBoolean()'),
      child('rd', 'newData.isNumber() || (newData.isString() && newData.val().length == 8)'),
      child('b', 'newData.isString() && newData.val().length <= 20'),
      child('gt', 'newData.isString() && newData.val().length <= 40'), // 선물 받는 사람 uid
      child('cb', 'newData.isString() && newData.val().length <= 32'),  // 경마: 마지막 배팅 라운드
      child('ch', 'newData.isNumber()'),                                 // 경마: 말 번호
      child('ca', 'newData.isNumber()'),                                 // 경마: 금액
      child('cr', 'newData.isString() && newData.val().length <= 32'),  // 경마: 배당 받은 마지막 라운드
      child('md', 'newData.isNumber()'),                                 // (예전) 신화 보상 받은 날. 2026-11-10 부터 안 씀
      child('wt', 'newData.isNumber()'),                                 // (예전) 10분 창 시작. 2026-11-10 부터 안 씀
      child('we', 'newData.isNumber()'),                                 // (예전) 10분 창 합계. 2026-11-10 부터 안 씀
      `${K}"px": { "$pet": { ".validate": "newData.isNumber() && newData.val() >= 0" } }`, // 펫별 누적 먹이 (2026-11-10)
      child('pp', 'newData.isString() && newData.val().length <= 20'),  // 마지막으로 먹인 펫
      child('es', 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 999'), // 강화 주문서 개수
      child('rs', 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 30'),  // 명품 낚싯대 성
      `${K}"gf": { "n": { ".validate": "newData.isNumber()" }, "at": { ".validate": "newData.isNumber()" }, "$other": { ".validate": false } }`,
      child('ad', 'newData.isNumber()'),
      child('an', 'newData.isNumber()'),
      child('bn', 'newData.isNumber()'),
      `${K}"$other": { ".validate": false }`,
    ].join(',\n'),
    `${J}}`,
    `${I}}`,
  ].join('\n');
}
// 보유: 이미 가진 것이거나, 지갑의 마지막 구매 표시(b)가 이 품목일 때만 (b 는 가격을 정확히 낸 쓰기에서만 바뀐다).
// 본인 등록은 선물 대상(gt)이 없을 때만, 남(선물한 사람)의 등록은 그 사람 지갑의 b 가 이 품목이고 gt 가 받는 사람일 때만 (2026-11-09 선물)
const myBuy = (pre) => `(auth.uid == $uid && root.child('${pre}wallet/' + $uid + '/b').val() == $item && !root.child('${pre}wallet/' + $uid + '/gt').exists())`;
const giftBuy = (pre) => `(auth.uid != $uid && root.child('${pre}wallet/' + auth.uid + '/b').val() == $item && root.child('${pre}wallet/' + auth.uid + '/gt').val() == $uid)`;
const ownRule = (pre) => `newData.isBoolean() && (data.val() === true || (newData.val() === true && (${myBuy(pre)} || ${giftBuy(pre)})))`;
// 선물받은 품목 표시: 선물한 사람만 쓴다 (본인이 자기 물건을 선물로 둔갑시켜 의심 지표에서 빼지 못하게)
const giftsRule = (pre) => `newData.val() === true && ${giftBuy(pre)}`;
// 마지막 선물 표시 (받는 사람 알림용): 선물한 사람이 결제한 그 품목으로만
const giftMarkRule = (pre) => `newData.child('f').val() == auth.uid && auth.uid != $uid && newData.child('fn').isString() && newData.child('i').isString() && root.child('${pre}wallet/' + auth.uid + '/b').val() == newData.child('i').val() && root.child('${pre}wallet/' + auth.uid + '/gt').val() == $uid && newData.child('at').isNumber() && (!newData.hasChild('m') || (newData.child('m').isString() && newData.child('m').val().length <= 40))`;
const ownsStr = (pre) => `newData.isString() && root.child('${pre}users/' + $uid + '/own/' + newData.val()).val() === true`;
const armorEq = (pre, item) => `newData.isBoolean() && (newData.val() === false || root.child('${pre}users/' + $uid + '/own/${item}').val() === true)`;
const armorPl = (pre, item) => `newData.val() === true && root.child('${pre}users/' + $uid + '/own/${item}').val() === true`;
function ownEqLines(pre, ind) {
  return [
    // own 은 모두 읽을 수 있다(선물할 때 상대가 이미 가졌는지 확인). 남의 own·gifts·gift 쓰기는 "새 값이 있을 때"만 열고(.validate 가 선물 결제를 확인) 삭제는 본인만
    `${ind}"own": { ".read": "auth != null", "$item": { ".write": "auth != null && newData.exists()", ".validate": ${q(ownRule(pre))} } },`,
    `${ind}"gifts": { "$item": { ".write": "auth != null && newData.exists()", ".validate": ${q(giftsRule(pre))} } },`,
    `${ind}"gift": { ".write": "auth != null && newData.exists()", ".validate": ${q(giftMarkRule(pre))} },`,
    `${ind}"eq": {`,
    `${ind}  "h": { ".validate": ${q(ownsStr(pre))} },`,
    `${ind}  "nc": { ".validate": ${q(ownsStr(pre))} },`,
    `${ind}  "fx": { ".validate": ${q(ownsStr(pre))} },`,
    `${ind}  "pt": { ".validate": ${q(ownsStr(pre))} },`,
    `${ind}  "pa": { ".validate": ${q(armorEq(pre, 'pusharmor'))} },`,
    `${ind}  "ta": { ".validate": ${q(armorEq(pre, 'tossarmor'))} },`,
    `${ind}  "$other": { ".validate": false }`,
    `${ind}}`,
  ].join('\n');
}
function playerCosLines(pre, ind) {
  return [
    `${ind}"h": { ".validate": ${q(ownsStr(pre))} },`,
    `${ind}"nc": { ".validate": ${q(ownsStr(pre))} },`,
    `${ind}"fx": { ".validate": ${q(ownsStr(pre))} },`,
    `${ind}"pt": { ".validate": ${q(ownsStr(pre))} },`,
    `${ind}"pl": { ".validate": ${q(petXpPl(pre))} },`,
    `${ind}"pa": { ".validate": ${q(armorPl(pre, 'pusharmor'))} },`,
    `${ind}"ta": { ".validate": ${q(armorPl(pre, 'tossarmor'))} },`,
    `${ind}"z": { ".validate": "newData.isBoolean()" },`,
  ].join('\n');
}
// presence 의 펫 경험치(pl)는 지갑 px 의 그 펫 값 이하 (2026-11-10)
const petXpPl = (pre) => `newData.isNumber() && newData.parent().child('pt').isString() && newData.val() <= root.child('${pre}wallet/' + $uid + '/px/' + newData.parent().child('pt').val()).val()`;
function sandboxBlock() {
  const pre = 'rtest/';
  return [
    `    "rtest": {`,
    walletBlock(pre, '      ') + ',',
    `      "users": {`,
    `        "$uid": {`,
    `          ".write": "auth != null && auth.uid == $uid",`,
    ownEqLines(pre, '          '),
    `        }`,
    `      },`,
    `      "players": {`,
    `        "$uid": {`,
    `          ".write": "auth != null && auth.uid == $uid",`,
    playerCosLines(pre, '          ').replace(/,\s*$/, ''),
    `        }`,
    `      }`,
    `    },`,
  ].join('\n');
}

// ---- 텍스트 편집 도우미 ----
// key 로 시작하는 블록("key": { ... })의 [시작, 끝) 범위. from 이후 첫 번째
function blockRange(text, key, from = 0) {
  const s = text.indexOf(`"${key}": {`, from);
  if (s < 0) return null;
  let i = text.indexOf('{', s), depth = 0, inStr = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return [s, i + 1]; }
  }
  return null;
}
function stripSandbox() {
  const r = blockRange(t, 'rtest');
  if (!r) return false;
  let [s, e] = r;
  while (t[s - 1] === ' ') s--;            // 줄 앞 공백
  if (t[e] === ',') e++;
  if (t[e] === '\r') e++;
  if (t[e] === '\n') e++;
  t = t.slice(0, s) + t.slice(e);
  return true;
}
const must = (cond, msg) => { if (!cond) { console.error('실패: ' + msg); process.exit(1); } };

stripSandbox();
if (mode === 'sandbox') {
  const at = t.indexOf('"rules": {');
  must(at >= 0, 'rules 시작을 못 찾음');
  const nl = t.indexOf('\n', at) + 1;
  t = t.slice(0, nl) + sandboxBlock() + '\n' + t.slice(nl);
} else if (mode === 'final') {
  // 1) wallet 블록 교체
  const top = t.indexOf('\n    "wallet": {');
  must(top >= 0, 'wallet 블록을 못 찾음');
  const wr = blockRange(t, 'wallet', top);
  t = t.slice(0, wr[0]) + walletBlock('', '    ').trimStart() + t.slice(wr[1]);
  // 2) users/$uid 의 own · eq
  const usersAt = t.indexOf('\n    "users": {');
  must(usersAt >= 0, 'users 블록을 못 찾음');
  const ownAt = t.indexOf('"own": {', usersAt);
  const eqR = blockRange(t, 'eq', ownAt);
  must(ownAt > 0 && eqR, 'own/eq 를 못 찾음');
  t = t.slice(0, ownAt) + ownEqLines('', '        ').trimStart() + t.slice(eqR[1]);
  // 3) players/$uid 에 꾸미기·갑옷·자리비움 칸
  const plAt = t.indexOf('\n    "players": {');
  must(plAt >= 0, 'players 블록을 못 찾음');
  const pushAt = t.indexOf('        "push": {', plAt);
  must(pushAt > 0, 'players push 를 못 찾음');
  if (!t.slice(plAt, pushAt).includes('"z": {')) t = t.slice(0, pushAt) + playerCosLines('', '        ') + '\n' + t.slice(pushAt);
  else if (!t.slice(plAt, pushAt).includes('"pt": {')) t = t.slice(0, pushAt) + `        "pt": { ".validate": ${q(ownsStr(''))} },\n` + t.slice(pushAt); // 펫 (2026-11-09)
  else if (!t.slice(plAt, pushAt).includes('"pl": {')) t = t.slice(0, pushAt) + `        "pl": { ".validate": ${q(petXpPl(''))} },\n` + t.slice(pushAt); // 펫 경험치 (2026-11-10)
  // 4) 입장(노드를 새로 만드는 쓰기)은 클라이언트 버전 v 가 config/minVersion 이상이어야 한다: 새로고침 안 한 옛 페이지로는 못 들어온다
  const pvOld = `(!newData.hasChild('hb') || newData.child('hb').isNumber()))"`;
  const pvNew = `(!newData.hasChild('hb') || newData.child('hb').isNumber()) && (data.exists() || !root.child('config/minVersion').isNumber() || (newData.child('v').isNumber() && newData.child('v').val() >= root.child('config/minVersion').val())))"`;
  const plBlock = t.slice(plAt, t.indexOf('        "push": {', plAt));
  if (!plBlock.includes('config/minVersion')) {
    const at = t.indexOf(pvOld, plAt);
    must(at > 0 && at < t.indexOf('        "push": {', plAt), 'players 검증 끝을 못 찾음');
    t = t.slice(0, at) + pvNew + t.slice(at + pvOld.length);
  }
} else must(mode === 'strip', 'mode 는 sandbox|final|strip');

const parsed = JSON.parse(t); // 형식 확인
if (mode === 'final') {
  const r = parsed.rules;
  must(!r.rtest, 'rtest 가 남음');
  must(r.wallet['$uid']['.validate'].includes("child('b')") && r.wallet['$uid'].gf && r.wallet['$uid'].px, 'wallet 규칙이 안 바뀜');
  must(r.users['$uid'].own['$item']['.validate'].includes('wallet/'), 'own 규칙이 안 바뀜');
  must(r.players['$uid'].pa && r.players['$uid'].push, 'players 규칙이 이상함');
}
fs.writeFileSync(FILE, t);
console.log(mode, '적용. 크기', t.length, '바이트, wallet 식 길이', walletValidate().length);
