// 클럽 DJ 화면 (2026-11-19): 클럽 벽 쪽(화면 위 가운데)에 작게 붙는 유튜브 플레이어. 접었다 펼 수 있다.
// - 모두가 같은 지점을 듣게 튼 서버 시각(at)에 맞춰 감는다. 3초 넘게 어긋나면 다시 맞춘다 (광고가 끼면 그 사람만 잠깐 늦는다)
// - 게임 소리(🔇/🔊)와 음악 음량을 따른다: 소리를 꺼 두면 영상만 소리 없이 나온다
// - 유튜브 약관상 플레이어를 가린 채 소리만 틀 수 없다. 그래서 접으면 내 화면에서는 재생을 멈추고(직접 만든 클럽 음악이 다시 나온다), 펼치면 지금 지점부터 이어진다
// - 플레이어 크기는 200px 높이 이상이어야 한다 (약관). 쿠키를 덜 쓰는 주소(youtube-nocookie.com)로 싣는다
// - 아이폰은 자동 재생이 안 돼서 영상을 한 번 눌러야 한다 (안내를 띄운다)
// 이 환경에서는 소리를 들어 볼 수 없다: 상태가 맞게 바뀌는지와 플레이어가 만들어지는지만 확인했다
import { el } from '../shared/util';
import { serverNow } from '../firebase/db';
import { soundOn, soundPrefs, setMusicHold } from './audio';
import type { DjState } from './dj';

interface YTPlayer {
  playVideo(): void; pauseVideo(): void; stopVideo(): void; mute(): void; unMute(): void; setVolume(v: number): void;
  seekTo(sec: number, allowSeekAhead: boolean): void; getCurrentTime(): number; getDuration(): number; getPlayerState(): number;
  loadVideoById(o: { videoId: string; startSeconds?: number }): void; destroy(): void;
}
interface YTApi { Player: new (el: HTMLElement, opt: Record<string, unknown>) => YTPlayer }
const yt = (): YTApi | undefined => (window as unknown as { YT?: YTApi }).YT;
let apiWait: Promise<YTApi> | null = null;
function loadApi(): Promise<YTApi> {
  if (apiWait) return apiWait;
  apiWait = new Promise<YTApi>((res, rej) => {
    const have = yt();
    if (have?.Player) { res(have); return; }
    const g = window as unknown as { onYouTubeIframeAPIReady?: () => void };
    const prev = g.onYouTubeIframeAPIReady;
    g.onYouTubeIframeAPIReady = () => { prev?.(); const api = yt(); if (api) res(api); else rej(new Error('YT 없음')); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiWait = null; rej(new Error('유튜브를 불러오지 못했습니다')); };
    document.head.append(s);
  });
  return apiWait;
}
const FOLD_KEY = 'mv-dj-fold';
const DRIFT_SEC = 3;      // 이보다 더 어긋나면 다시 맞춘다
const ERR: Record<number, string> = { 2: '링크가 올바르지 않아요.', 5: '이 기기에서는 재생할 수 없는 영상이에요.', 100: '없는 영상이거나 비공개예요.', 101: '다른 사이트에서 재생이 막힌 영상이에요.', 150: '다른 사이트에서 재생이 막힌 영상이에요.' };

export class DjPanel {
  private root: HTMLElement | null = null;
  private frame: HTMLElement | null = null;
  private title: HTMLElement | null = null;
  private note: HTMLElement | null = null;
  private foldBtn: HTMLButtonElement | null = null;
  private player: YTPlayer | null = null;
  private ready = false;
  private state: DjState | null = null;
  private timer = 0;
  private folded = false;
  private error = '';
  private ended = false;
  private creating = false;  // 플레이어를 만드는 중 (유튜브 스크립트를 기다린다). 그동안 또 만들지 않는다
  private loadedId = '';     // 플레이어에 실려 있는 영상
  constructor(private host: { isAdmin: boolean; onError(msg: string, mine: boolean): void; myUid: string }) {
    try { this.folded = localStorage.getItem(FOLD_KEY) === '1'; } catch { /* ignore */ }
  }

  // 지금 틀어져 있는 노래 (없으면 null): 패널을 띄우거나 치운다
  set(state: DjState | null): void {
    // 내가 튼 노래는 시각이 추정값 → 서버 값으로 두 번 온다: 조금 달라진 것은 같은 노래로 본다 (다시 싣지 않는다. 지점은 주기적으로 맞춘다)
    const changed = state?.v !== this.state?.v || Math.abs((state?.at ?? 0) - (this.state?.at ?? 0)) > 1500;
    this.state = state;
    if (!state) { this.close(); return; }
    if (!this.root) this.build();
    if (changed) { this.error = ''; this.ended = false; this.load(); }
    this.paint();
  }
  close(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    try { this.player?.destroy(); } catch { /* ignore */ }
    this.player = null; this.ready = false; this.loadedId = '';
    this.root?.remove(); this.root = this.frame = this.title = this.note = null; this.foldBtn = null;
    setMusicHold(false);
  }

  private build(): void {
    this.title = el('div', { class: 'dj-title' });
    this.foldBtn = el('button', { class: 'btn small', text: '' });
    this.foldBtn.dataset.quiet = '1';
    this.foldBtn.onclick = () => this.fold(!this.folded);
    this.frame = el('div', { class: 'dj-frame' });
    this.note = el('div', { class: 'dj-note' });
    this.root = el('div', { id: 'dj-panel' }, [el('div', { class: 'dj-head' }, [this.title, this.foldBtn]), this.frame, this.note]);
    (document.getElementById('app') || document.body).append(this.root);
    this.timer = window.setInterval(() => this.tick(), 2000);
  }
  private fold(on: boolean): void {
    this.folded = on;
    try { localStorage.setItem(FOLD_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    if (on) { try { this.player?.pauseVideo(); } catch { /* ignore */ } }
    else this.sync(true);
    this.paint();
  }
  private offset(): number { return this.state ? Math.max(0, (serverNow() - this.state.at) / 1000) : 0; }
  private load(): void {
    const st = this.state;
    if (!st || !this.frame) return;
    if (this.player && this.ready) { try { this.loadedId = st.v; this.player.loadVideoById({ videoId: st.v, startSeconds: this.offset() }); if (this.folded) this.player.pauseVideo(); } catch { /* ignore */ } return; }
    if (this.player || this.creating) return; // 만드는 중: 준비되면 그때의 상태로 맞춘다 (onReady)
    this.creating = true;
    void loadApi().then((api) => {
      this.creating = false;
      if (!this.root || !this.state || !this.frame || this.player) return;
      const holder = el('div');
      this.frame.innerHTML = ''; this.frame.append(holder); // 화면에 붙어 있는 자리에 만들어야 한다 (떼어 낸 자리에 만들면 영영 준비되지 않는다)
      this.loadedId = this.state.v;
      this.player = new api.Player(holder, {
        host: 'https://www.youtube-nocookie.com', videoId: this.state.v, width: '100%', height: '100%',
        playerVars: { autoplay: this.folded ? 0 : 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, fs: 0, start: Math.floor(this.offset()), origin: location.origin },
        events: {
          onReady: () => {
            this.ready = true; this.volume();
            if (this.state && this.state.v !== this.loadedId) this.load(); // 만드는 사이에 노래가 바뀌었다
            else if (this.state && !this.folded) this.sync(true);
            this.paint();
          },
          onStateChange: (e: { data: number }) => { if (e.data === 0) { this.ended = true; this.paint(); } else if (e.data === 1) { this.ended = false; this.paint(); } },
          onError: (e: { data: number }) => { this.error = ERR[e.data] || '재생하지 못했어요.'; this.host.onError(this.error, this.state?.u === this.host.myUid); this.paint(); },
        },
      });
    }).catch(() => { this.creating = false; this.error = '유튜브를 불러오지 못했어요.'; this.paint(); });
  }
  private volume(): void {
    const p = this.player;
    if (!p || !this.ready) return;
    try { if (soundOn() && soundPrefs().music > 0) { p.unMute(); p.setVolume(Math.round(soundPrefs().music * 100)); } else p.mute(); } catch { /* ignore */ }
  }
  // 튼 시각에 맞춰 재생 지점을 맞춘다. force: 조금 어긋나 있어도 맞춘다
  private sync(force = false): void {
    const p = this.player;
    if (!p || !this.ready || !this.state || this.folded || this.error) return;
    try {
      const want = this.offset(), dur = p.getDuration();
      if (dur > 0 && want >= dur) { this.ended = true; p.stopVideo(); return; }
      if (force || Math.abs(p.getCurrentTime() - want) > DRIFT_SEC) p.seekTo(want, true);
      if (p.getPlayerState() !== 1 && p.getPlayerState() !== 3) p.playVideo(); // 1 재생 중 · 3 버퍼링
    } catch { /* ignore */ }
  }
  private tick(): void {
    this.volume();
    if (!this.folded) this.sync();
    this.paint();
  }
  // 영상이 나오는 동안(접지 않았고 끝나지 않았고 오류가 없으면) 직접 만든 클럽 음악은 멈춘다
  private paint(): void {
    const st = this.state;
    if (!this.root || !st) return;
    const live = !this.folded && !this.ended && !this.error;
    setMusicHold(live);
    this.root.classList.toggle('fold', this.folded);
    if (this.title) this.title.textContent = `🎧 ${st.n} 님이 튼 노래`;
    if (this.foldBtn) this.foldBtn.textContent = this.folded ? '펼치기' : '접기';
    let playing = false;
    try { playing = !!this.player && this.ready && this.player.getPlayerState() === 1; } catch { /* ignore */ }
    const text = this.error ? `⚠ ${this.error}`
      : this.ended ? '노래가 끝났어요. DJ 자리에서 새 노래를 틀 수 있어요.'
      : this.folded ? '접어 두면 내 화면에서는 재생이 멈춰요. 펼치면 지금 지점부터 이어져요.'
      : !this.ready ? '불러오는 중…'
      : !playing ? '▶ 재생이 안 되면 영상을 한 번 눌러 주세요.'
      : !soundOn() ? '🔇 게임 소리를 켜면 들려요 (화면 위 🔇 버튼).' : '';
    if (this.note) { this.note.textContent = text; this.note.style.display = text ? '' : 'none'; }
  }
}
