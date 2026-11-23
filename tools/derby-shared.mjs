// 경마 운영 프로그램이 쓰는 화면 쪽 공용 코드(src/shared/*.ts)를 Node 에서 그대로 불러온다 (gen-derby.mjs 와 같은 방식: 같은 코드가 원본).
// 고정 자료 버전 해시도 gen-derby.mjs 와 같은 규칙: sha256(JSON.stringify({sc, tbl, odds})) 앞 16자리.
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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

const derby = await import('../src/shared/derby.ts');
const { normalizeRaceHours } = await import('../src/shared/config.ts');
const { parseBreaks } = await import('../src/shared/hours.ts');

export const { derbyStaticData, derbyResolve, raceScheduled, raceNo, cycleStart, DERBY_SALE_MS, DERBY_CYCLE_MS } = derby;
export { normalizeRaceHours, parseBreaks };

// 이 PC 의 코드가 만드는 고정 자료의 버전 (DB raceData/v 와 같아야 발매·추첨한다)
export function localDataVersion() {
  return createHash('sha256').update(JSON.stringify(derbyStaticData())).digest('hex').slice(0, 16);
}

export function readJson(rel) {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
}
