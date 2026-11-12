// 포커 방 판 (2026-11-12): 포커 방에 들어가 있는 동안 뜨는 패널. 테이블 두 개의 인디언 포커. 진행은 poker.ts, 설계는 shared/poker.ts.
// 경마·슬롯 판과 같은 자리·같은 모양을 쓴다(#casino 의 스타일을 그대로 받는다. 방은 한 번에 하나만 들어간다). 모바일은 화면 전체.
// 내가 낀 판: 상대 카드는 크게 보이고 내 카드는 ? 이다. 구경하는 판: 두 카드 모두 ? 이고 끝나면 공개된다.
import { el } from '../shared/util';
import { confirmModal } from './ui';
import { serverNow } from '../firebase/db';
import { fmtCoins } from '../shared/shop';
import { duelFee } from '../shared/duel';
import { POKER_ANTES, POKER_TURN_MS, pokerCap, pokerOptions, otherSide, putOf, type PokerHand, type Side } from '../shared/poker';
import type { PokerMgr, TableView } from './poker';
import type { WalletMgr } from './wallet';
import type { ServerConfig } from '../shared/types';

export interface PokerHost { uid: string; wallet: WalletMgr; config: ServerConfig; poker: PokerMgr; toast(msg: string, err?: boolean): void; leaveCasino(): Promise<void> }
const num = (n: number): string => Math.floor(n).toLocaleString('ko-KR');

export class PokerPanel {
  private root: HTMLElement | null = null;
  private offs: (() => void)[] = [];
  private timer = 0;
  constructor(private h: PokerHost) {}

  get open(): boolean { return !!this.root; }

  show(): void {
    if (this.root) return;
    const root = el('div', { id: 'casino', class: 'poker' });
    (document.getElementById('app') || document.body).append(root);
    document.body.classList.add('in-casino');
    this.root = root;
    this.h.poker.open();
    this.offs.push(this.h.poker.listen(() => this.render()));
    this.offs.push(this.h.wallet.listen(() => this.render()));
    this.timer = window.setInterval(() => this.tickCounts(), 500);
    this.render();
  }
  hide(): void {
    if (!this.root) return;
    clearInterval(this.timer);
    for (const off of this.offs) off();
    this.offs = [];
    this.h.poker.close(); // 진행 중인 내 판은 다이, 기다리던 판은 취소
    this.root.remove(); this.root = null;
    document.body.classList.remove('in-casino');
  }

  // 남은 시간 글자만 갱신한다 (판을 통째로 다시 그리면 누르던 버튼이 사라진다)
  private tickCounts(): void {
    this.root?.querySelectorAll<HTMLElement>('[data-until]').forEach((e) => {
      const left = Math.max(0, Math.ceil((Number(e.dataset.until) - serverNow()) / 1000));
      e.textContent = `${left}초`;
    });
  }

  private render(): void {
    const root = this.root; if (!root) return;
    const p = this.h.poker;
    root.innerHTML = '';
    const out = el('button', { class: 'btn small out', text: '🚪 나가기', title: '포커 방에서 나가기' });
    out.onclick = async () => {
      const mine = p.myActive();
      if (mine && mine.hand.st !== 'wait' && !(await confirmModal('진행 중인 판이 있습니다. 나가면 다이 처리됩니다. 나갈까요?', '나가기'))) return;
      out.disabled = true;
      void this.h.leaveCasino().finally(() => { out.disabled = false; });
    };
    root.append(el('div', { class: 'ch' }, [el('b', { text: '🃏 포커 방' }), el('span', { class: 'cnt' }), out]));
    root.append(el('div', { class: 'sub', text: `인디언 포커: 내 카드(1~10)는 못 보고 상대 카드만 봅니다. 큰 쪽이 이깁니다. 잔액 ${fmtCoins(this.h.wallet.balance)}` }));
    p.tables().forEach((v, i) => root.append(this.table(v, i)));
    root.append(el('div', { class: 'sub pay', text: `이기면 겨룬 돈에서 수수료 ${duelFee(this.h.config.duelFee)}% 를 뗍니다. 한 판에 걸 수 있는 돈은 참가비의 50배까지. 차례마다 ${POKER_TURN_MS / 1000}초(넘기면 다이). 돈이 모자라면 가진 만큼 올인하고 바로 공개합니다.` }));
    this.tickCounts();
  }

  private table(v: TableView, i: number): HTMLElement {
    const p = this.h.poker, h = v.hand;
    const box = el('div', { class: 'ptable' + (v.mySide && h && h.st !== 'done' ? ' mine' : '') });
    const head = el('div', { class: 'pt-head' }, [el('b', { text: `테이블 ${i + 1}` })]);
    box.append(head);
    if (h && h.st !== 'done' && !p.tableOpen(v)) head.append(el('span', { text: `참가비 ${num(h.A)}` }));

    // 빈 테이블(또는 끝난 판): 지난 결과와 판 열기
    if (!h || p.tableOpen(v)) {
      if (h && h.st === 'done') box.append(this.result(v, h));
      const row = el('div', { class: 'amts' });
      row.append(el('span', { text: '판 열기 · 참가비' }));
      for (const a of POKER_ANTES) {
        const b = el('button', { class: 'btn small primary', text: num(a) });
        b.disabled = p.working || !!p.myActive() || this.h.wallet.balance < a;
        b.onclick = () => { void p.openHand(v.t, a); };
        row.append(b);
      }
      box.append(row);
      return box;
    }
    const me = v.mySide;
    if (h.st === 'wait') {
      box.append(el('div', { class: 'pt-line', text: me ? '상대를 기다리는 중…' : `${h.an} 님이 상대를 기다립니다.` }));
      const b = el('button', { class: 'btn small' + (me ? '' : ' primary'), text: me ? '판 취소 (참가비 돌려받기)' : `참가 (${num(h.A)}코인)` });
      b.disabled = p.working || (!me && (!!p.myActive() || this.h.wallet.balance < h.A));
      b.onclick = () => { void (me ? p.cancel(v.hid!) : p.join(v.hid!)); };
      box.append(b);
      return box;
    }
    box.append(this.seats(v, h));
    if (h.st === 'deal') { box.append(el('div', { class: 'pt-line', text: '카드를 나누는 중…' })); return box; }
    if (h.st === 'show') { box.append(el('div', { class: 'pt-line', text: '카드 공개!' })); return box; }
    // 베팅 중
    const turnNick = h.turn === 'a' ? h.an : h.bn || '';
    const line = el('div', { class: 'pt-line' });
    line.append(me && h.turn === me ? '내 차례! ' : `${turnNick} 님 차례… `, el('b', { 'data-until': String((h.ta || 0) + POKER_TURN_MS), text: '' }));
    box.append(line);
    if (me && h.turn === me) box.append(this.actions(v, h, me));
    return box;
  }

  // 두 사람의 카드와 건 돈. 내가 낀 판이면 상대 카드가 보인다
  private seats(v: TableView, h: PokerHand): HTMLElement {
    const me = v.mySide, done = h.st === 'show' || h.st === 'done';
    const row = el('div', { class: 'pseats' });
    for (const s of ['a', 'b'] as Side[]) {
      const card = done ? v.cards[s] : me && s === otherSide(me) ? v.oppCard : null;
      const mine = me === s;
      const seat = el('div', { class: 'pseat' + (mine ? ' me' : '') + (h.st === 'bet' && h.turn === s ? ' turn' : '') + (h.st === 'done' && h.w === s ? ' win' : '') });
      seat.append(
        el('div', { class: 'nm', text: (s === 'a' ? h.an : h.bn || '?') + (mine ? ' (나)' : '') }),
        el('div', { class: 'pcard' + (card ? '' : ' back'), text: card ? String(card) : '?' }),
        el('div', { class: 'put', text: `💰 ${num(putOf(h, s))}` }),
      );
      row.append(seat);
    }
    return row;
  }

  private actions(v: TableView, h: PokerHand, me: Side): HTMLElement {
    const p = this.h.poker, o = pokerOptions(h, me, this.h.wallet.balance);
    const row = el('div', { class: 'pacts' });
    const btn = (text: string, cls: string, fn: () => void) => { const b = el('button', { class: 'btn small ' + cls, text }); b.disabled = p.working; b.onclick = fn; row.append(b); };
    btn('다이', 'danger', () => { void p.fold(v.hid!, me); });
    btn(o.canCheck ? '체크' : o.callAllIn ? `올인 콜 (+${num(o.callAdd)})` : `콜 (+${num(o.callAdd)})`, 'primary', () => { void p.call(v.hid!); });
    for (const r of o.raises) btn(`레이즈 +${num(r)}`, '', () => { void p.raise(v.hid!, r); });
    if (o.maxRaise > 0 && !o.raises.includes(o.maxRaise)) btn(`최대 +${num(o.maxRaise)}`, '', () => { void p.raise(v.hid!, o.maxRaise); });
    if (putOf(h, otherSide(me)) >= pokerCap(h.A)) row.append(el('span', { class: 'muted', text: '상한에 닿아 더 올릴 수 없습니다.' }));
    return row;
  }

  // 끝난 판의 결과 한 줄 (카드 포함)
  private result(v: TableView, h: PokerHand): HTMLElement {
    const box = el('div', { class: 'pt-last' });
    box.append(this.seats(v, h));
    const why = h.why === 'fold' ? '다이' : h.why === 'time' ? '시간 초과' : h.why === 'cancel' || h.why === 'deal' ? '취소' : '공개';
    const text = h.w === 'void' ? '지난 판: 취소됨' : h.w === 'tie' ? '지난 판: 비김' : `지난 판: ${h.w === 'a' ? h.an : h.bn} 님 승리 (${why})`;
    box.append(el('div', { class: 'pt-line', text }));
    return box;
  }
}
