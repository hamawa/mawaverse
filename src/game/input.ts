import type { Dir } from '../shared/types';

// tv: 유튜브 화면 켜고 끄기 (Y). board: 낚시 대회 점수판 (TAB 을 눌렀다 true / 뗐다 false)
export type Action = 'interact' | 'chat' | 'escape' | 'toss' | 'help' | 'tv' | { emote: number } | { chatPrefix: string } | { board: boolean };

// 방향키와 WASD. e.code 기준이라 한/영 입력 상태와 무관하게 동작한다
const CODE_DIR: Record<string, Dir> = { ArrowDown: 0, ArrowLeft: 1, ArrowRight: 2, ArrowUp: 3, KeyS: 0, KeyA: 1, KeyD: 2, KeyW: 3 };
const KEY_EMOTE: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 10 }; // 0: 옛 밀치기 키 (안내에서는 뺐지만 당분간 같이 동작)
// 밀치기 E · 끌기 R · 말랑이 T (2026-11-12. 그 전엔 0 · R · G 라 손이 흩어졌다). e.code 기준이라 한/영 입력 상태와 무관하다. G 는 옛 말랑이 키(당분간 같이 동작)
const CODE_ACT: Record<string, Action> = { KeyE: { emote: 10 }, KeyR: { emote: 14 }, KeyT: 'toss', KeyG: 'toss', KeyY: 'tv' }; // Y: 유튜브 화면 (2026-11-24)
// Alt+2 → 채팅 입력창에 귓속말 프리픽스(/w)를 채워서 연다. (전체 채팅 채널은 없어져 Alt+1 을, 파티가 없어져 Alt+3 을 뺐다)
// Ctrl+1/2/3 은 Chrome/Edge 가 "N번째 탭으로 이동"으로 예약해 페이지에 전달하지 않지만, 전달되는 브라우저에서는 같이 동작한다.
const CODE_PREFIX: Record<string, string> = { Digit2: '/w ' };

export class Input {
  private held: Dir[] = [];
  private shift = false;       // Shift 를 누르고 있으면 달리기
  private touchRun = false;    // 모바일 달리기 버튼을 누르고 있는 동안
  enabled = true;              // 채팅 입력 중이면 false
  interactRepeat = false;      // 방금 온 F 가 키를 누르고 있어서 반복된 것인가 (채광은 누를 때마다 한 번만 친다)
  onAction: ((a: Action) => void) | null = null;

  // 창(window)에 거는 리스너. 게임에서 나갈 때 떼야 해서 쥐고 있는다 (dispose)
  private onKeyDown = (e: KeyboardEvent): void => this.keydown(e);
  private onKeyUp = (e: KeyboardEvent): void => this.keyup(e);
  private onBlur = (): void => { this.held = []; this.shift = false; this.touchRun = false; this.onAction?.({ board: false }); }; // 창이 뒤로 가면 TAB 을 뗀 것을 못 받는다: 점수판을 닫는다

  constructor() {
    // keydown 은 캡처 단계에서 받는다: 채팅 입력창이 전파를 막아도 Alt+2 같은 수식키 단축키는 동작해야 하므로
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
  }
  // 게임에서 나갈 때 (World.stop): 키 입력을 더 받지 않는다 (2026-11-24 밤, 제보 두 건의 원인).
  // 창에 건 리스너라 떼지 않으면 나간 게임이 계속 받는다: 로그아웃했다가 새로고침 없이 다시 들어오면 옛 게임이 F·Y·E·T 에 같이 반응했다.
  // 옛 게임이 멈춘 자리가 물가였으면 집 안에서 F 를 눌러도 낚시가 던져졌고("미끼를 달았다" → "놓쳤다"), Y 를 누르면 옛 게임의 유튜브 창이 따로 떴다
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    this.onAction = null; this.enabled = false; this.held = []; this.tap = null;
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  get running(): boolean { return this.shift || this.touchRun; }
  setRun(on: boolean): void { this.touchRun = on; }

  private keydown(e: KeyboardEvent): void {
    if (!e.isTrusted) return; // 스크립트가 만든 가짜 키 입력은 무시한다 (콘솔 매크로 방지. 실제 키보드만)
    if (e.key === 'Shift') this.shift = true;
    // 수식키 단축키는 채팅 입력 중에도 동작
    if ((e.altKey || e.ctrlKey) && !e.shiftKey && e.code in CODE_PREFIX) { e.preventDefault(); this.onAction?.({ chatPrefix: CODE_PREFIX[e.code] }); return; }
    if (this.isTyping(e)) {
      if (e.key === 'Escape') this.onAction?.('escape');
      return;
    }
    if (e.code in CODE_DIR) {
      if (e.ctrlKey || e.altKey || e.metaKey) return; // Ctrl+S, Alt+D 같은 브라우저 단축키는 건드리지 않는다
      e.preventDefault();
      if (!this.enabled) return;
      this.shift = e.shiftKey;
      this.press(CODE_DIR[e.code]);
      return;
    }
    if (!this.enabled) return;
    if (e.key === 'Enter') { e.preventDefault(); this.onAction?.('chat'); return; }
    // Space: 키 가이드 열기/닫기. preventDefault 로 포커스가 남은 HUD 버튼이 같이 눌리는 것과 페이지 스크롤을 막는다
    if (e.code === 'Space' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); if (!e.repeat) this.onAction?.('help'); return; }
    if (e.key === 'Escape') { this.onAction?.('escape'); return; }
    if (e.key === 'f' || e.key === 'F' || e.key === 'ㄹ') { this.interactRepeat = e.repeat; this.onAction?.('interact'); return; }
    if (e.ctrlKey || e.altKey || e.metaKey) return; // Ctrl+R(새로고침)·Ctrl+T(새 탭) 같은 브라우저 단축키는 건드리지 않는다
    // TAB: 낚시 대회 점수판 (2026-11-24). 브라우저의 포커스 옮기기를 막고 가져온다. 채팅 입력 중·창이 떠 있을 때는 여기까지 오지 않는다 (Alt+Tab 은 위에서 걸러진다)
    if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) this.onAction?.({ board: true }); return; }
    if (e.code in CODE_ACT) { this.onAction?.(CODE_ACT[e.code]); return; }
    if (e.key in KEY_EMOTE) { this.onAction?.({ emote: KEY_EMOTE[e.key] }); }
  }
  private keyup(e: KeyboardEvent): void {
    if (!e.isTrusted) return;
    if (e.key === 'Shift') this.shift = false;
    if (e.code === 'Tab') this.onAction?.({ board: false }); // 뗀 것은 언제나 알린다 (누르는 사이에 창이 떴어도 점수판이 남지 않게)
    if (e.code in CODE_DIR) this.release(CODE_DIR[e.code]);
  }

  private tap: { d: Dir; at: number } | null = null;

  press(d: Dir): void {
    this.held = this.held.filter((x) => x !== d);
    this.held.unshift(d);
    this.tap = { d, at: performance.now() };
  }
  release(d: Dir): void {
    this.held = this.held.filter((x) => x !== d);
  }
  releaseAll(): void { this.held = []; this.tap = null; }
  // 누르고 있는 방향. 짧게 톡 친 경우도 한 칸은 움직이도록 300ms 동안 기억한다.
  heldDir(): Dir | null {
    if (!this.enabled) return null;
    if (this.held.length) { this.tap = null; return this.held[0]; }
    if (this.tap && performance.now() - this.tap.at < 300) { const d = this.tap.d; this.tap = null; return d; }
    return null;
  }
  trigger(a: Action): void { this.interactRepeat = false; this.onAction?.(a); }
}
