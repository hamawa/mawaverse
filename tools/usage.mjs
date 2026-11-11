// Firebase 사용량 점검 (Spark 한도 대비). Cloud Monitoring API 를 읽는다.
//   node tools/usage.mjs            → 이번 달 누적·한도, 최근 7일 일별, 최근 24시간 시간별(KST)
//   node tools/usage.mjs window 2026-11-09T03:30:00Z 2026-11-09T03:50:00Z 60   → 구간을 60초 단위로 (스파이크 추적)
// 인증: serviceAccount.json 은 모니터링 권한이 없어서(403) `firebase login` 한 계정(프로젝트 소유자)의 refresh token 을
// ~/.config/configstore/firebase-tools.json 에서 읽어 쓴다. OAuth 클라이언트 값은 전역 설치된 firebase-tools 에서 가져온다(코드에 적어 두지 않는다). 토큰은 출력하지 않는다.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// 프로젝트 ID 는 .firebaserc 의 default (또는 환경변수 FIREBASE_PROJECT)
const PROJECT = process.env.FIREBASE_PROJECT || JSON.parse(readFileSync('.firebaserc', 'utf8')).projects.default;
const DB = 'firebasedatabase.googleapis.com/';
const HOST = 'firebasehosting.googleapis.com/';

async function token() {
  const store = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
  const api = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'firebase-tools/lib/api.js')).href);
  const cli = api.default || api;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cli.clientId(), client_secret: cli.clientSecret(),
      refresh_token: store.tokens.refresh_token, grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`firebase CLI 토큰 갱신 실패: ${j.error} ${j.error_description || ''} (firebase login 을 다시)`);
  return j.access_token;
}

const tok = await token();
async function series(type, start, end, periodSec) {
  const sum = type.endsWith('_count');
  let url = `https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?filter=${encodeURIComponent(`metric.type = "${type}"`)}` +
    `&interval.startTime=${start.toISOString()}&interval.endTime=${end.toISOString()}&pageSize=5000`;
  if (periodSec) url += `&aggregation.alignmentPeriod=${periodSec}s&aggregation.perSeriesAligner=${sum ? 'ALIGN_SUM' : 'ALIGN_MAX'}&aggregation.crossSeriesReducer=${sum ? 'REDUCE_SUM' : 'REDUCE_MAX'}`;
  const j = await (await fetch(url, { headers: { Authorization: `Bearer ${tok}` } })).json();
  if (j.error) throw new Error(`${type}: ${j.error.message}`);
  const pts = [];
  for (const s of j.timeSeries || []) for (const p of s.points) pts.push({ t: new Date(p.interval.endTime), v: Number(p.value.int64Value ?? p.value.doubleValue ?? 0) });
  return pts.sort((a, b) => a.t - b.t);
}
const MB = (b) => (b / 1e6).toFixed(b >= 100e6 ? 0 : 1) + ' MB';
const GB = (b) => (b / 1e9).toFixed(2) + ' GB';
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const latest = async (type) => { const p = await series(type, new Date(Date.now() - 86400e3), new Date()); return p.at(-1)?.v ?? 0; };

const mode = process.argv[2] || 'summary';
if (mode === 'window') {
  const [s, e, sec = '60', ...extra] = process.argv.slice(3);
  const types = extra.length ? extra : [DB + 'network/sent_bytes_count', DB + 'io/sent_responses_count', DB + 'network/api_hits_count', DB + 'network/active_connections'];
  const rows = {};
  for (const t of types) for (const p of await series(t, new Date(s), new Date(e), Number(sec))) (rows[p.t.toISOString()] ||= {})[t] = p.v;
  const names = types.map((t) => t.split('/').slice(-2).join('/'));
  console.log('끝 시각(KST)'.padEnd(17) + names.map((n) => n.padStart(28)).join(''));
  for (const k of Object.keys(rows).sort()) console.log(kst(new Date(k)).padEnd(17) + types.map((t) => { const v = rows[k][t]; return (v == null ? '-' : /bytes/.test(t) ? MB(v) : String(Math.round(v))).padStart(28); }).join(''));
  process.exit(0);
}

const [sent, sentLim, stor, storLim, conn, hSent, hLim, hStor, off] = await Promise.all([
  latest(DB + 'network/monthly_sent'), latest(DB + 'network/monthly_sent_limit'), latest(DB + 'storage/total_bytes'), latest(DB + 'storage/limit'),
  latest(DB + 'network/active_connections'), latest(HOST + 'network/monthly_sent'), latest(HOST + 'network/monthly_sent_limit'), latest(HOST + 'storage/total_bytes'),
  latest(DB + 'network/disabled_for_overages'),
]);
const now = new Date();
const dayOfMonth = now.getUTCDate() + now.getUTCHours() / 24;
console.log(`== Realtime Database (이달 누적, 매월 1일 초기화)`);
console.log(`  다운로드  ${GB(sent)} / ${GB(sentLim)}  (${(100 * sent / sentLim).toFixed(1)}%, 하루 평균 ${MB(sent / dayOfMonth)} → 이 속도면 월말 ${GB(sent / dayOfMonth * 30)})${off ? '  ⚠ 한도 초과로 비활성화됨' : ''}`);
console.log(`  저장      ${MB(stor)} / ${GB(storLim)}`);
console.log(`  동시 접속 ${conn} / 100 (최근 측정)`);
console.log(`== Hosting (이달 누적)`);
console.log(`  전송 ${MB(hSent)} / ${GB(hLim)} · 저장 ${MB(hStor)} / 10 GB`);

console.log(`== 최근 7일 (UTC 하루 = KST 09:00~다음날 09:00): 다운로드 · 최대 동시 접속`);
const d0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7));
const daily = await series(DB + 'network/sent_bytes_count', d0, now, 86400);
const peaks = await series(DB + 'network/active_connections', d0, now, 86400);
for (const p of daily) {
  const pk = peaks.find((q) => q.t.getTime() === p.t.getTime());
  const day = new Date(p.t.getTime() - 1); // 버킷 끝 직전 = 그 UTC 날짜
  console.log(`  ${day.toISOString().slice(0, 10)}  ${MB(p.v).padStart(9)}  접속 ${pk ? pk.v : '-'}${p.t > now ? ' (진행 중)' : ''}`);
}

console.log(`== 최근 24시간 시간별 (KST, 시간 끝 기준): 다운로드 · 응답 수 · 접속`);
const h0 = new Date(now.getTime() - 24 * 3600e3);
const hb = await series(DB + 'network/sent_bytes_count', h0, now, 3600);
const hr = await series(DB + 'io/sent_responses_count', h0, now, 3600);
const hc = await series(DB + 'network/active_connections', h0, now, 3600);
for (const p of hb) {
  const r = hr.find((q) => q.t.getTime() === p.t.getTime()), c = hc.find((q) => q.t.getTime() === p.t.getTime());
  if (p.v < 1e5 && !c?.v) continue;
  console.log(`  ${kst(p.t)}  ${MB(p.v).padStart(9)}  ${String(r?.v ?? '-').padStart(8)}  접속 ${c?.v ?? '-'}`);
}
