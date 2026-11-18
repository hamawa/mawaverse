// 화면 꺼짐 방지 (2026-11-18, 사용자 요청: 폰에서 게임이 끊기는 일을 줄이려고). 내 메뉴의 스위치로 켠다. 이 브라우저에만 적는다 (mv-wakelock).
// 켜면 게임 화면을 띄워 둔 동안 기기가 화면을 끄지 않는다(배터리를 더 쓴다). 브라우저가 뒤로 가면 기기가 잠금을 풀어 버리므로 돌아올 때 다시 건다.
// 뒤에 있는 웹페이지를 멈추는 것은 폰이 하는 일이라 막을 수 없다: 이건 "화면이 꺼져서 끊기는" 경우만 막는다.
const KEY = 'mv-wakelock';
let lock: WakeLockSentinel | null = null;
let hooked = false;

export function wakeLockSupported(): boolean { return typeof navigator !== 'undefined' && 'wakeLock' in navigator; }
export function wakeLockOn(): boolean { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }

async function acquire(): Promise<boolean> {
  if (!wakeLockSupported() || document.visibilityState !== 'visible') return false;
  try { lock = await navigator.wakeLock.request('screen'); return true; } catch { return false; } // 배터리 절약 모드 등에서는 거절될 수 있다
}
function hook(): void {
  if (hooked) return;
  hooked = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeLockOn()) void acquire(); });
}
// 켜기·끄기. 켰는데 기기가 거절하면 false
export async function setWakeLock(on: boolean): Promise<boolean> {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  if (!on) { try { await lock?.release(); } catch { /* ignore */ } lock = null; return true; }
  hook();
  return acquire();
}
// 접속할 때: 켜 둔 사람이면 다시 건다
export function startWakeLock(): void { if (wakeLockOn() && wakeLockSupported()) { hook(); void acquire(); } }
