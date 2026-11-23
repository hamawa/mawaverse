// 낚시 대회 점수판 (2026-11-24, 사용자 요청). 대회 중에만 뜬다.
// - PC: TAB 을 누르고 있는 동안 보인다. 판의 📌 로 고정하면 TAB 이 켜고 끄는 키가 된다 (고정을 풀면 다시 누르는 동안만)
// - 폰: 🏁 버튼을 누르고 있는 동안 보인다. 누른 채 아래로 내렸다 떼면 고정된다. 판의 ✕ 로 닫는다 (폰에서는 고정도 같이 풀린다)
// - 고정한 판은 제목 줄을 끌어 옮길 수 있다 (자리는 기억하지 않는다). 고정 여부만 이 브라우저에 기억한다
// 순위는 판이 떠 있는 동안에만 15초마다 읽는다 (ContestMgr.watch. 구독하면 누가 낚을 때마다 모두에게 간다). 내가 낚은 것은 바로 반영된다 (noteCatch)
import { el } from '../shared/util';
import { serverNow } from '../firebase/db';
import { fmtLeft, CONTEST_PRIZES, CONTEST_JOIN_MIN, CONTEST_JOIN_PRIZE } from '../shared/contest';
import type { ContestMgr } from './contest';

const PIN_KEY = 'mv-cboard-pin';
const MEDAL = ['🥇', '🥈', '🥉'];
const num = (n: number): string => n.toLocaleString('ko-KR');
export interface BoardHost { contest: ContestMgr; uid: string; mobile: boolean; toast(text: string, bad?: boolean): void }

export class ContestBoard {
  private root: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private pinBtn: HTMLButtonElement | null = null;
  private held = false;   // TAB · 🏁 버튼을 누르고 있다
  private open = false;   // 고정해 둔 판이 떠 있다
  private pinned = false;
  private timer = 0;
  private pos: { x: number; y: number } | null = null;
  private off: (() => void) | null = null;
  constructor(private h: BoardHost) {
    try { this.pinned = localStorage.getItem(PIN_KEY) === '1'; } catch { /* ignore */ }
  }

  // TAB · 🏁 버튼을 눌렀다(on) / 뗐다. 고정해 두었으면 누를 때마다 켜고 끄고, 아니면 누르고 있는 동안만 보인다
  hold(on: boolean): void {
    if (on) {
      if (!this.h.contest.active()) { this.h.toast(`🏁 지금은 낚시 대회 중이 아니에요. ${this.h.contest.statusText()}`); return; }
      if (this.pinned) this.open = !this.open; else this.held = true;
    } else {
      if (!this.held) return;
      this.held = false;
    }
    this.sync();
  }
  // 폰: 🏁 버튼을 누른 채 아래로 내렸다 뗐다
  pin(): void { if (this.root) this.setPinned(true); }
  private setPinned(on: boolean): void {
    this.pinned = on;
    try { localStorage.setItem(PIN_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    this.open = on; // 떠 있는 판을 고정하면 그대로 남고, 고정을 풀면 누르고 있지 않은 한 사라진다
    if (!on) this.pos = null;
    this.sync();
  }
  // 닫기 단추. 폰에서는 고정도 푼다 (폰에는 켜고 끄는 키가 없다: 다시 보려면 🏁 버튼을 누른다)
  private close(): void {
    this.open = false; this.held = false;
    if (this.h.mobile && this.pinned) { this.pinned = false; this.pos = null; try { localStorage.setItem(PIN_KEY, '0'); } catch { /* ignore */ } }
    this.sync();
  }
  // 1초마다 world 가 부른다: 대회가 끝나면 사라진다
  tick(): void { if (this.root && !this.h.contest.active()) { this.open = false; this.held = false; this.sync(); } }
  dispose(): void { this.open = false; this.held = false; this.sync(); }

  private sync(): void {
    const want = (this.held || (this.pinned && this.open)) && !!this.h.contest.active();
    if (want && !this.root) this.build();
    else if (!want && this.root) this.destroy();
    if (this.root) { this.paintHead(); this.place(); }
  }
  private build(): void {
    this.titleEl = el('div', { class: 'cb-title' });
    this.pinBtn = el('button', { class: 'btn small', text: '📌' });
    this.pinBtn.dataset.quiet = '1';
    this.pinBtn.onclick = () => this.setPinned(!this.pinned);
    const x = el('button', { class: 'btn small', text: '✕', title: '닫기' });
    x.dataset.quiet = '1';
    x.onclick = () => this.close();
    const head = el('div', { class: 'cb-head' }, [this.titleEl, el('div', { class: 'cb-btns' }, [this.pinBtn, x])]);
    this.body = el('div', { class: 'cb-body' });
    const foot = el('div', { class: 'cb-foot', text: `상금 ${CONTEST_PRIZES.map(num).join(' · ')} · ${CONTEST_JOIN_MIN}마리 이상 참가상 ${num(CONTEST_JOIN_PRIZE)}` });
    this.root = el('div', { id: 'contest-board' }, [head, this.body, foot]);
    (document.getElementById('hud') || document.getElementById('app') || document.body).append(this.root); // HUD 안에 둔다: 알림(토스트)이 판 위에 보인다
    this.drag(head);
    this.off = this.h.contest.listen(() => this.paintRows());
    this.h.contest.watch(true);
    this.timer = window.setInterval(() => this.paintHead(), 1000);
    this.paintRows();
  }
  private destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    this.off?.(); this.off = null;
    this.h.contest.watch(false);
    this.root?.remove(); this.root = this.titleEl = this.body = null; this.pinBtn = null;
  }
  // 고정한 판은 제목 줄을 끌어 옮긴다 (게임 화면 안에서만)
  private drag(head: HTMLElement): void {
    let id: number | null = null, sx = 0, sy = 0, ox = 0, oy = 0;
    head.addEventListener('pointerdown', (e) => {
      if (!this.root || !this.pinned || (e.target as HTMLElement).closest('button')) return;
      const r = this.root.getBoundingClientRect(), a = this.root.parentElement!.getBoundingClientRect();
      id = e.pointerId; sx = e.clientX; sy = e.clientY; ox = r.left - a.left; oy = r.top - a.top;
      head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    head.addEventListener('pointermove', (e) => { if (e.pointerId !== id) return; this.pos = { x: ox + e.clientX - sx, y: oy + e.clientY - sy }; this.place(); });
    const end = (e: PointerEvent): void => { if (e.pointerId === id) id = null; };
    head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
  }
  private place(): void {
    const root = this.root;
    if (!root) return;
    root.classList.toggle('pinned', this.pinned);
    if (!this.pinned || !this.pos) { root.style.left = root.style.top = root.style.transform = ''; return; }
    const a = root.parentElement!.getBoundingClientRect(), r = root.getBoundingClientRect();
    this.pos = { x: Math.max(0, Math.min(this.pos.x, a.width - r.width)), y: Math.max(0, Math.min(this.pos.y, a.height - r.height)) };
    root.style.left = `${Math.round(this.pos.x)}px`; root.style.top = `${Math.round(this.pos.y)}px`; root.style.transform = 'none';
  }
  private paintHead(): void {
    const a = this.h.contest.active();
    if (!this.root || !a) return;
    if (this.titleEl) this.titleEl.textContent = `🏁 낚시 대회 · 남은 ${fmtLeft(a.end - serverNow())}`;
    if (this.pinBtn) {
      this.pinBtn.classList.toggle('on', this.pinned);
      this.pinBtn.title = this.pinned ? (this.h.mobile ? '고정 풀기' : '고정 풀기 (TAB 을 누르는 동안만 보기)') : (this.h.mobile ? '고정' : '고정 (TAB 으로 켜고 끄기)');
    }
    if (this.topN() !== this.shownTop) this.paintRows(); // 유튜브 창을 위에 붙이거나 뗐다: 보여 줄 줄 수가 달라진다
  }
  // 보여 줄 순위 수: PC 10 · 폰 5 · 폰에서 유튜브 창을 위에 붙여 게임 화면이 낮을 때 3 (조이스틱을 덮지 않게)
  private topN(): number { return !this.h.mobile ? 10 : document.body.classList.contains('dj-dock') ? 3 : 5; }
  private shownTop = 0;
  private paintRows(): void {
    const body = this.body, c = this.h.contest;
    if (!body) return;
    body.innerHTML = '';
    const top = this.shownTop = this.topN();
    if (!c.rankLoaded) { body.append(el('div', { class: 'cb-empty', text: '불러오는 중…' })); return; }
    const rows = c.rank, mine = rows.findIndex((r) => r.u === this.h.uid);
    if (!rows.length) body.append(el('div', { class: 'cb-empty', text: '아직 아무도 낚지 못했어요.' }));
    const line = (i: number): HTMLElement => {
      const r = rows[i];
      return el('div', { class: 'cb-row' + (i === mine ? ' me' : '') }, [
        el('span', { class: 'cb-rank', text: MEDAL[i] || String(i + 1) }), el('span', { class: 'cb-nick', text: r.n }),
        el('span', { class: 'cb-pts', text: `${num(r.p)}점` }), el('span', { class: 'cb-cnt', text: `${num(r.c)}마리` }),
      ]);
    };
    for (let i = 0; i < Math.min(top, rows.length); i++) body.append(line(i));
    if (mine >= top) { body.append(el('div', { class: 'cb-gap', text: '⋯' })); body.append(line(mine)); }
    else if (mine < 0 && rows.length) body.append(el('div', { class: 'cb-empty', text: '나: 아직 기록이 없어요.' }));
    if (!this.h.mobile && rows.length > top) body.append(el('div', { class: 'cb-empty', text: `참가 ${rows.length}명` }));
  }
}
