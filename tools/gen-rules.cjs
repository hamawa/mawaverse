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
// 금광·킹 낚싯대 (2026-11-11). gn: 금덩이, ga: 마지막 채광 시각, ks: 킹 낚싯대 성. 아래 세 값은 shared/mine.ts·shared/shop.ts 와 같아야 한다
const MINE_GAP_MS = 2500, MINE_MAX = 3, KING_CRAFT_GOLD = 100;
const gnSame = `${n('gn')} == ${d('gn')}`, gaSame = `${n('ga')} == ${d('ga')}`, ksSame = `${n('ks')} == ${d('ks')}`;
// 빠따(bt): b='bat' 결제에서만 늘고, 그 밖의 쓰기에서는 줄기만 한다 (방어를 깨는 밀치기·말랑이·끌기 쓰기가 줄인다. 2026-11-11)
const btNoUp = `${n('bt')} <= ${d('bt')}`;
const kingSame = `${gnSame} && ${gaSame} && ${ksSame}`; // 채광·제작·킹 강화 쓰기가 아니면 세 칸 모두 그대로 (다른 구매에 끼워 넣지 못하게)
const enhance = `(${n('es')} == ${d('es')} - 1 && (${n('rs')} == ${d('rs')} + 1 || ${n('rs')} == 0) && ${n('rs')} <= 30 && ${kingSame})`;
// 킹 낚싯대 강화: 주문서 1장과 금덩이 1개가 같이 줄 때만 킹 성이 +1 또는 0
const kEnhance = `(${n('es')} == ${d('es')} - 1 && ${n('gn')} == ${d('gn')} - 1 && (${n('ks')} == ${d('ks')} + 1 || ${n('ks')} == 0) && ${n('ks')} <= 30 && ${rsSame} && ${gaSame})`;
// 채광: 금덩이가 1~MINE_MAX 개 늘고, 채광 시각은 지금이며 지난 채광에서 MINE_GAP_MS 이상 지났다. 코인·주문서·성은 그대로
const mineW = `(${n('gn')} > ${d('gn')} && ${n('gn')} - ${d('gn')} <= ${MINE_MAX} && (${n('gn')} - ${d('gn')}) % 1 == 0 && newData.child('ga').val() == now && (!data.child('ga').exists() || now - data.child('ga').val() >= ${MINE_GAP_MS}) && ${dE} == 0 && ${n('es')} == ${d('es')} && ${rsSame} && ${ksSame})`;
// 슬롯 방의 즉석 게임: 슬롯·홀짝 (2026-11-12). 아래 숫자는 shared/slots.ts 와 같아야 한다 (tests/slots.test.mjs 가 대조)
//  ik: 게임('s' 슬롯 | 'o' 홀짝), ib: 건 돈, ip: 홀짝에서 고른 쪽(1 홀 · 0 짝), it: 베팅한 서버 시각, ic: 정산한 판의 it
const SLOT_MOD = 9973, SLOT_MUL = 7919, SLOT_ADD = 4421, JACKPOT_MIN_BET = 1000, JACKPOT_SEED = 10000, INSTANT_GAP_MS = 1000;
const SLOT_TIERS = [[10, 50], [40, 50], [240, 10], [739, 4], [1936, 2], [2734, 1]]; // [해시가 이 값 미만이면, 배수]. 첫 칸은 잭팟(1000 이상 걸었을 때)
const ODD_EVEN_NUM = 19, ODD_EVEN_DEN = 10;
// 베팅 칸 넷은 즉석 게임 베팅 쓰기에서만, 정산 표시 ic 는 정산 쓰기에서만 바뀐다 (다른 구매·획득에 끼워 넣지 못하게)
// 1:1 내기 (2026-11-12, shared/duel.ts): dl = 내가 판돈을 낸 마지막 내기 id (b='duel' 결제 쓰기에서만 바뀐다), dc = 마지막으로 정산(승리·환불)한 내기 id
const DUEL_ACCEPT_LIMIT_MS = 25000, DUEL_FEE_DEFAULT = 5; // 수락 제한(화면 20초 + 여유 5초), 수수료 % 기본값. shared/duel.ts 와 같아야 한다
const DUEL_FISH_CLOSE_MS = 305000; // 낚시 내기: 수락 뒤 5분 + 여유 5초가 지나야 정산 (shared/duel.ts 의 DUEL_FISH_MS + DUEL_FISH_GRACE_MS)
const dlSame = `${n('dl', "''")} == ${d('dl', "''")}`, dcSame = `${n('dc', "''")} == ${d('dc', "''")}`;
const i4Only = `${n('ik', "''")} == ${d('ik', "''")} && ${n('ib')} == ${d('ib')} && ${n('ip', '-1')} == ${d('ip', '-1')} && ${n('it')} == ${d('it')}`;
const icOnly = `${n('ic')} == ${d('ic')}`;
// 아래 둘은 "그 전용 쓰기가 아니면 그대로"를 한데 묶은 것: 사용 쪽(i4Same)에는 내기 결제 표시 dl, 획득 쪽(icSame)에는 내기 정산 표시 dc 가 같이 들어 있다
// 인디언 포커: pk = 내가 들어간 마지막 판 id, ps = 그 판의 내 자리(a|b) (b='poker' 결제 쓰기에서만 바뀐다), pc = 마지막으로 정산한 판 id
const pkSame = `${n('pk', "''")} == ${d('pk', "''")} && ${n('ps', "''")} == ${d('ps', "''")}`, pcSame = `${n('pc', "''")} == ${d('pc', "''")}`;
const i4Same = `${i4Only} && ${dlSame} && ${pkSame}`;
const icSame = `${icOnly} && ${dcSame} && ${pcSame}`;
const IT = `data.child('it').val()`, IB = `data.child('ib').val()`;
const SLOT_H = `((${IT} % ${SLOT_MOD}) * ${SLOT_MUL} + ${SLOT_ADD}) % ${SLOT_MOD}`;
const SLOT_JP = `(root.child('slot/jp').isNumber() ? root.child('slot/jp').val() : 0)`;
const isJackpot = `(data.child('ik').val() == 's' && ${SLOT_H} < ${SLOT_TIERS[0][0]} && ${IB} >= ${JACKPOT_MIN_BET})`;
const slotPay = SLOT_TIERS.reduceRight((rest, [below, mult]) => `(${SLOT_H} < ${below} ? ${IB} * ${mult} : ${rest})`, '0');
const oePay = `(${SLOT_H} % 2 == data.child('ip').val() ? ${IB} * ${ODD_EVEN_NUM} / ${ODD_EVEN_DEN} : 0)`;
const instantPay = `(${isJackpot} ? ${SLOT_JP} : (data.child('ik').val() == 's' ? ${slotPay} : ${oePay}))`;

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
  const roulette = `(${n('rd')} != ${d('rd')} && ${n('rd')} == ${TODAY} && ${dE} <= 1000 && ${crSame} && ${icSame})`;
  const R = `root.child('casino/r/' + newData.child('cr').val()`;
  const race = `(${n('cr', "''")} != ${d('cr', "''")} && newData.child('cr').isString() && (!data.child('cr').exists() || newData.child('cr').val() > data.child('cr').val()) && ${R} + '/at').exists() && ${R} + '/bets/' + auth.uid + '/h').val() == ${R} + '/at').val() % 5 && ${dE} == ${R} + '/bets/' + auth.uid + '/a').val() * 9 / 2 && ${n('rd')} == ${d('rd')} && ${icSame})`;
  const normal = `(${n('rd')} == ${d('rd')} && ${crSame} && ${icSame})`;
  // 즉석 게임 정산 (2026-11-12): ic 가 그 판의 it 로 바뀌는 쓰기 한 번. 받는 돈은 it 에서 계산한 결과와 정확히 같아야 한다 (꽝이면 0).
  //  잭팟이면 쌓인 금액을 통째로 받고, 같은 쓰기에서 slot/jp 를 시작 금액으로 되돌려야 한다
  const rootNew = pre ? `newData.parent().parent().parent()` : `newData.parent().parent()`;
  const instantWin = `(data.child('it').isNumber() && ${d('ic')} != ${IT} && newData.child('ic').val() == ${IT} && ${dE} == ${instantPay} && (!${isJackpot} || ${rootNew}.child('slot/jp').val() == ${JACKPOT_SEED}) && ${n('rd')} == ${d('rd')} && ${crSame} && ${dcSame} && ${pcSame})`;
  // 1:1 내기 정산 (2026-11-12): dc 가 그 내기 id 로 바뀌는 쓰기 한 번. 같은 쓰기에서 duel/{id}/paid 를 적어야 하고(두 번 못 받게) 받는 돈은
  //  - 이겼을 때: 판돈 합계 − 수수료 (승자는 수락 시각 acc 를 섞은 값의 홀짝. 짝이면 신청한 a, 홀이면 수락한 b)
  //  - 수락되지 않았을 때(거절했거나 시간이 지남): 신청한 사람이 낸 돈 그대로
  const DC = `root.child('duel/' + newData.child('dc').val())`, DCN = `${rootNew}.child('duel/' + newData.child('dc').val())`;
  const DFEE = `(root.child('config/duelFee').isNumber() ? root.child('config/duelFee').val() : ${DUEL_FEE_DEFAULT})`;
  const DWIN = `(((${DC}.child('acc').val() % ${SLOT_MOD}) * ${SLOT_MUL} + ${SLOT_ADD}) % ${SLOT_MOD} % 2 == 0 ? ${DC}.child('a').val() : ${DC}.child('b').val())`;
  // 주사위 대결: 승자는 수락 시각 acc 를 섞은 값의 홀짝
  const DPAY = `2 * ${DC}.child('s').val() - 2 * ${DC}.child('s').val() * ${DFEE} / 100`;
  const duelWon = `(${DC}.child('k').val() == 'dice' && ${DC}.child('acc').exists() && ${DWIN} == auth.uid && ${dE} == ${DPAY})`;
  // 낚시 내기: 수락 뒤 DUEL_FISH_CLOSE_MS 가 지나야 정산한다. 각자 적어 둔 최고 크기(fa·fb, 없으면 0)가 큰 쪽이 이기고, 같으면 각자 낸 돈을 돌려받는다(ra·rb 표시)
  const FA = `(${DC}.child('fa').isNumber() ? ${DC}.child('fa').val() : 0)`, FB = `(${DC}.child('fb').isNumber() ? ${DC}.child('fb').val() : 0)`;
  const FCLOSED = `(${DC}.child('k').val() == 'fish' && ${DC}.child('acc').exists() && now > ${DC}.child('acc').val() + ${DUEL_FISH_CLOSE_MS})`;
  const fishWon = `(${FCLOSED} && ((${DC}.child('a').val() == auth.uid && ${FA} > ${FB}) || (${DC}.child('b').val() == auth.uid && ${FB} > ${FA})) && ${dE} == ${DPAY})`;
  const fishTie = `(${FCLOSED} && ${FA} == ${FB} && ${dE} == ${DC}.child('s').val() && ((${DC}.child('a').val() == auth.uid && ${DC}.child('ra').val() !== true && ${DCN}.child('ra').val() === true) || (${DC}.child('b').val() == auth.uid && ${DC}.child('rb').val() !== true && ${DCN}.child('rb').val() === true)))`;
  const duelBack = `(!${DC}.child('acc').exists() && ${DC}.child('a').val() == auth.uid && (${DC}.child('no').val() === true || now > ${DC}.child('o').val() + ${DUEL_ACCEPT_LIMIT_MS}) && ${dE} == ${DC}.child('s').val())`;
  const duelWin = `(newData.child('dc').isString() && !(${dcSame}) && ${DC}.child('s').isNumber() && (((${duelWon} || ${fishWon} || ${duelBack}) && ${DC}.child('paid').val() !== true && ${DCN}.child('paid').val() === true) || ${fishTie}) && ${n('rd')} == ${d('rd')} && ${crSame} && ${icOnly} && ${pcSame})`;
  // 인디언 포커 정산 (2026-11-12): pc 가 내가 들어가 있던 판(pk)으로 바뀌는 쓰기 한 번. 같은 쓰기에서 그 판의 내 정산 표시(xa|xb)를 적어야 한다.
  //  겨룬 돈 m = 둘 중 적게 건 쪽. 이겼으면 건 돈 + m − 수수료, 졌으면 건 돈 − m(상대가 못 따라온 초과분), 비김·취소면 건 돈 그대로
  const PH = `root.child('pkh/' + data.child('pk').val())`, PSD = `data.child('ps').val()`;
  const POWN = `${PH}.child('p' + ${PSD}).val()`, PM = `(${PH}.child('pa').val() < ${PH}.child('pb').val() ? ${PH}.child('pa').val() : ${PH}.child('pb').val())`;
  const PFEE = `((2 * ${PM} - (2 * ${PM}) % 100) * ${DFEE} / 100)`;
  const PPAY = `((${PH}.child('w').val() == 'tie' || ${PH}.child('w').val() == 'void') ? ${POWN} : (${PH}.child('w').val() == ${PSD} ? ${POWN} + ${PM} - ${PFEE} : ${POWN} - ${PM}))`;
  const pokerWin = `(data.child('pk').isString() && newData.child('pc').val() == data.child('pk').val() && !(${pcSame}) && ${PH}.child('st').val() == 'done' && ${PH}.child(${PSD}).val() == auth.uid && ${PH}.child('x' + ${PSD}).val() !== true && ${rootNew}.child('pkh/' + data.child('pk').val() + '/x' + ${PSD}).val() === true && ${dE} == ${PPAY} && ${n('rd')} == ${d('rd')} && ${crSame} && ${icOnly} && ${dcSame})`;
  // 사용: 안 썼으면 구매 표시(b)·자동 버프·미끼·주문서 증가·펫 먹이·성 변경 불가(강화 쓰기만 예외). 썼으면 b 에 산 품목을 적고 금액이 가격표와 정확히 같아야 한다
  // 선물 대상 gt 는 구매 쓰기에서만 바뀐다 (안 쓰면 그대로). 그래서 한 번 결제로 나와 상대 둘 다 등록하는 일이 없다
  // 경마 배팅 표시 cb/ch/ca 는 b='race' 결제 쓰기에서만 바뀐다 (다른 구매에 끼워 넣어 싸게 배팅하지 못하게)
  const cbSame = `${n('cb', "''")} == ${d('cb', "''")} && ${n('ch', '-1')} == ${d('ch', '-1')} && ${n('ca', '0')} == ${d('ca', '0')}`;
  const gearSame = `${pxSame} && ${esNoUp} && ${rsSame} && ${kingSame} && ${btNoUp}`;
  // 성은 강화 쓰기에서만 바뀐다. 예외: 그 낚싯대가 보관함에 없으면 주문서 없이 0 으로 되돌릴 수 있다 (2026-11-11. 낚싯대 없이 성만 남은 지갑을 클라이언트가 접속할 때 바로잡는다)
  const rsKeep = `(${rsSame} || (${n('rs')} == 0 && root.child('${pre}users/' + auth.uid + '/own/rod2').val() != true))`;
  const ksKeep = `(${ksSame} || (${n('ks')} == 0 && root.child('${pre}users/' + auth.uid + '/own/rod3').val() != true))`; // 먹이·주문서·성·금덩이: 그 전용 쓰기가 아니면 그대로 (es 는 소모만)
  // 구매 표시(b)는 안 쓰면 그대로. 예외: 강화에 실패해 낚싯대가 부서지는 쓰기(주문서 −1, 성 0)는 b 를 지울 수 있다.
  //  b 가 그 낚싯대로 남아 있으면 부서진 뒤에도 보유 등록 규칙(own: b 가 그 품목)이 통과해 공짜로 되살릴 수 있었다 (2026-11-11 수정)
  const bKeep = `(${n('b', "''")} == ${d('b', "''")} || (!newData.child('b').exists() && ${n('es')} == ${d('es')} - 1 && (${n('rs')} == 0 || ${n('ks')} == 0)))`;
  const noSpend = `(${dS} == 0 && ${i4Same} && ${bKeep} && ${n('gt', "''")} == ${d('gt', "''")} && ${cbSame} && ${sameAr} && ${sameAb} && ${baitNoUp} && ${pxSame} && ${btNoUp} && (${enhance} || ${kEnhance} || ${mineW} || (${esNoUp} && ${gnSame} && ${gaSame} && ${rsKeep} && ${ksKeep})))`;
  const buyBait = `(${bIs('bait')} && ${n('bait')} > ${d('bait')} && ${dS} == ${price('bait')} * (${n('bait')} - ${d('bait')}) && ${sameAr} && ${sameAb} && ${cbSame} && ${gearSame} && ${i4Same})`;
  // 강화 주문서 묶음 구매: es 가 늘어난 만큼 × 가격 (2026-11-10)
  const buyScroll = `(${bIs('scroll')} && ${n('es')} > ${d('es')} && ${dS} == ${price('scroll')} * (${n('es')} - ${d('es')}) && ${sameAr} && ${sameAb} && ${cbSame} && ${baitNoUp} && ${pxSame} && ${rsSame} && ${kingSame} && ${btNoUp} && ${i4Same})`;
  // 빠따 묶음 구매: bt 가 늘어난 만큼 × 가격 (2026-11-11)
  const buyBat = `(${bIs('bat')} && ${n('bt')} > ${d('bt')} && ${dS} == ${price('bat')} * (${n('bt')} - ${d('bt')}) && ${sameAr} && ${sameAb} && ${cbSame} && ${baitNoUp} && ${pxSame} && ${esNoUp} && ${rsSame} && ${kingSame} && ${i4Same})`;
  // 킹 낚싯대 제작 (2026-11-11): 값은 가격표대로, 명품 성이 30(그대로)이고 명품 낚싯대를 가지고 있으며, 금덩이가 정확히 KING_CRAFT_GOLD 만큼 줄고, 킹 성은 0. 선물(gt) 불가
  const craft = `(${bIs('rod3')} && ${dS} == ${price('rod3')} && ${d('rs')} == 30 && ${rsSame} && root.child('${pre}users/' + auth.uid + '/own/rod2').val() === true && ${n('gn')} == ${d('gn')} - ${KING_CRAFT_GOLD} && ${n('ks')} == 0 && !newData.child('gt').exists() && ${gaSame} && ${sameAr} && ${sameAb} && ${cbSame} && ${baitNoUp} && ${pxSame} && ${esNoUp} && ${btNoUp} && ${i4Same})`;
  // 펫 먹이 = 구매와 동시에 먹이기 (2026-11-10): pp 에 적은 펫의 px 만 k 개 오르고 나머지 펫은 그대로.
  //  가격은 먹은 수에 비례해 오른다 (shared/shop.ts foodCost 와 같은 식): 사용액 == 기본가 × k + STEP × (k × 먹은 수 + k(k−1)/2)
  const PX = `newData.child('px/' + newData.child('pp').val()).val()`, PXD = `(data.child('px/' + newData.child('pp').val()).exists() ? data.child('px/' + newData.child('pp').val()).val() : 0)`;
  const K = `(${PX} - ${PXD})`;
  const feedCost = `(${price('petfood')} * ${K} + ${PET_FOOD_STEP} * (${K} * ${PXD} + ${K} * (${K} - 1) / 2))`;
  const feed = `(${bIs('petfood')} && newData.child('pp').isString() && ${price('petfood')} > 0 && newData.child('px/' + newData.child('pp').val()).isNumber() && ${K} >= 1 && ${K} % 1 == 0 && ${dS} == ${feedCost} && (${PET_IDS.map((id) => `(newData.child('pp').val() == '${id}' || ${n('px/' + id)} == ${d('px/' + id)})`).join(' && ')}) && ${sameAr} && ${sameAb} && ${cbSame} && ${baitNoUp} && ${esNoUp} && ${rsSame} && ${kingSame} && ${btNoUp} && ${i4Same})`;
  // 자동 버프 품목은 autoreel/autoreel30/autoreel60, autobug/autobug30/autobug60 (2026-11-09: 30분·1시간 추가). 그 구매 쓰기에서만 ar/ab 가 바뀔 수 있다
  const buyOne = `(newData.child('b').val() != 'bait' && newData.child('b').val() != 'race' && newData.child('b').val() != 'scroll' && newData.child('b').val() != 'petfood' && newData.child('b').val() != 'rod3' && newData.child('b').val() != 'bat' && newData.child('b').val() != 'slot' && newData.child('b').val() != 'oddeven' && newData.child('b').val() != 'duel' && newData.child('b').val() != 'poker' && ${dS} == ${priceB} && ${baitNoUp} && ${cbSame} && ${gearSame} && ${i4Same} && (newData.child('b').val().beginsWith('autoreel') || ${sameAr}) && (newData.child('b').val().beginsWith('autobug') || ${sameAb}))`;
  // 경마 배팅 결제: 금액은 100 단위로 100 ~ config/casinoMax(기본 10000), 말은 0~4, 라운드는 열려 있어야(o 있고 at 없음). 수령 표시 cr 은 그대로
  const MAXBET = `(root.child('config/casinoMax').isNumber() ? root.child('config/casinoMax').val() : 10000)`;
  const CB = `root.child('casino/r/' + newData.child('cb').val()`;
  const bet = `(${bIs('race')} && ${dS} == ${n('ca')} && ${n('ca')} >= 100 && ${n('ca')} <= ${MAXBET} && ${n('ca')} % 100 == 0 && ${n('ch', '-1')} >= 0 && ${n('ch', '-1')} <= 4 && ${n('ch', '-1')} % 1 == 0 && newData.child('cb').isString() && ${CB} + '/o').exists() && !${CB} + '/at').exists() && ${crSame} && ${sameAr} && ${sameAb} && ${baitNoUp} && ${gearSame} && ${i4Same})`;
  // 즉석 게임 베팅 (2026-11-12): b 는 'slot' 또는 'oddeven'. 금액은 경마와 같은 한도, it 는 지금(서버 시각)이고 지난 판은 정산돼 있어야 하며(ic == it) 지난 판에서 INSTANT_GAP_MS 이상 지났다
  const betInstant = `(((${bIs('slot')} && newData.child('ik').val() == 's' && !newData.child('ip').exists()) || (${bIs('oddeven')} && newData.child('ik').val() == 'o' && (newData.child('ip').val() === 0 || newData.child('ip').val() === 1))) && ${dS} == ${n('ib')} && ${n('ib')} >= 100 && ${n('ib')} <= ${MAXBET} && ${n('ib')} % 100 == 0 && newData.child('it').val() == now && ${d('ic')} == ${d('it')} && (!data.child('it').exists() || now - ${IT} >= ${INSTANT_GAP_MS}) && ${cbSame} && ${sameAr} && ${sameAb} && ${baitNoUp} && ${gearSame} && ${dlSame} && ${pkSame})`;
  // 1:1 내기 판돈 (2026-11-12): b='duel', dl 이 새 내기 id 로 바뀌고 낸 돈이 그 내기의 판돈과 같다. 그 내기는 이 쓰기에서 내가 만들었거나(a), 이 쓰기에서 내가 수락했다(b, acc 가 새로 적힘)
  const DN = `${rootNew}.child('duel/' + newData.child('dl').val())`, D0 = `root.child('duel/' + newData.child('dl').val())`;
  const betDuel = `(${bIs('duel')} && newData.child('dl').isString() && !(${dlSame}) && ${DN}.child('s').isNumber() && ${dS} == ${DN}.child('s').val() && ((${DN}.child('a').val() == auth.uid && !${D0}.exists()) || (${DN}.child('b').val() == auth.uid && ${DN}.child('acc').exists() && !${D0}.child('acc').exists())) && ${cbSame} && ${sameAr} && ${sameAb} && ${baitNoUp} && ${gearSame} && ${i4Only} && ${pkSame})`;
  // 인디언 포커에 거는 돈 (2026-11-12): b='poker'. 낸 돈이 그 판(pk)의 내 자리(ps)에 쌓인 돈의 증가분과 같다. 새 판에 들어갈 때(pk 가 바뀜)는 지난 판을 정산했어야 한다(pk == pc)
  const PHN = `${rootNew}.child('pkh/' + newData.child('pk').val())`, PH0 = `root.child('pkh/' + newData.child('pk').val())`, PSN = `newData.child('ps').val()`;
  const betPoker = `(${bIs('poker')} && newData.child('pk').isString() && (${PSN} == 'a' || ${PSN} == 'b') && ${PHN}.child(${PSN}).val() == auth.uid && ${dS} == ${PHN}.child('p' + ${PSN}).val() - (${PH0}.child('p' + ${PSN}).exists() ? ${PH0}.child('p' + ${PSN}).val() : 0) && ((${pkSame}) || ${d('pk', "''")} == ${d('pc', "''")} || !root.child('pkh/' + data.child('pk').val()).exists()) && ${cbSame} && ${sameAr} && ${sameAb} && ${baitNoUp} && ${gearSame} && ${i4Only} && ${dlSame})`;
  const spend = `(${noSpend} || (${dS} > 0 && newData.child('b').isString() && (${buyBait} || ${buyScroll} || ${buyBat} || ${feed} || ${craft} || ${buyOne} || ${bet} || ${betInstant} || ${betDuel} || ${betPoker})))`;
  // 성(rs)을 올리려면 명품 낚싯대를 가지고 있어야 한다 (킹 성 ks 는 킹 낚싯대). 성이 그대로인 쓰기에는 묻지 않는다:
  //  예전엔 "성 > 0 이면 보유"를 모든 쓰기에 물어서, 낚싯대 없이 성만 남은 지갑은 코인 획득·구매까지 전부 거부됐다 (2026-11-11 실제 발생)
  const rodOwned = `(${rsSame} || ${n('rs')} == 0 || root.child('${pre}users/' + auth.uid + '/own/rod2').val() === true) && (${ksSame} || ${n('ks')} == 0 || root.child('${pre}users/' + auth.uid + '/own/rod3').val() === true)`;
  // 관리자 지급(관리자 페이지의 코인 지급/회수): 관리자가 쓰는 지갑은 형식만 보고 나머지 검사를 건너뛴다. 지급 표시 gf 는 관리자만 바꿀 수 있다
  const admin = `root.child('admins/' + auth.uid).val() === true`;
  const gfSame = `newData.child('gf/at').val() == data.child('gf/at').val() && newData.child('gf/n').val() == data.child('gf/n').val()`;
  return `${base} && (${admin} || (${mono} && ${balance} && (${roulette} || ${normal} || ${race} || ${instantWin} || ${duelWin} || ${pokerWin}) && ${spend} && ${rodOwned} && ${gfSame}))`;
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
      child('gn', 'newData.isNumber() && newData.val() >= 0 && newData.val() % 1 == 0'), // 금덩이 (2026-11-11)
      child('ga', 'newData.isNumber() && newData.val() <= now'),                         // 마지막 채광 시각
      child('ks', 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 30'),  // 킹 낚싯대 성
      child('bt', 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 999 && newData.val() % 1 == 0'), // 빠따 개수 (2026-11-11)
      child('bo', 'newData.isBoolean()'),                                               // 빠따 자동 사용
      child('ik', "newData.val() == 's' || newData.val() == 'o'"),                      // 즉석 게임: 슬롯 | 홀짝 (2026-11-12)
      child('ib', 'newData.isNumber()'),                                                 // 즉석 게임: 건 돈
      child('ip', 'newData.isNumber()'),                                                 // 홀짝에서 고른 쪽 (1 홀 · 0 짝)
      child('it', 'newData.isNumber() && newData.val() <= now'),                         // 즉석 게임: 베팅한 서버 시각
      child('ic', 'newData.isNumber()'),                                                 // 즉석 게임: 정산한 판의 it
      child('dl', 'newData.isString() && newData.val().length <= 40'),                   // 1:1 내기: 판돈을 낸 마지막 내기 id (2026-11-12)
      child('dc', 'newData.isString() && newData.val().length <= 40'),                   // 1:1 내기: 마지막으로 정산한 내기 id
      child('pk', 'newData.isString() && newData.val().length <= 40'),                   // 인디언 포커: 내가 들어간 마지막 판 id (2026-11-12)
      child('ps', "newData.val() == 'a' || newData.val() == 'b'"),                       // 인디언 포커: 그 판의 내 자리
      child('pc', 'newData.isString() && newData.val().length <= 40'),                   // 인디언 포커: 마지막으로 정산한 판 id
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
// ---- 인디언 포커 (2026-11-12, shared/poker.ts 머리말이 설계) ----
// 판 pkh/{hid}, 카드 pkc/{hid}/{a|b}, 테이블 pkt/{t1|t2}. 아래 숫자는 shared/poker.ts 와 같아야 한다 (tests/poker.test.mjs 가 대조)
const POKER_ANTES = [100, 1000, 10000], POKER_CAP_MULT = 50, POKER_TURN_LIMIT_MS = 25000, POKER_DEAL_LIMIT_MS = 20000, POKER_TABLE_STALE_MS = 900000;
function pokerBlocks(ind) {
  const I = ind, J = ind + '  ', K = ind + '    ', L = ind + '      ';
  const N = (k) => `newData.child('${k}').val()`, D = (k) => `data.child('${k}').val()`;
  // 바뀔 수 있는 칸들. 한 번 정해지면 안 바뀌는 칸(t·A·a·an·o)은 아래 칸 규칙이 따로 막는다 (지우는 것은 hasChildren 이 막는다): 경우마다 되풀이하면 규칙이 너무 커진다
  const KEYS = ['b', 'bn', 'pa', 'pb', 'st', 'tj', 'turn', 'n', 'ta', 'w', 'xa', 'xb'];
  // 적은 것 말고는 그대로 (why 는 꾸밈말이라 언제나 뺀다: 형식은 아래 칸 규칙이 본다)
  const keep = (...changed) => KEYS.filter((k) => !changed.includes(k)).map((k) => `${N(k)} == ${D(k)}`).join(' && ');
  const ROOTN = `newData.parent().parent()`; // pkh/$hid 에서 본 "이 쓰기 뒤의 루트"
  const WN = `${ROOTN}.child('wallet/' + auth.uid)`, W0 = `root.child('wallet/' + auth.uid)`;
  const sp = (w) => `(${w}.child('sp').exists() ? ${w}.child('sp').val() : 0)`;
  // 이 쓰기에서 내 지갑이 정확히 delta 만큼 냈다 (지갑 규칙의 betPoker 가 반대쪽에서 같은 것을 본다)
  const paid = (delta, side) => `(${sp(WN)} - ${sp(W0)} == ${delta} && ${WN}.child('pk').val() == $hid && ${WN}.child('ps').val() == '${side}')`;
  const card = (s) => `(((root.child('pkc/' + $hid + '/${s}/at').val() % ${SLOT_MOD}) * ${SLOT_MUL} + ${SLOT_ADD}) % ${SLOT_MOD} % 10)`;
  const bothCards = `(root.child('pkc/' + $hid + '/a').exists() && root.child('pkc/' + $hid + '/b').exists())`;
  const isPlayer = `(auth.uid == ${D('a')} || auth.uid == ${D('b')})`;
  const cases = [];
  // 판 열기: 참가비를 내고 테이블에 올린다
  cases.push(`(!data.exists() && ${N('st')} == 'wait' && ${N('a')} == auth.uid && (${POKER_ANTES.map((a) => `${N('A')} == ${a}`).join(' || ')}) && ${N('pa')} == ${N('A')} && ${N('pb')} == 0 && ${N('o')} == now && ${['b', 'bn', 'tj', 'turn', 'n', 'ta', 'w', 'xa', 'xb'].map((k) => `!newData.hasChild('${k}')`).join(' && ')} && ${paid(N('A'), 'a')} && ${ROOTN}.child('pkt/' + ${N('t')} + '/hid').val() == $hid)`);
  const ex = (s) => `(data.exists() && ${s})`;
  // 기다리던 판 취소 (연 사람)
  cases.push(ex(`${D('st')} == 'wait' && auth.uid == ${D('a')} && ${N('st')} == 'done' && ${N('w')} == 'void' && ${keep('st', 'w')}`));
  // 참가
  cases.push(ex(`${D('st')} == 'wait' && auth.uid != ${D('a')} && ${N('st')} == 'deal' && ${N('b')} == auth.uid && newData.child('bn').isString() && ${N('pb')} == ${D('A')} && ${N('tj')} == now && ${paid(D('A'), 'b')} && ${keep('st', 'b', 'bn', 'pb', 'tj')}`));
  // 베팅 시작: 두 카드가 이미(이 쓰기 전에) 나와 있어야 한다. 그래야 ta(공개되는 시각)가 카드 시각과 같아질 수 없다
  cases.push(ex(`${D('st')} == 'deal' && ${isPlayer} && ${bothCards} && ${N('st')} == 'bet' && ${N('turn')} == 'b' && ${N('n')} == 0 && ${N('ta')} == now && ${keep('st', 'turn', 'n', 'ta')}`));
  // 카드가 제때 안 나왔다: 판 취소 (각자 건 돈을 돌려받는다)
  cases.push(ex(`${D('st')} == 'deal' && ${isPlayer} && !${bothCards} && now > ${D('tj')} + ${POKER_DEAL_LIMIT_MS} && ${N('st')} == 'done' && ${N('w')} == 'void' && ${keep('st', 'w')}`));
  for (const [x, y] of [['a', 'b'], ['b', 'a']]) {
    const mine = `auth.uid == ${D(x)}`, turn = `${D('st')} == 'bet' && ${D('turn')} == '${x}' && ${mine}`;
    // 다이 (언제든. 방을 나가도 다이)
    cases.push(ex(`(${D('st')} == 'deal' || ${D('st')} == 'bet') && ${mine} && ${N('st')} == 'done' && ${N('w')} == '${y}' && ${keep('st', 'w')}`));
    // 체크: 건 돈이 같다. 첫 체크는 차례를 넘기고, 그다음 체크는 공개
    cases.push(ex(`${turn} && ${D('p' + x)} == ${D('p' + y)} && ((${D('n')} == 0 && ${N('st')} == 'bet' && ${N('turn')} == '${y}' && ${N('n')} == 1 && ${N('ta')} == now && ${keep('turn', 'n', 'ta')}) || (${D('n')} > 0 && ${N('st')} == 'show' && ${keep('st')}))`));
    // 콜: 상대가 건 돈에 맞추고 공개. 모자라면 가진 만큼(지갑이 0 이 된다) 올인
    cases.push(ex(`${turn} && ${D('p' + x)} < ${D('p' + y)} && ${N('st')} == 'show' && (${N('p' + x)} == ${D('p' + y)} || (${N('p' + x)} < ${D('p' + y)} && ${N('p' + x)} >= ${D('p' + x)} && ${WN}.child('c').val() == 0)) && ${paid(`${N('p' + x)} - ${D('p' + x)}`, x)} && ${keep('st', 'p' + x)}`));
    // 레이즈: 상대가 건 돈보다 참가비 단위로 더. 한 사람이 걸 수 있는 돈은 참가비 × POKER_CAP_MULT 까지
    cases.push(ex(`${turn} && ${N('st')} == 'bet' && ${N('p' + x)} > ${D('p' + y)} && ${N('p' + x)} <= ${D('A')} * ${POKER_CAP_MULT} && (${N('p' + x)} - ${D('p' + y)}) % ${D('A')} == 0 && ${N('turn')} == '${y}' && ${N('n')} == ${D('n')} + 1 && ${N('ta')} == now && ${paid(`${N('p' + x)} - ${D('p' + x)}`, x)} && ${keep('p' + x, 'turn', 'n', 'ta')}`));
    // 시간 초과: 차례인 x 가 제한 시간을 넘겼거나 접속해 있지 않으면 y 가 이긴 것으로
    cases.push(ex(`${D('st')} == 'bet' && ${D('turn')} == '${x}' && auth.uid == ${D(y)} && (now > ${D('ta')} + ${POKER_TURN_LIMIT_MS} || !root.child('players/' + ${D(x)}).exists()) && ${N('st')} == 'done' && ${N('w')} == '${y}' && ${keep('st', 'w')}`));
    // 정산 표시: 내 몫을 받는 지갑 쓰기(pc = 판 id)와 같이
    cases.push(ex(`${D('st')} == 'done' && ${mine} && ${N('x' + x)} === true && ${D('x' + x)} !== true && ${WN}.child('pc').val() == $hid && ${W0}.child('pc').val() != $hid && ${keep('x' + x)}`));
  }
  // 공개된 판의 결과: 두 카드로 정해진 그대로 (아무나 적는다)
  cases.push(ex(`${D('st')} == 'show' && ${N('st')} == 'done' && ${N('w')} == (${card('a')} > ${card('b')} ? 'a' : (${card('a')} < ${card('b')} ? 'b' : 'tie')) && ${keep('st', 'w')}`));
  const hand = `newData.hasChildren(['t', 'A', 'a', 'an', 'pa', 'pb', 'st', 'o']) && (${cases.join(' || ')})`;
  const str = (max) => `newData.isString() && newData.val().length <= ${max}`;
  const cardNode = (own, dealer) => [
    `${K}"${own}": {`,
    // 카드 주인(own)은 못 읽는다: 상대(dealer)만. 공개된 뒤(show·done)에는 모두
    `${L}".read": ${q(`auth != null && (root.child('pkh/' + $hid + '/${dealer}').val() == auth.uid || root.child('pkh/' + $hid + '/st').val() == 'show' || root.child('pkh/' + $hid + '/st').val() == 'done')`)},`,
    `${L}".write": ${q(`auth != null && !data.exists() && ((newData.exists() && root.child('pkh/' + $hid + '/st').val() == 'deal' && root.child('pkh/' + $hid + '/${dealer}').val() == auth.uid) || (!newData.exists() && !root.child('pkh/' + $hid).exists()))`)},`,
    `${L}".validate": "newData.hasChildren(['at']) && newData.child('at').val() == now",`,
    `${L}"at": { ".validate": true },`,
    `${L}"$other": { ".validate": false }`,
    `${K}}`,
  ].join('\n');
  const HN = `newData.parent().parent().child('pkh/' + newData.child('hid').val())`, H0 = `root.child('pkh/' + data.child('hid').val())`;
  return [
    `${I}"pkh": {`,
    `${J}".read": "auth != null",`,
    `${J}".indexOn": ["o"],`,
    `${J}"$hid": {`,
    `${K}".write": ${q(`auth != null && (newData.exists() || (data.child('st').val() == 'done' && data.child('o').val() < now - 86400000))`)},`,
    `${K}".validate": ${q(hand)},`,
    `${K}"t": { ".validate": "(!data.exists() || newData.val() == data.val()) && (newData.val() == 't1' || newData.val() == 't2')" },`,
    `${K}"an": { ".validate": ${q(`(!data.exists() || newData.val() == data.val()) && ${str(20)}`)} },`,
    ...['A', 'a', 'o'].map((k) => `${K}"${k}": { ".validate": "!data.exists() || newData.val() == data.val()" },`),
    `${K}"bn": { ".validate": ${q(str(20))} },`,
    `${K}"why": { ".validate": ${q(str(10))} },`,
    ...['b', 'pa', 'pb', 'st', 'tj', 'turn', 'n', 'ta', 'w', 'xa', 'xb'].map((k) => `${K}"${k}": { ".validate": true },`),
    `${K}"$other": { ".validate": false }`,
    `${J}}`,
    `${I}},`,
    `${I}"pkc": {`,
    `${J}"$hid": {`,
    cardNode('a', 'b') + ',',
    cardNode('b', 'a') + ',',
    `${K}"$other": { ".validate": false }`,
    `${J}}`,
    `${I}},`,
    `${I}"pkt": {`,
    `${J}".read": "auth != null",`,
    `${J}"$t": {`,
    `${K}".write": "auth != null && newData.exists()",`,
    // 새 판을 테이블에 올린다: 지금 판이 끝났거나(done) 없거나 너무 오래됐을 때만
    `${K}".validate": ${q(`($t == 't1' || $t == 't2') && newData.child('hid').isString() && ${HN}.child('t').val() == $t && ${HN}.child('o').val() == now && ${HN}.child('a').val() == auth.uid && (!data.exists() || !${H0}.exists() || ${H0}.child('st').val() == 'done' || ${H0}.child('o').val() < now - ${POKER_TABLE_STALE_MS})`)},`,
    `${K}"hid": { ".validate": true },`,
    `${K}"$other": { ".validate": false }`,
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
    `${ind}  "nr": { ".validate": "newData.isBoolean()" },`, // 만렙 펫을 타지 않고 데리고 다닌다 (2026-11-12)
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
  // 5) 인디언 포커 블록(pkh · pkc · pkt): 있으면 지우고 casino 블록 앞에 다시 만들어 넣는다
  for (const key of ['pkh', 'pkc', 'pkt']) {
    const at = t.indexOf(`\n    "${key}": {`);
    if (at < 0) continue;
    let e = blockRange(t, key, at)[1];
    if (t[e] === ',') e++;
    t = t.slice(0, at) + t.slice(e);
  }
  const casAt = t.indexOf('\n    "casino": {');
  must(casAt >= 0, 'casino 블록을 못 찾음');
  t = t.slice(0, casAt + 1) + pokerBlocks('    ') + ',\n' + t.slice(casAt + 1);
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
