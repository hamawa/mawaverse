export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const HTML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}

export function pad2(n: number): string { return n < 10 ? '0' + n : '' + n; }

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}


export function dayKey(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return `${h}시간 ${m % 60}분`;
}

// Realtime Database 키로 쓸 수 없는 문자(. # $ [ ] /)를 안전하게 인코딩
export function safeKey(s: string): string {
  return encodeURIComponent(s).replace(/\./g, '%2E');
}

export function normKey(s: string): string {
  return s.normalize('NFC').trim().toLowerCase();
}

export function nickKey(nick: string): string { return safeKey(normKey(nick)); }
export function idKey(id: string): string { return normKey(id); }

// 닉네임에 쓸 수 있는 글자의 범위 (2026-11-25, 저장소 주인 요청: 닉네임에 이모지를 넣어 이름표 앞의 표시(🏆 · 🎣 · 🧸 …)를 단 것처럼 꾸민 사람들이 나왔다).
// 이모지와 그림 기호가 든 구역을 통째로 뺀 목록이다. 빠진 것: ©(A9) · ®(AE) · U+2000~2BFF(폭 없는 글자·화살표·도형·★ ♥ ❄ 같은 기호·딩벳)
//  · 〰(3030) · 〽(303D) · ㊗(3297) · ㊙(3299) · 사용자 정의 구역 · 이형 선택자(FE0F) · 보조 평면 전부(U+10000 이상: 그림 이모지는 다 여기 있다). 빈칸도 범위 밖이다.
// 이모지만 골라 막지 않은 것은 ★ ♥ ❄ 처럼 글자이면서 이모지인 것이 그 구역에 섞여 있어서다 (어떤 것은 되고 어떤 것은 안 되면 더 헷갈린다).
// 보안 규칙(database.rules.json 의 users/$uid/nick 정규식)이 같은 범위를 글자로 적어 둔다: 고치면 둘 다 (tests/nick.test.mjs 가 대조, 허용·거부는 tests/rules-gate.test.mjs)
export const NICK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x21, 0xa8], [0xaa, 0xac], [0xaf, 0x1fff], [0x2c00, 0x302f], [0x3031, 0x303c], [0x303e, 0x3296], [0x3298, 0x3298], [0x329a, 0xd7ff], [0xf900, 0xfdff], [0xff01, 0xffee],
];
export function nickCharOk(cp: number): boolean { return NICK_RANGES.some(([a, b]) => cp >= a && cp <= b); }

export function validateNick(nick: string): string | null {
  const n = nick.normalize('NFC').trim();
  if (n.length < 2) return '닉네임은 2자 이상이어야 합니다.';
  if (n.length > 12) return '닉네임은 12자 이하여야 합니다.';
  if (/\s/.test(n)) return '닉네임에 공백은 쓸 수 없습니다.';
  if (/[/\\<>]/.test(n)) return '닉네임에 / \\ < > 문자는 쓸 수 없습니다.';
  for (const ch of n) if (!nickCharOk(ch.codePointAt(0)!)) return '닉네임에 이모지나 그림 기호(★ ♥ 등)는 쓸 수 없습니다.';
  return null;
}

export function randomId(len = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export function $<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T {
  const e = root.querySelector(sel);
  if (!e) throw new Error('element not found: ' + sel);
  return e as T;
}

export function isMobile(): boolean {
  return matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line.length > 0) {
        lines.push(line);
        line = ch;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// KST 그날 0시의 ms (database.rules.json 의 룰렛 날짜 계산과 같은 식)
export function kstDayStart(ts: number): number { const t = ts + 32400000; return t - (t % 86400000); }
