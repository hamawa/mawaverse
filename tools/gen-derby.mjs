// 경마공원 자료 생성기: src/shared/derby.ts 를 그대로 불러(같은 코드 하나가 원본) 두 가지를 만든다 (README "경마공원 자료 올리기").
//  1) 공개 고정 자료  node tools/gen-derby.mjs
//     raceData.deploy.json (git 에 안 올림) = { sc, odds, v } — v 는 sc·odds 의 SHA-256 앞 16자리. DB raceData/v 와 같으면 다시 올리지 않아도 된다.
//  2) 숨은 결과표     node tools/gen-derby.mjs secret [--days 35] [--replace]
//     serviceAccount.json(Admin SDK)으로 DB 에 바로 올린다 (파일로 남기지 않는다). 경주마다 raceSecret/{n}/{0..3} = 암호학적 난수 7자리 숫자의 칸(derby/secret.ts),
//     덮은 범위 race/cover = { s, e, v, f } (s 이상 e 미만 경주. v = f 이상 e 미만 칸을 만든 고정 자료 버전, s~f 는 남겨 둔 이전 버전의 칸).
//     지금 경주부터 --days 일 뒤까지, 이미 덮은 경주는 그대로 두고 뒤에 잇는다 (같은 버전일 때만).
//     --replace: 다음 경주부터 다시 만든다 (공개 고정 자료·결과 계산 코드가 바뀌었을 때). 지금·지난 경주의 칸은 건드리지 않는다
//     (남은 칸도 화면이 칸에 적힌 1·2·3착·일어난 일을 그대로 공개하므로 정산된다).
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash, randomInt } from 'node:crypto';

registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx); } catch (e) {
      if (spec.startsWith('.') && !/\.[cm]?[jt]s$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
  load(url, ctx, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, ctx);
    return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
  },
});

const { derbyStaticData, derbySecretEntry, raceNo, DERBY_DRAW_SLOTS, DERBY_CYCLE_MS } = await import('../src/shared/derby.ts');

export const RACES_PER_DAY = 86400000 / DERBY_CYCLE_MS;
const CHUNK = 500; // 한 번에 올리는 경주 수 (쓰기 하나가 너무 커지지 않게)

// 공개 고정 자료와 버전
export function publicRaceData() {
  const data = derbyStaticData();
  return { ...data, v: createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16) };
}

// 올릴 범위: 지금 경주(cur)부터 days 일 뒤까지. 이미 덮은 범위(cover)는 그대로 두고 그 끝에서 잇는다. replace 면 다음 경주부터 다시
export function planSecret({ cur, cover, days, replace }) {
  const want = cur + Math.round(days * RACES_PER_DAY);
  const end = replace && cover && Number.isInteger(cover.e) ? Math.max(want, cover.e) : want; // 다시 만들 때는 덮었던 경주를 모두 새 칸으로
  const from = replace ? cur + 1 : Math.max(cur, cover && Number.isInteger(cover.e) && cover.s <= cur ? cover.e : cur);
  const s = cover && Number.isInteger(cover.s) && cover.s <= from && from <= cover.e ? cover.s : from;
  return { from, end: Math.max(from, end), s };
}

// [from, end) 경주의 숨은 칸 (경주마다 DERBY_DRAW_SLOTS 칸, 칸마다 0 ~ 9,999,999 의 암호학적 난수)
export function* secretChunks(from, end, rand = (k) => randomInt(0, k)) {
  for (let a = from; a < end; a += CHUNK) {
    const patch = {};
    for (let n = a; n < Math.min(end, a + CHUNK); n++) {
      patch[`raceSecret/${n}`] = Array.from({ length: DERBY_DRAW_SLOTS }, () => derbySecretEntry(n, String(rand(10_000_000)).padStart(7, '0')));
    }
    yield patch;
  }
}

// 덮은 범위 기록: v 는 f 이상 e 미만 경주의 칸을 만든 자료 버전이다. s 이상 f 미만은 --replace 때 남겨 둔 이전 버전의 칸
//  (공개는 칸에 적힌 그대로 하므로 정산에는 영향이 없다). 같은 버전으로 이을 때만 f 를 그대로 둔다
export function coverRecord(plan, cover, v, replace) {
  const same = !replace && cover && cover.v === v && plan.s === cover.s;
  return { s: plan.s, e: plan.end, v, f: same ? (Number.isInteger(cover.f) ? cover.f : cover.s) : plan.from };
}

// 올리기 (write(patch) = 루트에 다중 경로 update). 칸을 다 올린 뒤에 덮은 범위를 고친다: 범위 안의 경주는 언제나 칸이 있다.
//  다른 버전으로 만든 범위 뒤에 잇지 않는다 (버전 표시가 거짓이 되므로): 그때는 --replace
export async function uploadSecret({ write, cur, cover, days = 35, replace = false, v, log = () => {} }) {
  if (!replace && cover && cover.v !== undefined && cover.v !== v) throw new Error(`덮은 범위의 자료 버전(${cover.v})이 지금(${v})과 다릅니다. --replace 로 다시 만드세요.`);
  const plan = planSecret({ cur, cover, days, replace });
  if (plan.from >= plan.end) { log(`이미 ${cover.e} 경주 전까지 덮여 있습니다 (할 일 없음).`); return plan; }
  let done = 0;
  for (const patch of secretChunks(plan.from, plan.end)) {
    await write(patch);
    done += Object.keys(patch).length;
    log(`  숨은 결과표 ${done} / ${plan.end - plan.from} 경주`);
  }
  await write({ 'race/cover': coverRecord(plan, cover, v, replace) });
  return plan;
}

const main = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (main && process.argv[2] === 'secret') {
  const args = process.argv.slice(3);
  const daysAt = args.indexOf('--days'), days = daysAt >= 0 ? Number(args[daysAt + 1]) : 35;
  if (!(days > 0 && days <= 60)) { console.error('--days 는 1~60 일입니다.'); process.exit(1); }
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const env = {};
  const envFile = resolve(ROOT, '.env.local');
  if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const databaseURL = process.env.DATABASE_URL || env.VITE_FIREBASE_DATABASE_URL;
  const saPath = process.env.SERVICE_ACCOUNT || resolve(ROOT, 'serviceAccount.json');
  if (!existsSync(saPath)) { console.error(`서비스 계정 키가 없습니다: ${saPath}`); process.exit(1); }
  if (!databaseURL) { console.error('.env.local 의 VITE_FIREBASE_DATABASE_URL 또는 환경변수 DATABASE_URL 이 필요합니다.'); process.exit(1); }
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const db = getDatabase(initializeApp({ credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))), databaseURL }));
  const offset = (await db.ref('.info/serverTimeOffset').once('value')).val() || 0;
  const cur = raceNo(Date.now() + offset);
  const cover = (await db.ref('race/cover').once('value')).val();
  const { v } = publicRaceData();
  if ((await db.ref('raceData/v').once('value')).val() !== v) console.warn(`주의: DB raceData/v 가 이 PC 의 고정 자료(${v})와 다릅니다. raceData 를 먼저 올리세요.`);
  const plan = await uploadSecret({ write: (p) => db.ref().update(p), cur, cover, days, replace: args.includes('--replace'), v, log: console.log });
  console.log(`숨은 결과표: 경주 ${plan.s} ~ ${plan.end - 1} (지금 경주 ${cur}, 약 ${((plan.end - cur) / RACES_PER_DAY).toFixed(1)}일 뒤까지)`);
  process.exit(0);
} else if (main) {
  const data = publicRaceData();
  const out = JSON.stringify(data);
  writeFileSync(fileURLToPath(new URL('../raceData.deploy.json', import.meta.url)), out);
  console.log(`raceData.deploy.json: ${out.length} bytes (sc ${data.sc.length}, odds ${data.odds.length})`);
  console.log(data.v);
}
