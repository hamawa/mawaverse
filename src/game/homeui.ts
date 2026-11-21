import { ref, get } from 'firebase/database';
import { db } from '../firebase/app';
import { el } from '../shared/util';
import { modal, withCloseX, confirmModal, promptModal } from './ui';
import { BUNDLES, SLOT_FISH, SHIELD_FISH, SHIELD_MAX, SLEEP_MS, CHOP_SWINGS, HOME_MAX_TIER, homeTier, nextTier, extraSlotsOf, slotItem, fmtWood, FURNITURE, FLOORS, FLOOR_WOOD, WALLS, GUEST_MAX, TROPHY_MIN_RARITY, PHOTO_FRAMES, PHOTO_EDGE, PHOTO_MAX_CHARS, furnitureOf, TURN_NAMES, TURN_ORDER, woodBonus } from '../shared/home';
import { fishById, fmtSize, RARITY_NAME, type FishBookEntry } from '../shared/fish';
import { winterFishById } from '../shared/winter';
import { itemById, priceOf, fmtCoins, GOLD_COST, isXmasItem } from '../shared/shop';
import { xmasSeason } from '../shared/season';
import { serverNow } from '../firebase/db';
import { fmtGold } from '../shared/mine';
import type { World } from './world';

// 집 창 (2026-11-17): 내 메뉴의 "🏠 내 집", 집 안 창고 상자 앞 F. 짓기·올리기, 드나들기·문 잠금, 창고(칸 늘리기·묶음 판매), 겨울잠 안내.
// 집·지갑 값이 바뀔 때마다 통째로 다시 그린다
let opened: { close: () => void } | null = null;
export function openHome(w: World): void {
  if (opened) return;
  const h = w.home;
  const body = el('div', { style: 'min-width:260px;max-width:420px;line-height:1.5' });
  const price = (id: string): number => { const it = itemById(id); return it ? priceOf(it, w.config.prices) : 0; };
  const n = (v: number): string => v.toLocaleString('ko-KR');
  const title = (text: string) => el('div', { style: 'font-weight:700;margin:12px 0 4px', text });
  const line = (text: string, dim = false) => el('div', { style: dim ? 'opacity:.75;font-size:12px' : '', text });
  const row = (...c: Node[]) => el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0' }, c);
  const btn = (label: string, onClick: () => unknown, enabled = true, primary = false): HTMLButtonElement => {
    const b = el('button', { class: 'btn small' + (primary ? ' primary' : ''), text: label });
    b.disabled = !enabled || h.working;
    b.onclick = () => { void Promise.resolve(onClick()).then(render); render(); };
    return b;
  };
  let closeModal: (() => void) | null = null;
  const render = (): void => {
    body.innerHTML = '';
    const t = homeTier(h.data?.t), next = nextTier(h.data);
    body.append(el('div', { style: 'font-size:16px;font-weight:700', text: t ? `${t.icon} ${t.name}` : '아직 집이 없어요' }));
    body.append(line(`${fmtWood(h.wood)} · ${fmtCoins(w.wallet.balance)}`));
    const wb = woodBonus(w.wallet.pickLevel);
    body.append(line(`나무는 어느 맵이든 나무를 보고 F (한 번에 ${CHOP_SWINGS}번 휘두르고 ${1 + wb}~${2 + wb}개씩 나와요. 곡괭이를 강화하면 더 나와요).`, true));

    if (next) {
      const paid = !next.item || w.wallet.owns(next.item);
      const cost = `나무 ${n(next.wood)}개` + (next.item ? (paid ? ' (코인은 이미 냈어요)' : ` + ${fmtCoins(price(next.item))}`) : '');
      body.append(title(t ? `다음 집: ${next.icon} ${next.name}` : `${next.icon} ${next.name} 짓기`));
      body.append(line(`${cost} · ${next.perk}`));
      body.append(row(
        btn(t ? `${next.name}(으)로 올리기` : `${next.name} 짓기`, async () => {
          if (!(await confirmModal(`${next.name}${t ? '(으)로 올릴까요' : '을(를) 지을까요'}? ${cost} 듭니다.${h.inMine() ? ' 집 밖으로 나가서 짓습니다.' : ''}`))) return;
          const r = await h.build();
          if (r === 'ok') w.toast(`🎉 ${next.icon} ${next.name} 완성! 내 메뉴의 🏠 내 집에서 들어갈 수 있어요.`);
          else w.toast(r === 'wood' ? '나무가 모자랍니다.' : r === 'coins' ? '코인이 모자랍니다.' : '짓지 못했습니다. 잠시 후 다시 시도하세요.', true);
        }, h.wood >= next.wood, true),
        line(`나무 ${n(Math.min(h.wood, next.wood))}/${n(next.wood)}`, true),
      ));
    } else body.append(line('🧱 벽돌집까지 다 지었어요.', true));

    if (!t) return;
    body.append(title('🚪 드나들기'));
    body.append(row(
      btn(h.inMine() ? '밖으로 나가기' : '집에 들어가기', () => { closeModal?.(); return h.inMine() ? w.leaveHome() : w.goHome(w.uid); }),
      ...(t.tier >= 2 ? [btn(h.locked ? '🔓 문 열기 (지금: 잠김)' : '🔒 문 잠그기 (지금: 열림)', async () => { if (!(await h.setLock(!h.locked))) w.toast('바꾸지 못했습니다.', true); })] : []),
    ));
    body.append(line(t.tier >= 2 ? '문을 잠그면 남이 못 들어오고, 안에 있던 사람은 밖으로 나가요.' : '초가집은 문을 못 잠가요. 누구나 들어올 수 있어요.', true));

    // 금고 (2026-11-20 건의): 코인을 넣어 두고 꺼내 쓴다. 이자 없음
    body.append(title('🔐 금고'));
    body.append(line(`💰 ${n(h.vault)}코인 보관 중`));
    body.append(line('넣어 둔 코인은 꺼내기 전까지 상점·도박·내기·거래소에 쓰이지 않아요. 이자는 없어요.', true));
    body.append(row(btn('넣기', () => vaultFlow(w, 1), w.wallet.balance > 0), btn('꺼내기', () => vaultFlow(w, -1), h.vault > 0)));

    body.append(title('📦 창고'));
    body.append(line(`🐟 ${n(h.fish)} / ${n(h.capacity)}마리 (${h.slots}칸 · 한 칸 ${SLOT_FISH}마리)`));
    body.append(line('낚을 때마다 코인은 그대로 받고, 덤으로 한 마리씩 쌓여요 (1분마다 모아서 들어와요. 꽝은 제외).', true));
    const ex = extraSlotsOf(h.data);
    if (ex < t.extraSlots) {
      const p = price(slotItem(ex + 1)), paid = w.wallet.owns(slotItem(ex + 1));
      body.append(row(btn(paid ? '칸 늘리기 (코인은 이미 냈어요)' : `칸 늘리기 ${fmtCoins(p)}`, async () => {
        if (!paid && !(await confirmModal(`창고를 ${h.slots + 1}칸으로 늘릴까요? ${fmtCoins(p)} 듭니다.`))) return;
        const r = await h.addSlot();
        if (r === 'ok') w.toast(`📦 창고가 ${h.slots + 1}칸이 됐어요.`);
        else w.toast(r === 'coins' ? '코인이 모자랍니다.' : '늘리지 못했습니다. 잠시 후 다시 시도하세요.', true);
      })));
    } else body.append(line(t.tier < HOME_MAX_TIER ? '칸은 여기까지예요. 다음 집으로 올리면 더 늘릴 수 있어요.' : '칸을 전부 늘렸어요.', true));
    for (const b of BUNDLES) {
      body.append(row(
        btn(`${n(b.n)}마리 팔기 → ${fmtCoins(b.price)}`, async () => {
          if (await h.sell(b)) w.toast(`🐟 물고기 ${n(b.n)}마리를 팔았다! +${fmtCoins(b.price)}`);
          else w.toast('팔지 못했습니다. 잠시 후 다시 시도하세요.', true);
        }, h.canSell(b)),
        line(h.slots < b.slots ? `${b.slots}칸부터 팔 수 있어요` : `한 마리에 ${b.price / b.n}코인`, true),
      ));
    }

    body.append(title('😴 겨울잠'));
    body.append(line(`든든함 🐟 ${h.shield}/${SHIELD_MAX}`));
    body.append(line(`집 안 침대를 보고 F. ${SLEEP_MS / 60000}분을 자면 창고 물고기 ${SHIELD_FISH}마리를 먹고 든든함이 1 쌓여요. 든든함 하나가 빠따 한 번을 막아 줘요(갑옷·펫 방어가 안 깨져요).`, true));

    // 방명록 (2026-11-18): 놀러 온 사람이 남긴 글
    body.append(title('📖 방명록'));
    body.append(row(btn(`방명록 보기 (${Object.keys(h.data?.gb || {}).length}줄)`, () => { closeModal?.(); openGuestbook(w, w.uid); }, true), line('놀러 온 사람이 한 줄씩 남길 수 있어요', true)));

    // 꾸미기 (2026-11-17 저녁): 가구는 나무로 종류마다 한 번 만들고, 꾸미기 모드에서 F 로 놓고 치운다
    body.append(title('🛋 꾸미기'));
    body.append(line(`놓은 가구 ${h.decoCount}/${h.decoLimit}개`));
    body.append(row(btn(h.decorating ? '꾸미기 모드 끄기' : '꾸미기 모드 켜기', () => {
      h.decorating = !h.decorating;
      if (h.decorating) { closeModal?.(); w.toast('🛋 꾸미기 모드: 빈 칸을 보고 F 로 가구를 놓고, 놓은 가구를 보고 F 로 치워요.'); }
    }, h.inMine()), line(h.inMine() ? '빈 칸을 보고 F 로 놓고, 놓은 가구를 보고 F 로 치워요' : '집 안에서 켤 수 있어요', true)));
    body.append(line('가구는 종류마다 나무로 한 번 만들면 몇 개든 놓을 수 있어요. 하나라도 놓으면 기본 가구는 치워져요.', true));
    const fbox = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0' });
    for (const f of FURNITURE) if (!f.item) fbox.append(craftButton(w, f.o, btn));
    body.append(fbox);
    // 고급 가구 (2026-11-18): 코인으로, 황금 가구는 코인과 금덩이로
    body.append(line('고급 가구는 코인으로 사요. 황금 가구는 금광에서 캔 금덩이가 함께 들어요.', true));
    const pbox = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0' });
    for (const f of FURNITURE) if (f.item && onOffer(w, f)) pbox.append(craftButton(w, f.o, btn));
    body.append(pbox);

    body.append(title('바닥'));
    body.append(row(...FLOORS.map((f) => btn(h.data?.fl === f.g ? `✔ ${f.name}` : f.name, async () => {
      const r = await h.setFloor(f.g);
      if (r !== 'ok') w.toast(r === 'wood' ? '나무가 모자랍니다.' : '바꾸지 못했습니다.', true);
    }, h.data?.fl !== f.g && h.wood >= FLOOR_WOOD))));
    body.append(line(`바꿀 때마다 나무 ${FLOOR_WOOD}개가 들어요.`, true));

    // 벽지 (2026-11-18): 한 번 사면 값 없이 몇 번이든 바꿀 수 있다
    body.append(title('벽지'));
    const cur = h.data?.wl || 0;
    body.append(row(btn(cur === 0 ? '✔ 기본 벽' : '기본 벽', async () => { if ((await h.setWall(0)) !== 'ok') w.toast('바꾸지 못했습니다.', true); }, cur !== 0),
      ...WALLS.map((wl) => {
        const it = itemById(wl.item), own = w.wallet.owns(wl.item), price = it ? priceOf(it, w.config.prices) : 0;
        return btn(cur === wl.n ? `✔ ${wl.name}` : own ? wl.name : `${wl.name} ${fmtCoins(price)}`, async () => {
          if (!own && !(await confirmModal(`${wl.name}를 ${fmtCoins(price)}에 살까요? 한 번 사면 몇 번이든 바꿀 수 있어요.`))) return;
          const r = await h.setWall(wl.n);
          if (r !== 'ok') w.toast(r === 'coins' ? '코인이 모자랍니다.' : '바꾸지 못했습니다.', true);
        }, cur !== wl.n && (own || w.wallet.balance >= price));
      })));

    body.append(title('🏆 박제 · 🖼 사진 액자'));
    body.append(line('벽의 자리마다 내가 잡은 전설·신화 물고기나 사진을 걸 수 있어요. 사진은 액자(나무·금테)를 사서 걸고, 사진 앞에서 F 를 누르면 크게 보여요.', true));
    t.trophyX.forEach((_x, i) => {
      const tr = h.data?.tr?.[String(i)], f = tr ? (fishById(tr.id) ?? winterFishById(tr.id)) : undefined;
      const ph = h.data?.ph?.[String(i)];
      body.append(row(
        line(`${i + 1}번 자리: ${ph ? `🖼 사진 (${PHOTO_FRAMES.find((x) => x.k === ph.k)?.name || '액자'})` : tr && f ? `${f.icon} ${f.name}${tr.s ? ` ${fmtSize(tr.s)}` : ''}` : '비어 있음'}`),
        btn('물고기', () => pickTrophy(w, i)),
        btn('📷 사진', () => pickPhoto(w, i)),
        ...(ph ? [btn('내리기', async () => { if (!(await h.removePhoto(w.uid, i))) w.toast('내리지 못했습니다.', true); })] : tr ? [btn('내리기', async () => { if (!(await h.setTrophy(i, null))) w.toast('내리지 못했습니다.', true); })] : []),
      ));
    });
  };
  const offs = [h.listen(render), w.wallet.listen(render)];
  render();
  const m = modal('🏠 내 집', body, [{ label: '닫기', onClick: () => {} }], false, () => { offs.forEach((f) => f()); opened = null; closeModal = null; });
  withCloseX(m);
  opened = m; closeModal = m.close;
}

type Btn = (label: string, onClick: () => unknown, enabled?: boolean, primary?: boolean) => HTMLButtonElement;
// 지금 내놓는 가구인가: 크리스마스 한정(꼬마 트리)은 그 철(12/1~12/25)에만 판다. 이미 만들었거나 값을 낸 사람에게는 언제나 보인다 (2026-11-21)
function onOffer(w: World, f: { o: number; item?: string }): boolean {
  return !f.item || !isXmasItem(f.item) || w.home.made(f.o) || w.wallet.owns(f.item) || xmasSeason(serverNow());
}
// 가구 하나: 만들었으면 표시만, 아니면 나무로 만드는 단추
function craftButton(w: World, o: number, btn: Btn): HTMLElement {
  const f = FURNITURE.find((x) => x.o === o)!;
  if (w.home.made(o)) return el('span', { style: 'font-size:12px;opacity:.8;padding:4px 6px', text: `✔ ${f.name}` });
  if (f.item) {
    // 고급 가구: 코인(+ 금덩이)으로 산다. 값만 내고 끊겼으면(이미 가진 품목) 값 없이 이어서 등록된다
    const it = itemById(f.item), own = w.wallet.owns(f.item), price = it ? priceOf(it, w.config.prices) : 0, gold = GOLD_COST[f.item] || 0;
    const cost = `${fmtCoins(price)}${gold ? ` + ${fmtGold(gold)}` : ''}`;
    return btn(own ? `${f.name} 놓을 준비` : `${f.name} ${cost}`, async () => {
      if (!own && !(await confirmModal(`${f.name}을(를) ${cost}에 살까요? 한 번 사면 몇 개든 놓을 수 있어요.`))) return;
      const r = await w.home.craft(o);
      if (r === 'ok') w.toast(`🛋 ${f.name}을(를) 샀어요. 꾸미기 모드에서 놓을 수 있어요.`);
      else w.toast(r === 'coins' ? (gold ? '코인이나 금덩이가 모자랍니다.' : '코인이 모자랍니다.') : '사지 못했습니다.', true);
    }, own || (w.wallet.balance >= price && w.wallet.gold >= gold));
  }
  return btn(`${f.name} 만들기 ${fmtWood(f.wood)}`, async () => {
    const r = await w.home.craft(o);
    if (r === 'ok') w.toast(`🛋 ${f.name}을(를) 만들었어요. 꾸미기 모드에서 놓을 수 있어요.`);
    else w.toast(r === 'wood' ? '나무가 모자랍니다.' : '만들지 못했습니다.', true);
  }, w.home.wood >= f.wood);
}

// 방명록 (2026-11-18): owner 의 집에 남긴 글. 손님은 한 줄을 남기고(다시 쓰면 바뀐다), 주인은 읽고 지운다. 그 집 안에 있거나 내 집일 때 연다
export function openGuestbook(w: World, owner: string): void {
  const mine = owner === w.uid;
  const body = el('div', { style: 'min-width:260px;max-width:420px;line-height:1.5' });
  const draw = () => {
    body.innerHTML = '';
    const data = mine ? w.home.data : w.home.here();
    const notes = Object.entries(data?.gb || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    if (!notes.length) body.append(el('p', { class: 'muted', text: mine ? '아직 아무도 글을 남기지 않았어요.' : '아직 글이 없어요. 첫 줄을 남겨 보세요.' }));
    for (const [uid, n] of notes) {
      const row = el('div', { style: 'display:flex;gap:8px;align-items:flex-start;margin:6px 0' });
      row.append(el('div', { style: 'flex:1;word-break:break-all' }, [el('b', { text: n.n }), el('span', { text: ` ${n.t}` }), el('div', { class: 'muted', style: 'font-size:11px', text: n.at ? new Date(n.at).toLocaleDateString('ko-KR') : '' })]));
      if (mine || uid === w.uid) { const del = el('button', { class: 'btn small', text: '지우기' }); del.onclick = async () => { del.disabled = true; if (await w.home.eraseGuestNote(owner, uid)) window.setTimeout(draw, 250); else w.toast('지우지 못했습니다.', true); }; row.append(del); }
      body.append(row);
    }
    if (!mine) {
      const my = data?.gb?.[w.uid];
      const input = el('input', { type: 'text', maxlength: String(GUEST_MAX), placeholder: `한 줄 남기기 (${GUEST_MAX}자)`, value: my?.t || '', style: 'flex:1;min-width:0' }) as HTMLInputElement;
      const send = el('button', { class: 'btn primary small', text: my ? '고쳐 쓰기' : '남기기' });
      send.onclick = async () => {
        if (!input.value.trim()) return;
        send.disabled = true;
        if (await w.home.signGuestbook(owner, input.value)) { w.toast('📖 방명록에 남겼어요.'); window.setTimeout(draw, 250); } else { w.toast('남기지 못했습니다.', true); send.disabled = false; }
      };
      body.append(el('div', { style: 'display:flex;gap:6px;margin-top:10px' }, [input, send]), el('p', { class: 'muted', style: 'font-size:11px', text: '한 집에 한 줄을 남길 수 있어요. 다시 쓰면 바뀝니다.' }));
    }
  };
  draw();
  w.input.releaseAll();
  modal(mine ? '📖 내 집 방명록' : `📖 ${w.nickOf(owner)} 님 집 방명록`, body, [{ label: '닫기', onClick: () => {} }]);
}

// 꾸미기 모드에서 빈 칸을 보고 F: 내 앞 칸에 놓을 가구를 고른다
let picker: { close: () => void } | null = null;
export function openFurniturePicker(w: World): void {
  if (picker) return;
  const h = w.home;
  const body = el('div', { style: 'min-width:240px;max-width:380px;line-height:1.5' });
  let close: (() => void) | null = null;
  const btn: Btn = (label, onClick, enabled = true, primary = false) => {
    const b = el('button', { class: 'btn small' + (primary ? ' primary' : ''), text: label });
    b.disabled = !enabled || h.working;
    b.onclick = () => { void Promise.resolve(onClick()).then(render); };
    return b;
  };
  const render = (): void => {
    body.innerHTML = '';
    body.append(el('div', { text: `놓은 가구 ${h.decoCount}/${h.decoLimit}개 · ${fmtWood(h.wood)}` }));
    if (h.decoCount >= h.decoLimit) { body.append(el('div', { style: 'opacity:.75;font-size:12px', text: '더 놓을 수 없어요. 놓은 가구를 치우거나 집을 올리면 더 놓을 수 있어요.' })); return; }
    const made = FURNITURE.filter((f) => h.made(f.o));
    const box = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0' });
    for (const f of made) box.append(btn(f.name, async () => {
      const r = await h.place(f.o);
      if (r === 'ok') close?.();
      else w.toast(r === 'limit' ? '더 놓을 수 없어요.' : r === 'spot' ? '여기에는 놓을 수 없어요.' : '놓지 못했습니다.', true);
    }, true, true));
    body.append(made.length ? box : el('div', { style: 'opacity:.75;font-size:12px;margin:6px 0', text: '아직 만든 가구가 없어요. 아래에서 나무로 만들 수 있어요.' }));
    const rest = FURNITURE.filter((f) => !h.made(f.o) && onOffer(w, f));
    if (rest.length) {
      body.append(el('div', { style: 'font-weight:700;margin:10px 0 4px', text: '가구 만들기' }));
      const cbox = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' });
      for (const f of rest) cbox.append(craftButton(w, f.o, btn));
      body.append(cbox);
    }
  };
  const off = h.listen(render);
  render();
  const m = modal('🛋 가구 놓기', body, [{ label: '닫기', onClick: () => {} }], false, () => { off(); picker = null; close = null; });
  withCloseX(m);
  picker = m; close = m.close;
}

// 놓은 가구 손보기 (2026-11-19, 사용자 요청): 꾸미기 모드에서 돌릴 수 있는 가구를 보고 F. 어느 쪽을 볼지 고르거나 치운다.
// 창은 화면 아래쪽에 띄우고 뒤를 어둡게 덮지 않는다: 가운데에 뜨면 바로 옆의 가구를 가려 돌린 모습이 안 보인다. 방향을 골라도 창은 그대로 둔다 (여러 번 돌려 보게)
const TURN_ARROW = ['↓', '←', '→', '↑'];
export function openFurnitureEdit(w: World, x: number, y: number, o: number): void {
  if (picker) return;
  const h = w.home;
  const body = el('div', { style: 'min-width:240px;line-height:1.5' });
  let close: (() => void) | null = null;
  let busy = false;
  const render = (): void => {
    if (h.decoAt(x, y) !== o) { close?.(); return; } // 그새 치워졌다
    body.innerHTML = '';
    const cur = h.turnAt(x, y);
    body.append(el('div', { style: 'opacity:.8;font-size:12px;margin-bottom:6px', text: '어느 쪽을 보게 할까요?' }));
    const box = el('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px' });
    for (const d of TURN_ORDER) {
      const b = el('button', { class: 'btn small' + (d === cur ? ' primary' : ''), text: `${TURN_ARROW[d]} ${TURN_NAMES[d]}` });
      b.disabled = busy || d === cur;
      b.onclick = async () => {
        busy = true; render();
        const ok = await h.setTurn(x, y, o, d);
        busy = false;
        if (!ok) w.toast('돌리지 못했습니다.', true);
        render();
      };
      box.append(b);
    }
    body.append(box);
  };
  const off = h.listen(render);
  const m = modal(`🛋 ${furnitureOf(o)?.name ?? '가구'}`, body, [
    { label: '치우기', danger: true, onClick: async () => { if (!(await h.removeAt(x, y, o))) w.toast('치우지 못했습니다.', true); } },
    { label: '닫기', onClick: () => {} },
  ], false, () => { off(); picker = null; close = null; });
  withCloseX(m);
  const bg = m.root.parentElement;
  if (bg) { bg.style.alignItems = 'flex-end'; bg.style.background = 'transparent'; bg.style.paddingBottom = '14vh'; }
  picker = m; close = m.close;
  render();
}

// 금고에 넣기(+1)·꺼내기(-1): 금액을 묻는다
async function vaultFlow(w: World, sign: 1 | -1): Promise<void> {
  const max = sign > 0 ? w.wallet.balance : w.home.vault;
  const v = await promptModal(sign > 0 ? '🔐 금고에 넣기' : '🔐 금고에서 꺼내기', `${sign > 0 ? '넣을' : '꺼낼'} 코인 (최대 ${max.toLocaleString('ko-KR')})`, String(max), 12);
  if (v === null) return;
  const amt = Math.min(max, Math.floor(Number(v.replace(/[^0-9]/g, ''))));
  if (!amt || amt < 1) { w.toast('1 이상의 숫자를 적어 주세요.', true); return; }
  const r = await w.home.vaultMove(sign * amt);
  w.toast(r === 'ok' ? (sign > 0 ? `🔐 ${fmtCoins(amt)}을 금고에 넣었어요.` : `💰 ${fmtCoins(amt)}을 금고에서 꺼냈어요.`) : r === 'coins' ? '코인이 모자랍니다.' : r === 'empty' ? '금고에 그만큼 없어요.' : '처리하지 못했습니다.', r !== 'ok');
}

// 사진을 올리기 좋게 줄인다: 긴 변 PHOTO_EDGE 부터 시작해 글자 수가 PHOTO_MAX_CHARS 안에 들 때까지 화질·크기를 낮춘다 (무료 플랜이라 DB 에 넣는다)
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('load')); im.src = url; });
    let edge = PHOTO_EDGE;
    for (let tries = 0; tries < 7; tries++) {
      const k = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
      const c = cv.getContext('2d')!; c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.drawImage(img, 0, 0, cv.width, cv.height);
      for (const q of [0.82, 0.7, 0.55]) { const d = cv.toDataURL('image/jpeg', q); if (d.startsWith('data:image/jpeg;base64,') && d.length <= PHOTO_MAX_CHARS) return d; }
      edge = Math.round(edge * 0.8);
    }
    throw new Error('too big');
  } finally { URL.revokeObjectURL(url); }
}
// 사진 액자 걸기: 액자를 고르고 사진을 고른다
function pickPhoto(w: World, slot: number): void {
  const prices = w.config.prices;
  const body = el('div', { style: 'min-width:240px;max-width:380px;line-height:1.5;display:flex;flex-direction:column;gap:8px' });
  let frame = w.wallet.owns('frame2') && !w.wallet.owns('frame1') ? 2 : 1, data = '';
  const frames = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' });
  const prev = el('img', { style: 'max-width:100%;max-height:220px;display:none;border-radius:6px;align-self:center', alt: '고른 사진' });
  const file = el('input', { type: 'file', accept: 'image/*' });
  const drawFrames = (): void => {
    frames.innerHTML = '';
    for (const f of PHOTO_FRAMES) {
      const it = itemById(f.item), own = w.wallet.owns(f.item);
      const b = el('button', { class: 'btn small' + (frame === f.k ? ' primary' : ''), text: `${f.name} ${own ? '(보유)' : it ? fmtCoins(priceOf(it, prices)) : ''}` });
      b.onclick = () => { frame = f.k; drawFrames(); };
      frames.append(b);
    }
  };
  drawFrames();
  file.onchange = async () => {
    const f = file.files?.[0]; if (!f) return;
    try { data = await shrinkPhoto(f); prev.src = data; prev.style.display = ''; } catch { data = ''; prev.style.display = 'none'; w.toast('사진을 읽지 못했어요. 다른 사진으로 해 보세요.', true); }
  };
  body.append(el('div', { text: '액자' }), frames, el('div', { text: '사진' }), file, prev,
    el('div', { class: 'muted', style: 'font-size:12px', text: '사진은 올릴 때 작게 줄어들어요. 이 집에 들어온 사람 모두가 볼 수 있으니 남이 봐도 괜찮은 사진만 걸어 주세요. 문제가 있는 사진은 관리자가 내릴 수 있어요.' }));
  const m = modal(`🖼 ${slot + 1}번 자리에 걸 사진`, body, [
    { label: '걸기', primary: true, keep: true, onClick: async () => {
      if (!data) { w.toast('사진을 먼저 골라 주세요.', true); return; }
      const fr = PHOTO_FRAMES.find((x) => x.k === frame)!, it = itemById(fr.item);
      if (!w.wallet.owns(fr.item) && !(await confirmModal(`${fr.name}를 ${it ? fmtCoins(priceOf(it, prices)) : ''}에 살까요? 한 번 사면 다른 자리에도 쓸 수 있어요.`))) return;
      const r = await w.home.setPhoto(slot, frame, data);
      if (r === 'ok') { w.toast('🖼 사진을 걸었어요.'); m.close(); } else w.toast(r === 'coins' ? '코인이 모자랍니다.' : '걸지 못했습니다.', true);
    } },
    { label: '닫기', onClick: () => {} },
  ]);
}

// 박제할 물고기 고르기: 내 도감에서 전설·신화만
async function pickTrophy(w: World, slot: number): Promise<void> {
  let book: Record<string, FishBookEntry> = {};
  try { book = ((await get(ref(db, `fish/book/${w.uid}`))).val() as Record<string, FishBookEntry> | null) || {}; } catch { /* 못 읽으면 빈 목록 */ }
  const list = Object.entries(book).map(([id, e]) => ({ id, e, f: fishById(id) ?? winterFishById(id) })).filter((x) => x.f && !x.f.junk && x.f.rarity >= TROPHY_MIN_RARITY)
    .sort((a, b) => b.f!.rarity - a.f!.rarity || b.e.m - a.e.m);
  const body = el('div', { style: 'min-width:240px;max-width:380px;line-height:1.5;display:flex;flex-direction:column;gap:6px' });
  let close: (() => void) | null = null;
  if (!list.length) body.append(el('div', { text: '아직 전설·신화 물고기를 잡은 적이 없어요.' }));
  for (const x of list) {
    const b = el('button', { class: 'btn small', text: `${x.f!.icon} ${x.f!.name} · ${RARITY_NAME[x.f!.rarity]} · 최대 ${fmtSize(x.e.m)}` });
    b.onclick = async () => { b.disabled = true; if (await w.home.setTrophy(slot, x.id, x.e.m)) close?.(); else { w.toast('걸지 못했습니다.', true); b.disabled = false; } };
    body.append(b);
  }
  const m = modal(`🏆 ${slot + 1}번 자리에 걸 물고기`, body, [{ label: '닫기', onClick: () => {} }]);
  withCloseX(m);
  close = m.close;
}
