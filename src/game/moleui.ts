import { ref, get, update, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { el, dayKey } from '../shared/util';
import { modal, withCloseX } from './ui';
import { weekKey } from '../shared/fish';
import type { WalletMgr } from './wallet';
import type { Input } from './input';

export const MOLE_GAME_MS = 30000;
export const MOLE_DAILY_COIN_GAMES = 3; // 하루에 코인을 주는 판 수
export const MOLE_MAX_SCORE = 150;

export interface MoleHost { uid: string; nick: string; wallet: WalletMgr; input: Input; toast(msg: string, err?: boolean): void; stat(key: string): void }
export interface MoleWeekEntry { n: string; s: number; g: number; at: number } // arcade/mole/week/{wk}/{uid}: 닉, 최고 점수, 판 수, 마지막

type Kind = 'normal' | 'gold' | 'bomb';
interface Mole { cell: number; kind: Kind; until: number; hit: boolean }
const KEYPAD = [7, 8, 9, 4, 5, 6, 1, 2, 3]; // 구멍 i(읽는 순서)에 붙는 숫자 키

// 두더지 잡기: 3×3 구멍, 30초. 숫자 1~9 또는 터치. 보통 +1, 황금 +3, 폭탄 −2.
// 구멍 번호는 숫자 키패드 배열(윗줄 7 8 9, 아랫줄 1 2 3)을 따른다. 읽는 순서(1 2 3 이 윗줄)로 두면 키패드와 상하가 뒤집힌다.
// 주간 최고 점수 랭킹. 코인은 점수 ÷ 3, 하루 3판까지.
export function openMole(h: MoleHost): void {
  h.input.enabled = false; h.input.releaseAll(); // 숫자 키가 이모트로 새지 않게
  const body = el('div', { class: 'mole' });
  const m = modal('🕹 두더지 잡기', body, [], false);
  m.root.querySelector('.actions')?.remove();
  withCloseX(m);
  let timer = 0, loopId = 0;
  const onKey = (e: KeyboardEvent) => { if (!playing) return; const cell = KEYPAD.indexOf(Number(e.key)); if (cell >= 0) { e.preventDefault(); e.stopPropagation(); hitCell(cell); } };
  const origClose = m.close;
  const cleanup = () => { clearInterval(loopId); clearTimeout(timer); document.removeEventListener('keydown', onKey, true); h.input.enabled = true; };
  m.close = () => { cleanup(); origClose(); };
  document.addEventListener('keydown', onKey, true);

  const head = el('div', { class: 'mole-head' });
  const grid = el('div', { class: 'mole-grid' });
  const holes: HTMLElement[] = [];
  const moleEls: HTMLElement[] = [];
  for (let i = 0; i < 9; i++) {
    const hole = el('div', { class: 'hole' });
    const mole = el('div', { class: 'mole-body' });
    hole.append(el('span', { class: 'num', text: String(KEYPAD[i]) }), mole);
    hole.onpointerdown = (e) => { e.preventDefault(); hitCell(i); };
    holes.push(hole); moleEls.push(mole); grid.append(hole);
  }
  const foot = el('div', { class: 'mole-foot' });
  const rankBox = el('div', { class: 'mole-rank' });
  body.append(head, grid, foot, rankBox);

  let playing = false, score = 0, endAt = 0, nextPop = 0, moles: Mole[] = [], best = 0, games = 0, todayGames = 0;

  const setHead = (left: number) => { head.innerHTML = `<span>점수 <b>${score}</b></span><span>남은 <b>${Math.max(0, left / 1000).toFixed(1)}</b>초</span><span>이번 주 최고 <b>${best}</b></span>`; };

  const render = () => {
    for (let i = 0; i < 9; i++) {
      const mo = moles.find((x) => x.cell === i);
      holes[i].classList.toggle('up', !!mo && !mo.hit);
      moleEls[i].className = 'mole-body' + (mo ? ' ' + mo.kind : '');
    }
  };
  const hitCell = (cell: number) => {
    if (!playing) return;
    const mo = moles.find((x) => x.cell === cell && !x.hit);
    if (!mo) { holes[cell].classList.remove('miss'); void holes[cell].offsetWidth; holes[cell].classList.add('miss'); return; }
    mo.hit = true; mo.until = performance.now() + 120;
    score = Math.max(0, score + (mo.kind === 'gold' ? 3 : mo.kind === 'bomb' ? -2 : 1));
    holes[cell].classList.remove('hit', 'boom'); void holes[cell].offsetWidth; holes[cell].classList.add(mo.kind === 'bomb' ? 'boom' : 'hit');
    render();
  };
  const loop = () => {
    const now = performance.now();
    const left = endAt - now;
    if (left <= 0) { finish(); return; }
    moles = moles.filter((x) => x.until > now);
    if (now >= nextPop) {
      const prog = 1 - left / MOLE_GAME_MS; // 0 → 1: 갈수록 빨라진다
      const free = [...Array(9).keys()].filter((c) => !moles.some((x) => x.cell === c));
      const count = prog > 0.5 && Math.random() < 0.35 ? 2 : 1;
      for (let i = 0; i < count && free.length; i++) {
        const cell = free.splice(Math.floor(Math.random() * free.length), 1)[0];
        const r = Math.random();
        const kind: Kind = r < 0.12 ? 'bomb' : r < 0.27 ? 'gold' : 'normal';
        moles.push({ cell, kind, until: now + 1000 - prog * 350 + Math.random() * 150, hit: false });
      }
      nextPop = now + 900 - prog * 450 + Math.random() * 200;
    }
    setHead(left);
    render();
  };
  const start = () => {
    score = 0; moles = []; playing = false;
    foot.innerHTML = '';
    let n = 3;
    const cd = el('div', { class: 'mole-count', text: '3' });
    foot.append(cd);
    const step = () => {
      n--;
      if (n > 0) { cd.textContent = String(n); timer = window.setTimeout(step, 700); return; }
      cd.remove();
      playing = true; endAt = performance.now() + MOLE_GAME_MS; nextPop = performance.now() + 400;
      foot.append(el('div', { class: 'muted', text: '숫자 1~9 또는 터치로 때리세요! 황금 +3, 폭탄 −2' }));
      loopId = window.setInterval(loop, 50);
    };
    timer = window.setTimeout(step, 700);
    setHead(MOLE_GAME_MS);
  };
  const finish = async () => {
    clearInterval(loopId); playing = false; moles = []; render(); setHead(0);
    const coinGame = todayGames < MOLE_DAILY_COIN_GAMES;
    const coins = coinGame ? Math.floor(score / 3) : 0;
    foot.innerHTML = '';
    foot.append(el('div', { class: 'mole-result', text: `끝! ${score}점${score > best ? ' · 이번 주 최고 기록 갱신!' : ''}` }));
    foot.append(el('div', { class: 'muted', text: coinGame ? `💰 +${coins} (오늘 ${todayGames + 1}/${MOLE_DAILY_COIN_GAMES}판 코인 지급)` : `오늘 코인 지급 ${MOLE_DAILY_COIN_GAMES}판을 다 썼어요. 랭킹 도전은 계속!` }));
    const again = el('button', { class: 'btn primary', text: '다시 하기' });
    again.onclick = start;
    foot.append(again);
    best = Math.max(best, score); games++; todayGames++;
    try {
      const wk = weekKey(), dk = dayKey();
      const wPath = `arcade/mole/week/${wk}/${h.uid}`, dPath = `arcade/mole/day/${dk}/${h.uid}`;
      const [ws, ds] = await Promise.all([get(ref(db, wPath)), get(ref(db, dPath))]);
      const we = ws.val() as MoleWeekEntry | null; const de = ds.val() as { g: number } | null;
      await update(ref(db), {
        [wPath]: { n: h.nick, s: Math.min(MOLE_MAX_SCORE, Math.max(we?.s || 0, score)), g: (we?.g || 0) + 1, at: serverTimestamp() },
        [dPath]: { g: (de?.g || 0) + 1 },
      });
      if (coins > 0) void h.wallet.earn(coins);
      h.stat('mole');
    } catch (e) { console.warn('mole save failed', e); h.toast('기록 저장에 실패했습니다.', true); }
    void loadRank();
  };
  const loadRank = async () => {
    const wk = weekKey();
    try {
      const [all, mine, day] = await Promise.all([get(ref(db, `arcade/mole/week/${wk}`)), get(ref(db, `arcade/mole/week/${wk}/${h.uid}`)), get(ref(db, `arcade/mole/day/${dayKey()}/${h.uid}`))]);
      const me = mine.val() as MoleWeekEntry | null;
      best = me?.s || 0; games = me?.g || 0; todayGames = (day.val() as { g: number } | null)?.g || 0;
      const rows = Object.entries((all.val() || {}) as Record<string, MoleWeekEntry>).sort((a, b) => (b[1].s - a[1].s) || (a[1].at - b[1].at)).slice(0, 5);
      rankBox.innerHTML = '';
      rankBox.append(el('div', { class: 'muted', text: `이번 주 TOP 5 · 코인은 점수 ÷ 3, 하루 ${MOLE_DAILY_COIN_GAMES}판까지 (오늘 ${Math.min(todayGames, MOLE_DAILY_COIN_GAMES)}/${MOLE_DAILY_COIN_GAMES})` }));
      const medals = ['🥇', '🥈', '🥉', '4', '5'];
      rows.forEach(([uid, r], i) => rankBox.append(el('div', { class: 'row' + (uid === h.uid ? ' me' : ''), text: `${medals[i]} ${r.n}${uid === h.uid ? ' (나)' : ''} — ${r.s}점 (${r.g}판)` })));
      if (!rows.length) rankBox.append(el('div', { class: 'muted', text: '아직 아무도 안 했어요. 첫 기록을 세워보세요!' }));
      if (!playing) setHead(MOLE_GAME_MS);
    } catch { rankBox.textContent = '랭킹을 불러오지 못했습니다.'; }
  };

  setHead(MOLE_GAME_MS);
  render();
  const startBtn = el('button', { class: 'btn primary', text: '시작 (30초)' });
  startBtn.onclick = start;
  foot.append(startBtn, el('div', { class: 'muted', text: '두더지가 올라오면 그 구멍의 숫자 키(1~9)를 누르거나 터치. 황금 두더지 +3, 폭탄 −2.' }));
  void loadRank();
}
