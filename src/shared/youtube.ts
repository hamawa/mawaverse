// 유튜브 링크에서 영상 id 를 뽑는다 (클럽 DJ, 2026-11-19). id 는 영문자·숫자·_·- 열한 글자다 (규칙도 같은 모양만 받는다)
// 받는 모양: youtu.be/ID · youtube.com/watch?v=ID · /shorts/ID · /embed/ID · /live/ID · /v/ID · music.youtube.com/watch?v=ID · m.youtube.com/… · id 만
const ID = /^[A-Za-z0-9_-]{11}$/;
export function youtubeId(text: string): string | null {
  const s = (text || '').trim();
  if (!s) return null;
  if (ID.test(s)) return s;
  let u: URL;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  const ok = (id: string | null | undefined): string | null => (id && ID.test(id) ? id : null);
  if (host === 'youtu.be') return ok(u.pathname.split('/')[1]);
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'watch') return ok(u.searchParams.get('v'));
  if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) return ok(parts[1]);
  return null;
}

// ---- 클럽 노래 예약 (2026-11-20 밤. 진행은 game/dj.ts, 규칙은 club 블록) ----
export const DJ_MY_MAX = 10;               // 한 사람이 걸어 둘 수 있는 예약 (규칙: 예약의 열쇠가 {uid}_0 ~ {uid}_9 열 개뿐이다. 2026-11-23 에 2 → 10, 사용자 요청: 틀어 놓고 딴짓하게)
export const DJ_Q_MAX = 20;                // 예약 전체 한도 (화면이 지킨다: 규칙은 개수를 셀 수 없다. 둘이 한꺼번에 걸면 한두 곡 넘을 수 있다)
export const DJ_Q_TTL_MS = 3 * 3600_000;   // 이보다 오래된 예약은 버린다 (규칙의 10800000: 그때부터 누구든 지울 수 있다)
export const DJ_SKIP_MIN_MS = 10_000;      // 남이 선곡한 곡은 튼 지 이만큼 지나야 넘길 수 있다 (규칙의 10000)
export const DJ_TITLE_MAX = 80;            // 제목 길이 (규칙도 같다)
export const DJ_DEAD_CODES: readonly number[] = [100, 101, 150]; // 플레이어 오류 가운데 누구에게나 안 나오는 것 (없는 영상·재생이 막힌 영상): 다음 곡으로 넘긴다
export interface DjEntry { k: string; v: string; u: string; n: string; at: number; t?: string; p?: 1 }
// 나올 순서: 우선 예약이 먼저, 그 안에서는 먼저 건 것부터. 모양이 틀렸거나 오래된 예약은 뺀다
export function djOrder(raw: Record<string, Omit<DjEntry, 'k'>> | null | undefined, now: number): DjEntry[] {
  const list: DjEntry[] = [];
  for (const [k, e] of Object.entries(raw || {})) {
    if (!e || typeof e.v !== 'string' || typeof e.u !== 'string' || typeof e.at !== 'number' || now - e.at >= DJ_Q_TTL_MS) continue;
    list.push({ k, v: e.v, u: e.u, n: typeof e.n === 'string' ? e.n : '', at: e.at, ...(typeof e.t === 'string' && e.t ? { t: e.t } : {}), ...(e.p ? { p: 1 as const } : {}) });
  }
  return list.sort((a, b) => (b.p || 0) - (a.p || 0) || a.at - b.at || (a.k < b.k ? -1 : 1));
}
// 내 예약을 적을 빈 열쇠 (열 개가 다 차 있으면 null)
export function djSlotKey(uid: string, used: readonly string[]): string | null {
  for (let i = 0; i < DJ_MY_MAX; i++) if (!used.includes(`${uid}_${i}`)) return `${uid}_${i}`;
  return null;
}
// 제목 다듬기: 줄바꿈·겹친 빈칸을 하나로, 길면 자른다
export function djCleanTitle(t: unknown): string { return typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, DJ_TITLE_MAX) : ''; }

// ---- 클럽 DJ 창의 계산 (2026-11-20. 화면은 game/djui.ts) ----
export const DJ_MIN_EDGE = 200; // 플레이어의 가장 작은 크기 (유튜브 약관: 200×200 이상)
export const DJ_PAD = 14;       // 패널 테두리·안쪽 여백 (플레이어 너비 + 이만큼 = 패널 너비)
// 같은 노래인가: 내가 튼 노래는 시각이 추정값 → 서버 값으로 두 번 온다. 조금 달라진 것은 같은 노래로 본다
export function sameSong(a: { v: string; at: number } | null | undefined, b: { v: string; at: number } | null | undefined): boolean { return !!a && !!b && a.v === b.v && Math.abs(a.at - b.at) <= 1500; }
// 플레이어 너비 → 높이 (16:9, 가장 작게는 DJ_MIN_EDGE)
export function djFrameHeight(w: number): number { return Math.max(DJ_MIN_EDGE, Math.round((w * 9) / 16)); }
// 끌어서 바꾼 너비를 화면 안에 맞춘다 (가장 작게 200. 높이까지 화면에 들어가게)
export function djClampWidth(w: number, viewW: number, viewH: number, headH: number): number {
  const byW = viewW - 16 - DJ_PAD, byH = Math.floor(((viewH - headH - 24) * 16) / 9);
  return Math.max(DJ_MIN_EDGE, Math.min(Math.round(w), byW, Math.max(DJ_MIN_EDGE, byH)));
}
// 끌어 옮긴 창의 세로 자리: 화면 위 버튼 줄(top) 아래부터, 제목 줄이 화면 안에 남는 데까지 (2026-11-20. 화면이 아주 낮으면 아래쪽 한계가 먼저다)
// frameH: 영상의 높이. 아래로는 영상의 절반이 화면 안에 남는 데까지만 내려간다 (2026-11-24. 유튜브 개발자 정책: 화면에 보이지 않는 플레이어로 재생하는 기능을 두면 안 된다.
// 전에는 제목 줄만 남기고 영상이 통째로 화면 아래로 내려갔다). 0 이면 제목 줄만 본다
export function djClampY(y: number, viewH: number, headH: number, top: number, frameH = 0): number {
  const maxY = Math.max(0, viewH - Math.min(headH + 12 + frameH * 0.55, viewH)); // 절반을 조금 넘게 남긴다 (약관의 선이 "절반 넘게"다)
  return Math.max(Math.min(Math.max(0, top), maxY), Math.min(y, maxY));
}
// 폰에서 최소화: 영상을 화면 위에 붙이고 게임 화면을 그만큼 내린다 (2026-11-24, 사용자와 정한 배치. 기준 기기는 아이폰 17 프로: 사파리에서 402×714 쯤).
// 영상은 화면 너비에 맞춘 16:9 (가장 작게는 200). 게임 화면이 DJ_DOCK_GAME_MIN 보다 낮아지면 붙이지 않는다 (null: 그때는 떠 있는 가장 작은 창으로)
export const DJ_DOCK_GAME_MIN = 380;
export function djDockFrame(viewW: number, viewH: number, barH: number): { w: number; h: number } | null {
  if (viewW >= viewH) return null; // 가로로 눕힌 화면에서는 붙이지 않는다
  const w = Math.max(DJ_MIN_EDGE, Math.floor(viewW - 16)), room = viewH - DJ_DOCK_GAME_MIN - barH - 14;
  const h = Math.min(djFrameHeight(w), Math.floor(room));
  return h >= DJ_MIN_EDGE ? { w, h } : null;
}
// 영상이 끝났나: 튼 뒤 흐른 시간이 길이를 넘었거나, 플레이어가 끝났다고 하고(ended) 재생 지점이 끝 근처일 때. 플레이어가 끝났다고만 하고 지점이 앞쪽이면(광고가 끝난 경우 등) 아니다
export function djEnded(wantSec: number, durSec: number, curSec: number, playerEnded: boolean): boolean {
  return durSec > 0 && (wantSec >= durSec - 0.3 || (playerEnded && (curSec >= durSec - 2 || wantSec >= durSec - 2)));
}
