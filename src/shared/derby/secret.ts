// 경마공원 숨은 결과표 (2026-11-24, 운영 PC 없이. SPEC "경마공원 · 결과 추첨과 공개").
//  raceSecret/{n}/{0..3} = 결과 칸 글자열 o: 7자리 숫자(derbyResolve 의 입력: 기본 착순 칸 4자리 + 몸짓 추첨 3자리)를 24자리 2진수로 + 1·2·3착 순위 + 일어난 일 e.
//   관리자 도구(tools/gen-derby.mjs secret)가 암호학적 난수로 경주마다 4칸씩 만들어 올린다. 화면은 읽을 수 없고(규칙 .read false) 규칙만 대조에 쓴다.
//  추첨: 마감 뒤 누구든 race/x/{n}/at 에 서버 시각을 한 번 쓴다 → 그 경주의 칸은 at % 4 (쓰는 사람도 칸의 내용을 모른다).
//  공개: race/q/{n}/{2진수 앞자리} 에 null 을 쓰면 규칙이 "그 칸이 이 앞자리로 시작할 때만" 허용한다(저장되는 것은 없다). 24번 물어 2진수를 알아내고
//   race/x/{n} 에 { o, a, b, c, e } 를 쓴다(규칙이 o == 그 칸이고 o 가 a+b+c+e 로 끝날 때만 받는다). 정산과 쇼의 1·2·3착·일어난 일은 이 공개값으로만 한다.
//   뒷부분은 보통 지금 결과 계산으로 맞히고(묻기 없음), 계산 코드가 결과표를 만든 뒤 바뀌었으면 derbyProbeSuffix 로 마저 묻는다.
import { derbyResolve, type DerbyRes } from './scenario';

export const DERBY_DRAW_SLOTS = 4;      // 경주마다 숨은 칸 수 (규칙: at % 4)
export const DERBY_SECRET_BITS = 24;    // 7자리 숫자 0 ~ 9,999,999 의 2진수 자리 수
const DIGITS_END = 10_000_000;

// 7자리 숫자 → 숨은 칸 글자열 (생성기와 공개하는 화면이 같은 식을 쓴다)
export function derbySecretEntry(n: number, digits: string): string {
  const res = derbyResolve(n, digits).res;
  return Number(digits).toString(2).padStart(DERBY_SECRET_BITS, '0') + res.a + res.b + res.c + res.e;
}
// 알아낸 앞자리 다음 자리가 1 일 수 있나 (7자리 숫자 범위를 넘으면 묻지 않아도 0)
export function derbyBitMayBeOne(bits: string): boolean {
  return parseInt((bits + '1').padEnd(DERBY_SECRET_BITS, '0'), 2) < DIGITS_END;
}
// 앞 24자리를 안 뒤 숨은 칸의 뒷부분(1·2·3착 + 일어난 일)을 묻기로 알아낸다. 결과 계산 코드가 결과표를 만든 뒤 바뀌어
//  지금 계산으로 만든 공개가 거부됐을 때만 쓴다 (공개값이 언제나 칸에 적힌 그대로이도록). 최대 8 × 3 + 1 + 3 + 8 = 36번, 칸 모양이 틀리면 null
const RANKS = '01234567';
export async function derbyProbeSuffix(ask: (prefix: string) => Promise<boolean>, bits: string): Promise<DerbyRes | null> {
  let p = bits;
  const pick = async (chars: string): Promise<string | null> => {
    for (const ch of chars) if (await ask(p + ch)) { p += ch; return ch; }
    return null;
  };
  const a = await pick(RANKS); if (!a) return null;
  const b = await pick(RANKS); if (!b) return null;
  const c = await pick(RANKS); if (!c) return null;
  if (await ask(`${p}n`)) return { a, b, c, e: 'n' };
  const k = await pick('bdl'); if (!k) return null;
  const r = await pick(RANKS);
  return r ? { a, b, c, e: k + r } : null;
}
// 24자리 2진수 → 7자리 숫자 (형식이 틀리면 null)
export function derbyBitsDigits(bits: string): string | null {
  if (!/^[01]{24}$/.test(bits)) return null;
  const v = parseInt(bits, 2);
  return v < DIGITS_END ? String(v).padStart(7, '0') : null;
}

// race/x/{n} 칸: 추첨만 됐으면 { at }, 공개됐으면 { at, digits, res }. res 는 규칙이 숨은 칸과 대조해 받은 공개값(정산 기준)
export interface DerbyDraw { at: number; digits: string | null; res: DerbyRes | null }
const rank = (v: unknown): v is string => typeof v === 'string' && /^[0-7]$/.test(v);
export function parseDerbyDraw(v: unknown): DerbyDraw | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  if (typeof x.at !== 'number') return null;
  const digits = typeof x.o === 'string' ? derbyBitsDigits(x.o.slice(0, DERBY_SECRET_BITS)) : null;
  if (!digits || !rank(x.a) || !rank(x.b) || !rank(x.c) || typeof x.e !== 'string') return { at: x.at, digits: null, res: null };
  return { at: x.at, digits, res: { a: x.a, b: x.b, c: x.c, e: x.e } };
}
