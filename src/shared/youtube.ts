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
// 영상이 끝났나: 튼 뒤 흐른 시간이 길이를 넘었거나, 플레이어가 끝났다고 하고(ended) 재생 지점이 끝 근처일 때. 플레이어가 끝났다고만 하고 지점이 앞쪽이면(광고가 끝난 경우 등) 아니다
export function djEnded(wantSec: number, durSec: number, curSec: number, playerEnded: boolean): boolean {
  return durSec > 0 && (wantSec >= durSec - 0.3 || (playerEnded && (curSec >= durSec - 2 || wantSec >= durSec - 2)));
}
