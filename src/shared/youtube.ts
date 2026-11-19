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
