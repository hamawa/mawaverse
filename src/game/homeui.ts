import { el } from '../shared/util';
import { modal, withCloseX, confirmModal } from './ui';
import { BUNDLES, SLOT_FISH, SHIELD_FISH, SHIELD_MAX, SLEEP_MS, CHOP_SWINGS, HOME_MAX_TIER, homeTier, nextTier, extraSlotsOf, slotItem, fmtWood } from '../shared/home';
import { itemById, priceOf, fmtCoins } from '../shared/shop';
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
    body.append(line(`나무는 어느 맵이든 나무를 보고 F (한 번에 ${CHOP_SWINGS}번 휘두르고 1~2개씩 나와요).`, true));

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
  };
  const offs = [h.listen(render), w.wallet.listen(render)];
  render();
  const m = modal('🏠 내 집', body, [{ label: '닫기', onClick: () => {} }], false, () => { offs.forEach((f) => f()); opened = null; closeModal = null; });
  withCloseX(m);
  opened = m; closeModal = m.close;
}
