import { ref, push, set, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow, onNewChild } from '../firebase/db';
import { el } from '../shared/util';
import { modal, withCloseX } from './ui';
import { ROULETTE, ROULETTE_ANNOUNCE, rollRoulette, type RouletteFeed } from '../shared/roulette';
import { fmtCoins } from '../shared/shop';
import type { WalletMgr } from './wallet';
import type { WorldCtx } from './state';

export interface RouletteHost { uid: string; nick: string; wallet: WalletMgr; toast(msg: string, err?: boolean): void; log(text: string): void; stat(key: string): void }

const COLORS = ['#3f6b4a', '#5a4a2f', '#2f4f6b', '#6b2f5a', '#4a6b2f', '#6b5a2f', '#2f6b66', '#7a3b2f'];

// 500 이상 당첨 공지 구독 (입장 뒤의 것만)
export function watchRouletteFeed(w: WorldCtx): () => void {
  return onNewChild('roulette/feed', serverNow(), 5, (s) => {
    const e = s.val() as RouletteFeed;
    const text = e.k === 'jp' ? `💎 ${e.n} 님이 슬롯 잭팟 ${Math.floor(e.v).toLocaleString('ko-KR')}코인을 터뜨렸습니다!` : e.k === '777' ? `7️⃣ ${e.n} 님이 슬롯에서 트리플 세븐! ${Math.floor(e.v).toLocaleString('ko-KR')}코인` : `🎰 ${e.n} 님이 오늘의 룰렛에서 ${e.v}코인을 뽑았습니다!`;
    w.events.emit('log', { channel: 'notice', from: '', text, ts: e.ts || serverNow() });
  });
}

// 하루 한 번 룰렛 창. 돌리기를 누르면 3.5초 돌고 멈춘 칸의 코인을 지갑에 넣는다 (하루 한 번은 지갑 규칙과 WalletMgr.claimRoulette 이 지킨다)
export function openRoulette(h: RouletteHost): void {
  const body = el('div', { class: 'roulette' });
  const m = modal('🎰 오늘의 룰렛', body, [], false);
  m.root.querySelector('.actions')?.remove();
  withCloseX(m);
  const size = 260, cx = size / 2, cy = size / 2, r = size / 2 - 6;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  cv.style.width = '100%'; cv.style.maxWidth = size + 'px'; cv.style.display = 'block'; cv.style.margin = '0 auto';
  const c = cv.getContext('2d')!;
  const n = ROULETTE.length, seg = (Math.PI * 2) / n;
  const draw = (rot: number, hi = -1) => {
    c.clearRect(0, 0, size, size);
    for (let i = 0; i < n; i++) {
      const a0 = rot + i * seg - Math.PI / 2, a1 = a0 + seg;
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r, a0, a1); c.closePath();
      c.fillStyle = i === hi ? '#ffd84d' : COLORS[i % COLORS.length]; c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1; c.stroke();
      c.save(); c.translate(cx, cy); c.rotate(a0 + seg / 2); c.textAlign = 'right'; c.textBaseline = 'middle';
      c.fillStyle = i === hi ? '#2b2200' : '#fff'; c.font = `bold ${ROULETTE[i].v >= 1000 ? 15 : 14}px sans-serif`;
      c.fillText(String(ROULETTE[i].v), r - 10, 0); c.restore();
    }
    c.beginPath(); c.arc(cx, cy, 22, 0, Math.PI * 2); c.fillStyle = '#16211b'; c.fill(); c.strokeStyle = '#ffd84d'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#ffd84d'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('코인', cx, cy);
    // 위쪽 포인터
    c.beginPath(); c.moveTo(cx - 10, 2); c.lineTo(cx + 10, 2); c.lineTo(cx, 20); c.closePath(); c.fillStyle = '#ff6b6b'; c.fill(); c.strokeStyle = '#fff'; c.stroke();
  };
  draw(0);
  const info = el('div', { class: 'muted', style: 'text-align:center;margin:8px 0 6px', text: '하루에 한 번, 꽝 없음. 5코인부터 1,000코인까지!' });
  const btn = el('button', { class: 'btn primary', style: 'display:block;margin:0 auto', text: '돌리기' });
  const result = el('div', { class: 'roulette-result' });
  body.append(cv, info, btn, result);
  if (h.wallet.rouletteDoneToday()) {
    btn.disabled = true; btn.textContent = '오늘은 돌렸어요';
    const t = new Date(); t.setHours(24, 0, 0, 0);
    info.textContent = `내일 다시 돌릴 수 있어요 (${Math.ceil((t.getTime() - Date.now()) / 3600000)}시간 뒤 자정)`;
  }
  let spinning = false;
  btn.onclick = () => {
    if (spinning || h.wallet.rouletteDoneToday()) return;
    spinning = true; btn.disabled = true; btn.textContent = '돌아가는 중…';
    const idx = rollRoulette();
    const prize = ROULETTE[idx].v;
    // 포인터(위쪽) 아래에 idx 칸의 가운데가 오도록. 5바퀴 반 돌고 멈춘다
    const target = Math.PI * 2 * 5 - (idx * seg + seg / 2);
    const dur = 3500, t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const ease = 1 - Math.pow(1 - k, 3);
      draw(target * ease);
      if (k < 1) window.setTimeout(step, 16); else void land();
    };
    const land = async () => {
      draw(target, idx);
      const ok = await h.wallet.claimRoulette(prize);
      if (!ok) { result.textContent = '오늘은 이미 돌렸어요. 내일 다시!'; btn.textContent = '오늘은 돌렸어요'; return; }
      result.textContent = `🎉 ${fmtCoins(prize)} 당첨!`;
      btn.textContent = '내일 또 만나요';
      h.toast(`🎰 룰렛 ${prize}코인 당첨!`);
      h.log(`🎰 오늘의 룰렛: ${prize}코인 (지갑 ${fmtCoins(h.wallet.balance)})`);
      h.stat('roulette');
      if (prize >= ROULETTE_ANNOUNCE) {
        const feed: RouletteFeed = { u: h.uid, n: h.nick, v: prize, ts: serverTimestamp() as unknown as number };
        set(push(ref(db, 'roulette/feed')), feed).catch(() => {});
      }
    };
    window.setTimeout(step, 16);
  };
}
