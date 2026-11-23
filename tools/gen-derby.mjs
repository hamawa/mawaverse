// 경마공원 고정 자료 생성기: src/shared/derby.ts 를 그대로 불러(같은 코드 하나가 원본) raceData.deploy.json 을 만든다 (git 에 안 올림).
// 내용: { sc, tbl, odds, v } — v 는 sc·tbl·odds 의 SHA-256 앞 16자리. 배포는 DB raceData/v 와 같으면 올리지 않아도 된다.
// 실행: node tools/gen-derby.mjs   (마지막 줄에 v 를 출력한다)
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
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

const { derbyStaticData } = await import('../src/shared/derby.ts');
const data = derbyStaticData();
const body = JSON.stringify(data);
const v = createHash('sha256').update(body).digest('hex').slice(0, 16);
const out = JSON.stringify({ ...data, v });
const file = fileURLToPath(new URL('../raceData.deploy.json', import.meta.url));
writeFileSync(file, out);
console.log(`raceData.deploy.json: ${out.length} bytes (sc ${data.sc.length}, tbl ${data.tbl.length}×${data.tbl[0].length}, odds ${data.odds.length})`);
console.log(v);
