// 클럽 DJ 화면 (2026-11-19): 클럽 벽 쪽(화면 오른쪽 위)에 작게 붙는 유튜브 플레이어. 접었다 펼 수 있다.
// - 모두가 같은 지점을 듣게 튼 서버 시각(at)에 맞춰 감는다. 3초 넘게 어긋나면 다시 맞춘다 (광고가 끼면 그 사람만 잠깐 늦는다)
// - 게임 소리(🔇/🔊)와 음악 음량을 따른다: 소리를 꺼 두면 영상만 소리 없이 나온다
// - 유튜브 약관상 플레이어를 가린 채 소리만 틀 수 없다. 그래서 접으면 내 화면에서는 재생을 멈추고(직접 만든 클럽 음악이 다시 나온다), 펼치면 지금 지점부터 이어진다.
//   소리를 들으면서 덜 가리고 싶으면 접지 말고 가장 작게(200×200) 줄여 구석으로 옮기면 된다
// - 플레이어 크기는 200×200 이상이어야 한다 (약관). 쿠키를 덜 쓰는 주소(youtube-nocookie.com)로 싣는다
// - 아이폰은 자동 재생이 안 돼서 영상을 한 번 눌러야 한다 (안내를 띄운다)
// 2026-11-20 (사용자 요청):
// - 제목 줄을 잡고 끌어 옮기고, 오른쪽 아래 손잡이를 끌어 크기를 바꾼다 (16:9 를 지킨다. 가장 작게는 200×200). 전체 화면 단추(지원하는 브라우저만).
//   자리와 크기는 어디에도 적지 않는다: 다시 접속하면 처음 자리로 돌아온다 (화면 밖으로 끌려 나갔을 때를 대비. 끌 때도 화면 안에 가둔다)
// - 영상이 끝나면 스스로 꺼진다 (2026-11-20 밤부터: 클럽에 있는 아무 화면이 다음 예약으로 넘긴다. game/dj.ts). 전에는 끝난 영상에 재생을 다시 걸어 첫 부분이 0.5초씩 되풀이됐다:
//   끝난 플레이어(상태 0)에 playVideo 를 부르면 처음부터 다시 틀고, 다음 맞추기가 끝 지점으로 감아 또 끝나는 일이 이어졌다
// 이 환경에서는 소리를 들어 볼 수 없다: 상태가 맞게 바뀌는지와 플레이어가 만들어지는지만 확인했다
import { el } from '../shared/util';
import { serverNow } from '../firebase/db';
import { soundOn, soundPrefs, setMusicHold } from './audio';
import type { DjState } from './dj';
import { DJ_MIN_EDGE, DJ_PAD, sameSong, djFrameHeight, djClampWidth, djClampY, djEnded } from '../shared/youtube';

interface YTPlayer {
  playVideo(): void; pauseVideo(): void; stopVideo(): void; mute(): void; unMute(): void; setVolume(v: number): void;
  seekTo(sec: number, allowSeekAhead: boolean): void; getCurrentTime(): number; getDuration(): number; getPlayerState(): number;
  loadVideoById(o: { videoId: string; startSeconds?: number }): void; destroy(): void;
  // 문서에 없는 기능이라 없을 수도 있다 (자막 끄기에만 쓴다: captionsOff)
  getOptions?(): string[] | undefined; setOption?(module: string, key: string, value: unknown): void;
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
const PAD = DJ_PAD;
const ERR: Record<number, string> = { 2: '링크가 올바르지 않아요.', 5: '이 기기에서는 재생할 수 없는 영상이에요.', 100: '없는 영상이거나 비공개예요.', 101: '다른 사이트에서 재생이 막힌 영상이에요.', 150: '다른 사이트에서 재생이 막힌 영상이에요.' };
export { sameSong };

export interface DjPanelHost {
  isAdmin: boolean; myUid: string;
  onError(msg: string, mine: boolean, code: number): void; // code: 유튜브 플레이어의 오류 번호 (없는 영상·막힌 영상이면 world 가 다음 곡으로 넘긴다)
  onEnded?(song: DjState): void; // 영상이 끝났다: 다음 예약으로 넘긴다 (world → DjMgr.ended)
}

export class DjPanel {
  private root: HTMLElement | null = null;
  private head: HTMLElement | null = null;
  private frame: HTMLElement | null = null;
  private title: HTMLElement | null = null;
  private note: HTMLElement | null = null;
  private foldBtn: HTMLButtonElement | null = null;
  private player: YTPlayer | null = null;
  private ready = false;
  private state: DjState | null = null;
  private done: DjState | null = null; // 끝까지 본 노래 (같은 노래가 다시 와도 창을 띄우지 않는다)
  private timer = 0;
  private folded = false;
  private error = '';
  private creating = false;  // 플레이어를 만드는 중 (유튜브 스크립트를 기다린다). 그동안 또 만들지 않는다
  private loadedId = '';     // 플레이어에 실려 있는 영상
  // 끌어 옮긴 자리·바꾼 크기: 이 접속 동안만 기억한다 (다시 접속하면 처음 자리)
  private pos: { x: number; y: number } | null = null;
  private fw: number | null = null;
  private onResize = (): void => this.layout();
  constructor(private host: DjPanelHost) {
    try { this.folded = localStorage.getItem(FOLD_KEY) === '1'; } catch { /* ignore */ }
  }

  // 지금 틀어져 있는 노래 (없으면 null): 패널을 띄우거나 치운다
  set(state: DjState | null): void {
    const changed = !sameSong(state, this.state);
    this.state = state;
    if (!state) { this.done = null; this.close(); return; }
    if (sameSong(state, this.done)) return; // 이미 끝까지 본 노래: 창을 다시 띄우지 않는다
    if (!this.root) this.build();
    if (changed) { this.error = ''; this.load(); }
    this.paint();
  }
  close(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    window.removeEventListener('resize', this.onResize);
    if (document.fullscreenElement && this.frame && document.fullscreenElement === this.frame) void document.exitFullscreen().catch(() => {});
    try { this.player?.destroy(); } catch { /* ignore */ }
    this.player = null; this.ready = false; this.loadedId = ''; this.creating = false;
    this.root?.remove(); this.root = this.head = this.frame = this.title = this.note = null; this.foldBtn = null;
    setMusicHold(false);
  }
  // 영상이 끝났다: 창을 닫고(같은 노래로는 다시 안 뜬다) 끌 수 있는 사람이면 서버에서도 지운다
  private finish(): void {
    const song = this.state;
    if (!song) return;
    this.done = song;
    this.close();
    this.host.onEnded?.(song);
  }

  private build(): void {
    this.title = el('div', { class: 'dj-title' });
    this.foldBtn = el('button', { class: 'btn small', text: '' });
    this.foldBtn.dataset.quiet = '1';
    this.foldBtn.onclick = () => this.fold(!this.folded);
    const btns: HTMLElement[] = [];
    if (document.fullscreenEnabled) {
      const fs = el('button', { class: 'btn small', text: '⛶', title: '전체 화면' });
      fs.dataset.quiet = '1';
      fs.onclick = () => { if (this.folded) this.fold(false); void this.frame?.requestFullscreen?.().catch(() => {}); };
      btns.push(fs);
    }
    btns.push(this.foldBtn);
    this.head = el('div', { class: 'dj-head', title: '끌어서 옮기기' }, [this.title, el('div', { class: 'dj-btns' }, btns)]);
    this.frame = el('div', { class: 'dj-frame' });
    this.note = el('div', { class: 'dj-note' });
    const grip = el('div', { class: 'dj-grip', title: '끌어서 크기 바꾸기' });
    this.root = el('div', { id: 'dj-panel' }, [this.head, this.frame, this.note, grip]);
    (document.getElementById('app') || document.body).append(this.root);
    this.dragging(this.head, grip);
    window.addEventListener('resize', this.onResize);
    this.timer = window.setInterval(() => this.tick(), 2000);
    this.layout();
  }
  // 제목 줄을 끌면 옮기고, 손잡이를 끌면 크기를 바꾼다 (마우스·터치 공통)
  private dragging(head: HTMLElement, grip: HTMLElement): void {
    let mode: 'move' | 'size' | null = null, sx = 0, sy = 0, ox = 0, oy = 0, ow = 0;
    const start = (m: 'move' | 'size') => (e: PointerEvent) => {
      if (!this.root || !this.frame || (m === 'move' && (e.target as HTMLElement).closest('button'))) return;
      const r = this.root.getBoundingClientRect();
      mode = m; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; ow = this.frame.getBoundingClientRect().width || DJ_MIN_EDGE;
      this.pos = { x: r.left, y: r.top }; // 처음 끌 때 지금 보이는 자리를 기준으로 삼는다 (CSS 의 오른쪽 위·가운데 정렬에서 벗어난다)
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      this.layout();
    };
    const move = (e: PointerEvent) => {
      if (!mode) return;
      if (mode === 'move') this.pos = { x: ox + e.clientX - sx, y: oy + e.clientY - sy };
      else this.fw = ow + e.clientX - sx;
      this.layout();
    };
    const end = () => { mode = null; };
    head.addEventListener('pointerdown', start('move'));
    grip.addEventListener('pointerdown', start('size'));
    for (const t of [head, grip]) { t.addEventListener('pointermove', move); t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end); }
  }
  // 끌어 옮긴 자리·크기를 화면 안에 맞춰 적용한다. 손대지 않았으면 CSS 의 처음 자리 그대로
  private layout(): void {
    const root = this.root, frame = this.frame;
    if (!root || !frame) return;
    const headH = this.head?.getBoundingClientRect().height || 28;
    if (this.fw !== null && !this.folded) {
      this.fw = djClampWidth(this.fw, window.innerWidth, window.innerHeight, headH);
      root.style.width = `${this.fw + PAD}px`;
      frame.style.height = `${djFrameHeight(this.fw)}px`;
    } else { root.style.width = ''; frame.style.height = ''; }
    if (this.pos) {
      const r = root.getBoundingClientRect();
      // 위로는 화면 위 버튼 줄 아래까지만: 이 창은 다른 화면 요소보다 앞에 그려서(styles.css) 제목 줄이 가려지는 일은 없지만, 버튼 줄을 덮으면 그 버튼을 못 누른다
      const top = (document.getElementById('topbar')?.getBoundingClientRect().bottom ?? 0) + 4;
      this.pos = { x: Math.max(0, Math.min(this.pos.x, window.innerWidth - Math.min(r.width, window.innerWidth))), y: djClampY(this.pos.y, window.innerHeight, headH, top) };
      root.style.left = `${Math.round(this.pos.x)}px`; root.style.top = `${Math.round(this.pos.y)}px`;
      root.style.right = 'auto'; root.style.transform = 'none';
    }
  }
  private fold(on: boolean): void {
    this.folded = on;
    try { localStorage.setItem(FOLD_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    if (on) { try { this.player?.pauseVideo(); } catch { /* ignore */ } }
    else this.sync(true);
    this.paint();
    this.layout();
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
            this.ready = true; this.volume(); this.captionsOff();
            if (this.state && this.state.v !== this.loadedId) this.load(); // 만드는 사이에 노래가 바뀌었다
            else if (this.state && !this.folded) this.sync(true);
            this.paint();
          },
          onStateChange: (e: { data: number }) => { if (e.data === 0) this.ended(); else { if (e.data === 1) this.captionsOff(); this.paint(); } },
          onApiChange: () => this.captionsOff(), // 자막 모듈이 실렸다 (영상이 바뀔 때마다 다시 온다)
          onError: (e: { data: number }) => { this.error = ERR[e.data] || '재생하지 못했어요.'; this.host.onError(this.error, this.state?.u === this.host.myUid, e.data); this.paint(); },
        },
      });
    }).catch(() => { this.creating = false; this.error = '유튜브를 불러오지 못했어요.'; this.paint(); });
  }
  // 자막은 꺼 둔다 (2026-11-23, 사용자 요청). 조작 줄을 숨겨 둬서(controls: 0) 보는 사람이 자막을 끌 방법이 없는데, 유튜브는 자막을 켰던 것을 브라우저마다 기억해 켜진 채로 굳는다.
  // 끄는 공식 설정이 없어서(cc_load_policy 는 켜는 쪽만 있다) 플레이어의 자막 모듈에 "트랙 없음"을 넣는다. 문서에 없는 기능이라 사라지면 아무 일도 하지 않는다 (그때는 자막이 전처럼 나온다).
  // 부르는 때: 준비됐을 때 · 자막 모듈이 실렸을 때(onApiChange) · 재생이 시작됐을 때. 여러 번 불러도 같은 일이다
  private captionsOff(): void {
    const p = this.player;
    if (!p || !this.ready) return;
    try { if (typeof p.setOption === 'function' && (p.getOptions?.() || []).includes('captions')) p.setOption('captions', 'track', {}); } catch { /* ignore */ }
  }
  private volume(): void {
    const p = this.player;
    if (!p || !this.ready) return;
    try { if (soundOn() && soundPrefs().music > 0) { p.unMute(); p.setVolume(Math.round(soundPrefs().music * 100)); } else p.mute(); } catch { /* ignore */ }
  }
  // 플레이어가 "끝났다"(상태 0)고 알렸다: 재생 지점이 정말 끝 근처면 끈다. 아니면(영상 앞 광고가 끝난 경우 등) 다음 맞추기에 맡긴다
  private ended(): void {
    const p = this.player;
    if (!p || !this.ready) return;
    try { if (djEnded(this.offset(), p.getDuration(), p.getCurrentTime(), true)) { this.finish(); return; } } catch { /* ignore */ }
    this.paint();
  }
  // 튼 시각에 맞춰 재생 지점을 맞춘다. force: 조금 어긋나 있어도 맞춘다
  private sync(force = false): void {
    const p = this.player;
    if (!p || !this.ready || !this.state || this.folded || this.error) return;
    try {
      const want = this.offset(), dur = p.getDuration(), st = p.getPlayerState();
      // 끝났으면 끈다. 끝난 플레이어에 재생을 다시 걸면 처음부터 다시 틀어 버린다 (2026-11-20 제보: 첫 부분이 0.5초씩 되풀이됐다)
      if (djEnded(want, dur, p.getCurrentTime(), st === 0)) { this.finish(); return; }
      if (force || st === 0 || Math.abs(p.getCurrentTime() - want) > DRIFT_SEC) p.seekTo(want, true);
      if (st !== 1 && st !== 3) p.playVideo(); // 1 재생 중 · 3 버퍼링
    } catch { /* ignore */ }
  }
  private tick(): void {
    this.volume();
    if (!this.folded) this.sync();
    this.paint();
  }
  // 영상이 나오는 동안(접지 않았고 오류가 없으면) 직접 만든 클럽 음악은 멈춘다
  private paint(): void {
    const st = this.state;
    if (!this.root || !st) return;
    setMusicHold(!this.folded && !this.error);
    this.root.classList.toggle('fold', this.folded);
    if (this.title) this.title.textContent = st.t ? `🎧 ${st.t} · ${st.n}` : `🎧 ${st.n} 님이 튼 노래`; // 제목은 예약할 때 읽어 둔 것 (2026-11-20 밤)
    if (this.foldBtn) this.foldBtn.textContent = this.folded ? '펼치기' : '접기';
    let playing = false;
    try { playing = !!this.player && this.ready && this.player.getPlayerState() === 1; } catch { /* ignore */ }
    const text = this.error ? `⚠ ${this.error}`
      : this.folded ? '접어 두면 내 화면에서는 재생이 멈춰요. 펼치면 지금 지점부터 이어져요.'
      : !this.ready ? '불러오는 중…'
      : !playing ? '▶ 재생이 안 되면 영상을 한 번 눌러 주세요.'
      : !soundOn() ? '🔇 게임 소리를 켜면 들려요 (화면 위 🔇 버튼).' : '';
    if (this.note) { this.note.textContent = text; this.note.style.display = text ? '' : 'none'; }
  }
}
