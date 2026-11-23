// 경마공원 운영 프로세스의 본체. 전송·시계·난수·타이머는 전부 바깥에서 넣는다(deps) — 시험은 가짜로 결정적으로 돈다.
// 계약(SPEC 경마공원 "결과 추첨과 장애 처리"):
//  - race/op/hb = 서버 시각, 운영 중 약 20초마다.
//  - race/r/{n} = {g:true, v:raceData/v, at:서버 시각}: 발매 4분 전체가 운영 시간·이용 시간 차단에 드는 경주를 한 번만 승인.
//  - race/x/{n} = {k,g,a,b,c,e,at:서버 시각}: 마감 뒤 24시간 안에 한 번만. k·g 는 이 프로세스가 node:crypto 로 직접 뽑는다(클라이언트 입력 없음).
// 서버 시각 앵커: 하트비트 쓰기(.sv)의 응답으로 받은 서버 시각을, 요청 전후의 단조 시계(mono)로 감싸 둔다.
//  nowLow = 서버 시각이 이미 지났을 하한, nowHigh = 아직 안 지났을 상한. 기기의 벽시계(wall)는 시각 계산에 쓰지 않고,
//  시계 점프·잠자기 복귀를 알아채는 데만 쓴다. 의심스러우면(끊김·오류·점프·낡음) 앵커를 버리고, 새 하트비트로 다시 확인될 때까지
//  승인·추첨을 하지 않는다. 읽기·쓰기 전송은 SDK 큐나 캐시가 없는 REST 라서, 끊긴 동안 쌓였다 흘러가는 쓰기가 없다.
import { randomInt } from 'node:crypto';
import {
  derbyResolve, raceScheduled, raceNo, cycleStart, DERBY_SALE_MS, normalizeRaceHours,
} from './derby-shared.mjs';

export const TICK_MS = 1000;
export const HB_MS = 20000;                    // 하트비트 주기 (규칙은 60초 미만을 요구)
export const HB_FRESH_MS = 40000;              // 이보다 낡은 앵커로는 승인·추첨을 하지 않는다
export const HB_LEAD_MS = 30000;               // 첫 경주 시작 이만큼 전부터 하트비트
export const IDLE_REFRESH_MS = 240000;         // 운영 시간이 아닐 때 서버 시각을 다시 확인하는 주기
export const PLAN_AGE_MS = 600000;             // 일정을 가늠하는 용도로만 쓸 수 있는 앵커의 최대 나이
export const MAX_RTT_MS = 5000;                // 하트비트 왕복이 이보다 길면 시각 표본으로 쓰지 않는다
export const CLOCK_JUMP_MS = 5000;             // 벽시계와 단조 시계가 이만큼 어긋나면 점프·잠자기 복귀로 본다
export const STALL_MS = 10000;                 // 주기 사이가 이보다 벌어지면 프로세스가 멈췄던 것으로 본다
export const CONFIG_MS = 30000;                // 설정(DB)을 다시 읽는 주기
export const CONFIG_MAX_AGE_MS = 120000;       // 설정을 이보다 오래 못 읽으면 닫힌 채로 둔다
export const GRANT_CUTOFF_MS = DERBY_SALE_MS - 15000; // 마감 15초 전까지만 새로 승인 (그 뒤는 쓸모가 없다)
export const DRAW_DELAY_MS = 1000;             // 마감 뒤 이만큼 지나서 추첨 (서버 시각 어림 오차 여유)
export const DRAW_WINDOW_MS = 24 * 3600000;    // 마감 후 24시간 뒤에는 환급 경로가 넘겨받는다
export const DRAW_SAFETY_MS = 5000;            // 24시간 직전 이만큼은 쓰지 않는다
export const SCAN_LIMIT = 260;                 // 복구 때 읽는 최대 경주 수 (24시간 = 240경주)
const RETRY_BASE_MS = 2000, RETRY_MAX_MS = 20000, DENIED_RETRY_MS = 60000, BACKSTEP_SLACK_MS = 1000;
const MIN_SERVER_TS = Date.UTC(2020, 0, 1), MAX_SERVER_TS = Date.UTC(2100, 0, 1);

const backoff = (fails) => Math.min(RETRY_BASE_MS * 2 ** Math.max(0, fails - 1), RETRY_MAX_MS);
// 오류는 코드 한 단어만 로그에 싣는다(주소·토큰·응답 본문이 새지 않게)
const tag = (e) => (e && typeof e.code === 'string' && /^[\w./-]{1,60}$/.test(e.code) ? e.code : 'error');
const digitsOf = (k, g) => String(k).padStart(4, '0') + String(g).padStart(3, '0');
const closeAt = (n) => cycleStart(n) + DERBY_SALE_MS;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const timestamp = (v) => Number.isSafeInteger(v) && v >= MIN_SERVER_TS && v < MAX_SERVER_TS;
const sameDraw = (res, d) => isObj(res) && res.k === d.k && res.g === d.g && res.a === d.a && res.b === d.b && res.c === d.c && res.e === d.e && timestamp(res.at);
const isGrant = (x) => isObj(x) && x.g === true && typeof x.v === 'string' && /^[0-9a-f]{16}$/.test(x.v) && timestamp(x.at);
// 불완전하거나 엉뚱한 읽기 응답을 확정으로 세지 않는다.
function isFinalSlot(x, n) {
  if (!isObj(x) || !timestamp(x.at)) return false;
  if (x.v === true) return true;
  if (!Number.isInteger(x.k) || x.k < 0 || x.k >= 10000 || !Number.isInteger(x.g) || x.g < 0 || x.g >= 1000) return false;
  return sameDraw(x, { k: x.k, g: x.g, ...derbyResolve(n, digitsOf(x.k, x.g)).res });
}

/**
 * deps = {
 *   store:  { uid, SERVER_TS, get(path), put(path, value)->쓴 값(서버 시각이 풀린 것), range(path, fromKey, limit)->{key: value}, close() }
 *           오류는 { code, net } 를 단다: net=true 면 끊김·시간 초과·5xx 처럼 결과를 모르는 오류, false 면 서버가 분명히 거절한 오류.
 *   clock:  { wall(), mono() }   wall 은 점프 감지에만, mono 는 서버 시각의 경과 계산에 쓴다
 *   timers: { setInterval(fn, ms)->h, clearInterval(h) }
 *   random: { int(min, maxExclusive) }                 기본은 node:crypto randomInt
 *   localVersion: string, holidays, breaks, log(msg)
 * }
 */
export function createDerbyOperator(deps) {
  const { store, timers, clock, localVersion, holidays = {}, breaks = [] } = deps;
  const random = deps.random ?? { int: (a, b) => randomInt(a, b) };
  const log = deps.log ?? (() => {});

  // 설정(REST 로 읽은 값). undefined = 아직 못 읽음(없는 값 null 과 구분. 모르면 닫힌 것으로 본다)
  let opUid, hoursRaw, hoursBlock, remoteV, cfgAt = null, cfgNextAt = 0, cfgFails = 0;
  let anchor = null;            // { srv, sent, recv } 하트비트로 확인한 서버 시각과 그 요청 전후의 mono
  let lastAnchor = null;        // 버린 앵커도 기억: 새 표본이 이보다 과거로 가면 낡은 데이터다
  let epoch = 0;                // 앵커를 버릴 때마다 오른다: 그 전에 시작한 비동기 작업의 결과는 상태를 바꾸지 못한다
  let needScan = true, nextScanAt = 0, ready = false, hbFails = 0, hbNextAt = 0, lastW = null, lastM = null;
  let connectionFails = 0, connectionNextAt = 0;
  let timer = null, stopped = false, running = null;

  const races = new Map();      // n -> { n, v, done, pending, fails, nextAt }  (승인이 확인된 경주)
  const grantTry = new Map();   // n -> { fails, nextAt, blocked }
  const notes = new Map();

  const note = (scope, key, msg) => {
    if (notes.get(scope) === key) return;
    notes.set(scope, key);
    log(msg);
  };
  const clear = (scope) => { notes.delete(scope); };
  const mono = () => clock.mono();
  const ok = (ep) => !stopped && epoch === ep;

  // 서버 시각의 범위. 앵커가 없거나 낡았으면 쓰지 않는다
  const age = () => (anchor ? mono() - anchor.recv : Infinity);
  const nowLow = () => anchor.srv + (mono() - anchor.recv);
  const nowHigh = () => anchor.srv + (mono() - anchor.sent);
  const anchored = () => anchor !== null && age() >= 0 && age() <= HB_FRESH_MS;
  const planNow = () => (anchor !== null && age() <= PLAN_AGE_MS ? nowLow() : null);

  function invalidate(why) {
    anchor = null; epoch++; needScan = true; cfgAt = null; cfgNextAt = 0;
    if (ready) { ready = false; log(`서버 시각 확인을 잃었습니다(${why}). 다시 확인될 때까지 새 발매 승인·추첨 쓰기를 멈춥니다(하트비트는 60초 뒤 만료).`); }
  }

  // 주기마다: 벽시계 점프·프로세스 멈춤(잠자기 복귀)을 알아챈다
  function monitor() {
    const w = clock.wall(), m = mono();
    if (lastW !== null) {
      const dw = w - lastW, dm = m - lastM;
      if (dm < 0 || dm > STALL_MS || Math.abs(dw - dm) > CLOCK_JUMP_MS) invalidate('기기 시계 변경 또는 프로세스 멈춤');
    }
    lastW = w; lastM = m;
  }

  // 전송 호출을 감싼다: 결과를 모르는 오류(끊김·시간 초과·5xx)는 서버 시각 확인을 버린다
  async function net(fn) {
    const ep = epoch;
    try {
      const value = await fn();
      if (!stopped) monitor();
      return value;
    } catch (e) {
      if (ok(ep) && e && e.net) {
        note('conn', tag(e), `서버와 통신하지 못했습니다(${tag(e)}). 연결과 서버 시각이 다시 확인될 때까지 새 발매 승인·추첨을 멈춥니다.`);
        invalidate(tag(e));
        connectionNextAt = mono() + backoff(++connectionFails);
      }
      throw e;
    }
  }

  const env = () => ({ holidays, breaks, hoursBlock: hoursBlock === true });
  const scheduled = (n) => hoursRaw !== undefined && hoursBlock !== undefined && raceScheduled(n, normalizeRaceHours(hoursRaw), env());

  // 설정으로 정해지는 문: UID·고정 자료 버전. 아니면 이유를 알린다 (이유가 바뀔 때만 한 줄)
  function cfgGate() {
    if (cfgAt === null || mono() - cfgAt > CONFIG_MAX_AGE_MS) return { ok: false, key: 'cfg', msg: null };
    if (opUid !== store.uid) return { ok: false, key: 'uid', msg: `config/raceOperatorUid 가 이 운영 계정의 UID(${store.uid})와 다릅니다. 관리자가 설정에서 이 UID 로 지정할 때까지 발매를 승인하지 않습니다.` };
    if (remoteV === null) return { ok: false, key: 'nodata', msg: 'DB raceData 가 아직 게시되지 않았습니다. 이 PC 의 자료(tools/gen-derby.mjs 로 생성)를 관리자가 게시하고 규칙을 갱신한 뒤 다시 시작하세요. 그동안 신규 발매·추첨을 하지 않습니다.' };
    if (remoteV !== localVersion) return { ok: false, key: `ver:${remoteV}`, msg: `이 PC 의 고정 자료 버전(${localVersion})이 DB raceData/v(${String(remoteV).slice(0, 40)})와 다릅니다. 저장소를 최신으로 맞추거나 올바른 자료가 게시됐는지 확인한 뒤 프로그램을 다시 시작하세요. 그동안 신규 발매·추첨을 하지 않습니다.` };
    return { ok: true, key: 'ok' };
  }

  // await 뒤에는 시작한 세대·본인·자료·시각의 유효성을 다시 확인한다.
  function active(ep) {
    if (!ok(ep)) return false;
    monitor();
    return ok(ep) && cfgGate().ok && anchored();
  }

  async function refreshConfig(ep) {
    const m = mono();
    if ((cfgAt !== null && m - cfgAt < CONFIG_MS) || m < cfgNextAt) return true;
    try {
      const [u, h, b, v] = await Promise.all([
        net(() => store.get('config/raceOperatorUid')), net(() => store.get('config/raceHours')),
        net(() => store.get('config/hoursBlock')), net(() => store.get('raceData/v')),
      ]);
      if (!ok(ep)) return false;
      const changed = opUid !== undefined && (opUid !== (u ?? null) || remoteV !== (v ?? null));
      opUid = u ?? null; hoursRaw = h ?? null; hoursBlock = b === true; remoteV = v ?? null;
      if (changed) invalidate('운영 계정 또는 자료 버전 변경');
      cfgAt = mono(); cfgFails = 0; clear('cfg');
    } catch (e) {
      if (!ok(ep)) return false;
      cfgAt = null;
      cfgFails++; cfgNextAt = mono() + backoff(cfgFails);
      note('cfg', tag(e), `설정(config/raceOperatorUid·raceHours·hoursBlock, raceData/v)을 읽지 못했습니다(${tag(e)}). 읽을 때까지 신규 발매·추첨을 하지 않습니다.`);
    }
    return ok(ep);
  }

  function track(n, v) {
    if (!races.has(n)) races.set(n, { n, v, done: false, pending: null, fails: 0, nextAt: 0 });
    return races.get(n);
  }

  const wantHb = (t) => {
    if (scheduled(raceNo(t)) || scheduled(raceNo(t + HB_LEAD_MS))) return true;
    const n = raceNo(t);
    return races.has(n) && t - cycleStart(n) < DERBY_SALE_MS; // 이미 승인한 경주는 시간 설정이 바뀌어도 마감까지 이어 간다
  };
  const drawDue = (t) => [...races.values()].some((r) => !r.done && r.v === localVersion && t + HB_LEAD_MS >= closeAt(r.n) + DRAW_DELAY_MS && t < closeAt(r.n) + DRAW_WINDOW_MS);

  function sampleDue() {
    if (mono() < hbNextAt) return false;
    const plan = planNow();
    if (plan === null) return true; // 서버 시각을 모르면 확인부터 (하트비트 한 번이 그 표본이다)
    if (wantHb(plan) || drawDue(plan)) return age() >= HB_MS;
    // 거절로 미뤄 둔 복구 스캔은 신선한 앵커가 있어야 돈다: 다시 읽을 차례가 되면 운영 시간이 아니어도 시각부터 확인한다
    if (needScan && mono() >= nextScanAt) return age() >= HB_MS;
    return age() >= IDLE_REFRESH_MS;
  }

  // 하트비트: 서버가 찍어 준 시각을 받아 앵커로 삼는다. 이 표본을 얻는 것은 부트스트랩일 뿐, 그 자체가 승인·추첨의 허가는 아니다
  async function sample(ep) {
    const sent = mono(), sentW = clock.wall();
    try {
      const srv = await net(() => store.put('race/op/hb', store.SERVER_TS));
      const recv = mono(), recvW = clock.wall();
      if (!ok(ep) || !cfgGate().ok) return; // 쓰는 동안 시계 점프·끊김이 있었다: 이 표본은 쓰지 않는다
      const rtt = recv - sent;
      // 요청이 떠 있는 사이 프로세스가 멈췄다 깨어났거나 벽시계가 뛰었다면(mono 로는 안 보인다) 받은 시각은 낡았을 수 있다
      if (Math.abs((recvW - sentW) - rtt) > CLOCK_JUMP_MS) throw Object.assign(new Error('clock moved'), { code: 'bad-time' });
      const behind = lastAnchor !== null && srv < lastAnchor.srv + (sent - lastAnchor.recv) - BACKSTEP_SLACK_MS;
      if (!Number.isInteger(srv) || srv < MIN_SERVER_TS || srv > MAX_SERVER_TS || rtt < 0 || rtt > MAX_RTT_MS || behind) {
        throw Object.assign(new Error('bad sample'), { code: 'bad-time' });
      }
      anchor = lastAnchor = { srv, sent, recv };
      hbFails = 0; hbNextAt = 0; clear('hb'); clear('conn');
      connectionFails = 0; connectionNextAt = 0;
    } catch (e) {
      if (stopped) return;
      hbFails++; hbNextAt = mono() + backoff(hbFails);
      if (ok(ep)) invalidate('하트비트 확인 실패');
      note('hb', tag(e), `하트비트·서버 시각 확인에 실패했습니다(${tag(e)}). 다시 시도합니다.`);
    }
  }

  // 시작·재연결 직후: 아직 확정 안 된 승인 경주를 마감+24시간 안에서 시간 순으로 한정해 읽어 온다
  async function scan(ep) {
    const from = raceNo(nowLow() - DRAW_WINDOW_MS - DERBY_SALE_MS);
    const through = raceNo(nowHigh());
    try {
      const [rs, xs] = await Promise.all([net(() => store.range('race/r', from, SCAN_LIMIT, through)), net(() => store.range('race/x', from, SCAN_LIMIT, through))]);
      if (!active(ep)) return; // 그사이 앵커를 잃었다면 이 답은 낡았다: needScan 은 그대로 둬서 다시 읽는다
      for (const key of Object.keys(rs ?? {}).map(Number).filter((n) => Number.isSafeInteger(n) && n >= from && n <= through).sort((a, b) => a - b)) {
        const r = rs[key];
        if (!isGrant(r)) continue;
        const rec = track(key, r.v);
        if (isFinalSlot(xs?.[key], key)) { rec.done = true; rec.pending = null; }
      }
      for (const n of [...races.keys()]) if (n < from) { races.delete(n); grantTry.delete(n); }
      needScan = false; clear('scan');
    } catch (e) {
      if (active(ep) && e?.net === false) nextScanAt = mono() + DENIED_RETRY_MS;
      if (!stopped) note('scan', tag(e), `복구 스캔(race/r·race/x)을 읽지 못했습니다(${tag(e)}). 다시 시도합니다.`);
    }
  }

  async function grant(ep) {
    if (!active(ep)) return;
    const lo = nowLow(), hi = nowHigh();
    const n = raceNo(lo);
    if (hi - cycleStart(n) >= GRANT_CUTOFF_MS || raceNo(hi) !== n || races.has(n) || !scheduled(n)) return;
    const tr = grantTry.get(n) ?? { fails: 0, nextAt: 0, blocked: false };
    grantTry.set(n, tr);
    if (tr.blocked || mono() < tr.nextAt) return;
    const path = `race/r/${n}`;
    try {
      const res = await net(() => store.put(path, { g: true, v: localVersion, at: store.SERVER_TS }));
      if (!active(ep)) return;
      if (!(isGrant(res) && res.v === localVersion)) throw Object.assign(new Error('unexpected'), { code: 'bad-response', net: true });
      track(n, localVersion); // 서버가 쓰기를 받았다고 답한 것만 승인으로 센다
      log(`경주 ${n} 발매 승인`);
      clear(`grant:${n}`);
    } catch (e) {
      if (stopped) return;
      if (ok(ep) && e?.net) invalidate('승인 응답 확인 실패');
      tr.fails++; tr.nextAt = mono() + (e?.net === false ? DENIED_RETRY_MS : backoff(tr.fails));
      if (active(ep)) { // 결과를 모르는 오류거나 거절: 서버에 있는 칸을 다시 읽어 확인한다 (없으면 승인이 아니다)
        try {
          const have = await net(() => store.get(path));
          if (active(ep) && have != null) { if (isGrant(have)) track(n, have.v); else tr.blocked = true; return; }
        } catch { /* 읽기도 실패: 아래 알림 */ }
      }
      if (!stopped) note(`grant:${n}`, tag(e), `경주 ${n} 발매 승인을 쓰지 못했습니다(${tag(e)}). 다시 시도합니다.`);
    }
  }

  function finish(rec, how) {
    rec.done = true; rec.pending = null; // 추첨값은 게시된 뒤에는 메모리에서도 버린다
    clear(`draw:${rec.n}`);
    log(how === 'written' ? `경주 ${rec.n} 결과 확정` : `경주 ${rec.n} 결과가 이미 있습니다`);
  }

  function makeDraw(n) {
    const k = random.int(0, 10000), g = random.int(0, 1000);
    const { res } = derbyResolve(n, digitsOf(k, g));
    return { k, g, a: res.a, b: res.b, c: res.c, e: res.e };
  }

  async function draw(rec, ep) {
    const path = `race/x/${rec.n}`;
    rec.pending ??= makeDraw(rec.n); // 같은 프로세스의 재시도(시간 초과·끊김 뒤 포함)는 항상 같은 값을 쓴다
    const d = rec.pending;
    try {
      const res = await net(() => store.put(path, { ...d, at: store.SERVER_TS }));
      if (!active(ep)) return;
      if (!sameDraw(res, d)) throw Object.assign(new Error('unexpected'), { code: 'bad-response', net: true });
      finish(rec, 'written');
    } catch (e) {
      if (stopped) return;
      if (ok(ep) && e?.net) invalidate('결과 응답 확인 실패');
      const denied = e && e.net === false;
      rec.fails++; rec.nextAt = mono() + (denied ? DENIED_RETRY_MS : backoff(rec.fails));
      if (active(ep)) { // 이미 쓰였다는 응답이거나 결과를 모르는 오류: 서버의 칸을 다시 읽는다. 확정 형태일 때만 끝으로 센다
        try {
          const have = await net(() => store.get(path));
          if (active(ep) && isFinalSlot(have, rec.n)) return finish(rec, 'existing');
        } catch { /* 읽기도 실패: 아래 알림 */ }
      }
      if (!stopped) note(`draw:${rec.n}`, tag(e), `경주 ${rec.n} 결과 기록에 실패했습니다(${tag(e)}). 기록이 확인될 때까지 같은 값으로 다시 시도합니다.${denied ? ' 서버가 거절했습니다: 운영 계정 UID·규칙 배포를 확인하세요.' : ''}`);
    }
  }

  async function drawAll(ep) {
    const list = [...races.values()].filter((r) => !r.done).sort((a, b) => a.n - b.n);
    for (const rec of list) {
      if (!active(ep)) return; // 앞선 요청이 오래 걸려 앵커가 낡았다면 다음 하트비트 뒤에
      if (nowLow() < closeAt(rec.n) + DRAW_DELAY_MS) break; // 시간 순이므로 뒤는 더 이르다
      if (nowHigh() >= closeAt(rec.n) + DRAW_WINDOW_MS - DRAW_SAFETY_MS) {
        rec.done = true; rec.pending = null;
        log(`경주 ${rec.n} 은 마감 후 24시간이 지나 추첨하지 않습니다(마권 소유자 환급 경로).`);
        continue;
      }
      if (rec.v !== localVersion) {
        note(`ver:${rec.n}`, String(rec.v), `경주 ${rec.n} 은 다른 자료 버전(${String(rec.v).slice(0, 40)})으로 승인돼 이 PC 에서 추첨할 수 없습니다. 해당 버전의 저장소로 맞춰 다시 시작하세요(24시간 뒤에는 환급 경로).`);
        continue;
      }
      if (mono() < rec.nextAt) continue;
      await draw(rec, ep);
      if (!active(ep)) return;
    }
  }

  async function step() {
    if (mono() < connectionNextAt) return;
    const ep = epoch;
    if (!(await refreshConfig(ep))) return;
    const g = cfgGate();
    if (!g.ok) { if (g.msg) note('gate', g.key, g.msg); return; }
    clear('gate');
    if (sampleDue()) { await sample(ep); if (!ok(ep)) return; }
    if (!active(ep)) return;
    if (!ready) { ready = true; log('운영 준비 완료: 서버 시각·운영 계정·고정 자료 버전이 확인됐습니다.'); }
    if (needScan) {
      if (mono() < nextScanAt) return;
      await scan(ep);
      if (!active(ep) || needScan) return;
    }
    await grant(ep);
    if (!active(ep)) return;
    await drawAll(ep);
  }

  function tick() {
    if (stopped) return Promise.resolve();
    monitor();
    if (running) return running;
    running = step().catch((e) => {
      if (!stopped) note('tick', tag(e), `처리 중 오류가 났습니다(${tag(e)}). 다음 주기에 다시 시도합니다.`);
    }).finally(() => { running = null; });
    return running;
  }

  return {
    start() {
      timer = timers.setInterval(() => { void tick(); }, TICK_MS);
      log(`경마 운영 프로그램 시작 (고정 자료 ${localVersion}). 설정과 서버 시각을 확인하는 중입니다.`);
    },
    // 시험·진단용: 한 주기를 지금 돌리고 끝날 때까지 기다린다
    tick,
    status() {
      return {
        ready, anchored: anchored(), needScan, epoch,
        tracked: [...races.values()].map((r) => ({ n: r.n, done: r.done, pending: !!r.pending })),
        serverNow: anchored() ? nowLow() : null,
      };
    },
    async stop() {
      if (stopped) return;
      stopped = true; epoch++;
      if (timer !== null) timers.clearInterval(timer);
      timer = null;
      const closing = store.close(); // 진행 중인 요청은 끊는다. 이미 서버에 닿았는지는 알 수 없다: 재시작 때 복구 스캔이 이어 간다
      await running;
      await closing;
      for (const r of races.values()) r.pending = null;
      log('경마 운영 프로그램을 종료했습니다. 하트비트는 60초 안에 만료되어 신규 발매가 멈추고, 진행 중이던 경주는 재시작하면 이어서 확인합니다.');
    },
  };
}
