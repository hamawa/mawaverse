import type { Dir } from '../shared/types';

export type Action = 'interact' | 'chat' | 'escape' | 'toss' | 'help' | { emote: number } | { chatPrefix: string };

// 방향키와 WASD. e.code 기준이라 한/영 입력 상태와 무관하게 동작한다
const CODE_DIR: Record<string, Dir> = { ArrowDown: 0, ArrowLeft: 1, ArrowRight: 2, ArrowUp: 3, KeyS: 0, KeyA: 1, KeyD: 2, KeyW: 3 };
const KEY_EMOTE: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 10, r: 14, R: 14, 'ㄱ': 14 }; // R: 끌기
// Alt+2 → 채팅 입력창에 귓속말 프리픽스(/w)를 채워서 연다. (전체 채팅 채널은 없어져 Alt+1 을, 파티가 없어져 Alt+3 을 뺐다)
// Ctrl+1/2/3 은 Chrome/Edge 가 "N번째 탭으로 이동"으로 예약해 페이지에 전달하지 않지만, 전달되는 브라우저에서는 같이 동작한다.
const CODE_PREFIX: Record<string, string> = { Digit2: '/w ' };

export class Input {
  private held: Dir[] = [];
  private shift = false;       // Shift 를 누르고 있으면 달리기
  private touchRun = false;    // 모바일 달리기 버튼을 누르고 있는 동안
  enabled = true;              // 채팅 입력 중이면 false
  onAction: ((a: Action) => void) | null = null;

  constructor() {
    // keydown 은 캡처 단계에서 받는다: 채팅 입력창이 전파를 막아도 Alt+2 같은 수식키 단축키는 동작해야 하므로
    window.addEventListener('keydown', (e) => this.keydown(e), true);
    window.addEventListener('keyup', (e) => this.keyup(e), true);
    window.addEventListener('blur', () => { this.held = []; this.shift = false; this.touchRun = false; });
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
    if (e.key === 'f' || e.key === 'F' || e.key === 'ㄹ') { this.onAction?.('interact'); return; }
    if (e.key === 'g' || e.key === 'G' || e.key === 'ㅎ') { this.onAction?.('toss'); return; }
    if (e.key in KEY_EMOTE && !e.ctrlKey && !e.altKey && !e.metaKey) { this.onAction?.({ emote: KEY_EMOTE[e.key] }); }
  }
  private keyup(e: KeyboardEvent): void {
    if (!e.isTrusted) return;
    if (e.key === 'Shift') this.shift = false;
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
  trigger(a: Action): void { this.onAction?.(a); }
}
