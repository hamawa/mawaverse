import { el } from '../shared/util';
import { modal, withCloseX, confirmModal } from './ui';
import { getSprite, FRAME_W, FRAME_H } from './sprites';
import { spriteTop, drawLabel } from './render';
import { drawHat, nameStyle, petCanvas, mountCanvas } from './cosmetics';
import {
  HATS, NAME_COLORS, FX, PET_GOODS, FISH_GOODS, PUSH_GOODS, GEAR_GOODS, ROD_GOODS, NET_GOODS, ARMOR_KEY, GIFT_MSG_MAX, priceOf, fmtCoins, autoItemMs, autoKindOf, type ShopItem, type CosmeticKind,
  PET_FOOD, PET_MAX_LEVEL, PET_RANGE_LEVEL, PET_GUARD_LEVEL, PET_SPEED_PER_LEVEL, PET_LEVEL_XP, petLevel, petNextXp, petScale, petCanRide, petGuard, foodPrice, foodCost, SCROLL, ROD_MAX_STARS, enhanceChance, starFactor,
  KING_ROD_ID, KING_CRAFT_GOLD, KING_ENHANCE_GOLD, KING_NEED_STARS, KING_BASE_STARS, KING_MAX_STARS, kingChance,
} from '../shared/shop';
import { fmtGold } from '../shared/mine';
import type { WalletMgr } from './wallet';
import type { UserProfile, ServerConfig } from '../shared/types';

export interface ShopHost {
  uid: string; profile: UserProfile; wallet: WalletMgr; config: ServerConfig; toast(msg: string, err?: boolean): void;
  onlineList?: () => { uid: string; nick: string }[];                 // 선물 받을 사람 고르기 (접속 중)
  lookupId?: (id: string) => Promise<{ uid: string; nick: string } | null>; // 아이디로 찾기
}

// 선물 받을 사람 고르기 (2026-11-09): 접속 중인 사람 목록 + 아이디 입력, 메시지(선택)
function giftPicker(h: ShopHost, item: ShopItem, price: number): Promise<{ to: { uid: string; nick: string }; msg: string } | null> {
  return new Promise((resolve) => {
    let picked: { uid: string; nick: string } | null = null;
    const body = el('div', { class: 'gift-pick' });
    body.append(el('p', { class: 'muted', text: `${item.icon} ${item.name} (${fmtCoins(price)})을(를) 누구에게 보낼까요? 상대가 이미 가진 것은 보낼 수 없어요.` }));
    const list = el('div', { class: 'gift-list' });
    const chosen = el('div', { class: 'muted', text: '받는 사람: (아직 안 골랐어요)' });
    const pick = (p: { uid: string; nick: string }) => { picked = p; chosen.textContent = `받는 사람: ${p.nick}`; [...list.children].forEach((c) => c.classList.toggle('on', (c as HTMLElement).dataset.uid === p.uid)); };
    const online = (h.onlineList?.() || []).filter((p) => p.uid !== h.uid);
    if (!online.length) list.append(el('span', { class: 'muted', text: '지금 접속 중인 사람이 없어요. 아래에 아이디를 넣어 보세요.' }));
    for (const p of online) { const b = el('button', { class: 'btn small', text: p.nick }); b.dataset.uid = p.uid; b.onclick = () => pick(p); list.append(b); }
    const idRow = el('div', { class: 'row', style: 'gap:6px;margin-top:6px' });
    const idIn = el('input', { type: 'text', placeholder: '아이디로 찾기', maxlength: '64' });
    const idBtn = el('button', { class: 'btn small', text: '찾기' });
    idBtn.onclick = async () => {
      const id = idIn.value.trim(); if (!id || !h.lookupId) return;
      idBtn.disabled = true;
      const p = await h.lookupId(id).catch(() => null);
      idBtn.disabled = false;
      if (!p) { h.toast('그 아이디를 찾지 못했어요.', true); return; }
      if (p.uid === h.uid) { h.toast('나에게는 보낼 수 없어요.', true); return; }
      if (!list.querySelector(`[data-uid="${p.uid}"]`)) { const b = el('button', { class: 'btn small', text: p.nick }); b.dataset.uid = p.uid; b.onclick = () => pick(p); list.append(b); }
      pick(p);
    };
    idIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); idBtn.click(); } };
    idRow.append(idIn, idBtn);
    const msgIn = el('input', { type: 'text', placeholder: `한마디 (선택, ${GIFT_MSG_MAX}자)`, maxlength: String(GIFT_MSG_MAX), style: 'margin-top:6px;width:100%' });
    body.append(list, idRow, chosen, msgIn);
    let done = false;
    const m = modal('🎁 선물하기', body, [
      { label: '취소', onClick: () => { done = true; resolve(null); } },
      { label: `${fmtCoins(price)} 보내기`, primary: true, keep: true, onClick: () => { if (!picked) { h.toast('받는 사람을 골라 주세요.', true); return; } done = true; m.close(); resolve({ to: picked, msg: msgIn.value.trim() }); } },
    ], false, () => { if (!done) resolve(null); });
  });
}

type Tab = 'hat' | 'name' | 'fx' | 'pet' | 'fish' | 'gear';
const TABS: { id: Tab; label: string }[] = [{ id: 'hat', label: '🎩 모자' }, { id: 'name', label: '🏷 이름표' }, { id: 'fx', label: '✨ 이펙트' }, { id: 'pet', label: '🐾 펫' }, { id: 'fish', label: '🎒 용품' }, { id: 'gear', label: '⚔ 장비' }];

// 펫 미리보기 (4배 × 레벨 크기). 탑승 레벨이면 탈것 옆모습(3배)
function petPreview(id: string, scale = 1, ride = false): HTMLElement {
  const src = ride ? mountCanvas(id, 'side') : petCanvas(id);
  const cv = document.createElement('canvas');
  cv.width = 120; cv.height = 84;
  if (src && ride) {
    const c = cv.getContext('2d')!; c.imageSmoothingEnabled = false;
    c.drawImage(src, 0, 0, src.width, src.height, Math.round((cv.width - src.width * 3) / 2), cv.height - src.height * 3 - 6, src.width * 3, src.height * 3);
  } else if (src) {
    const c = cv.getContext('2d')!; c.imageSmoothingEnabled = false;
    const fit = Math.min(scale, (cv.width - 4) / (src.width * 4), (cv.height - 4) / (src.height * 4));
    const w = Math.round(src.width * 4 * fit), h = Math.round(src.height * 4 * fit);
    c.drawImage(src, 0, 0, src.width, src.height, Math.round((cv.width - w) / 2), cv.height - h, w, h);
  }
  return cv;
}

// 내 아바타에 모자를 씌운 미리보기 (2배)
function hatPreview(avatar: string, hat: string | null): HTMLCanvasElement {
  const spr = getSprite(avatar, 0, 0, 'none');
  const cv = document.createElement('canvas');
  cv.width = FRAME_W * 2; cv.height = FRAME_H * 2;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.scale(2, 2);
  c.drawImage(spr, 0, 0);
  if (hat) drawHat(c, hat, 0, 0, spriteTop(spr), 0);
  return cv;
}
// 이름표 미리보기
function namePreview(nick: string, nc: string | null): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 140; cv.height = 26;
  const c = cv.getContext('2d')!;
  const st = nameStyle(nc);
  drawLabel(c, nick, 70, 24, st ? st.color : '#ffe9a8', st ? st.bg : 'rgba(0,0,0,0.55)', 12, st?.border);
  return cv;
}

export function openShop(h: ShopHost): void {
  const body = el('div', { class: 'shop' });
  const m = modal('🛍 상점', body, [], true);
  m.root.querySelector('.actions')?.remove();
  withCloseX(m);
  const head = el('div', { class: 'shop-head' });
  const tabs = el('div', { class: 'tabs' });
  const pane = el('div', { class: 'shop-pane' });
  body.append(head, tabs, pane);
  let tab: Tab = 'hat';
  const tabBtns = new Map<Tab, HTMLButtonElement>();
  for (const t of TABS) {
    const b = el('button', { text: t.label });
    b.onclick = () => { tab = t.id; render(); };
    tabBtns.set(t.id, b); tabs.append(b);
  }
  const prices = h.config.prices;

  // 🎁 선물 버튼: 보관함 품목(모자·이름표·이펙트·장비·낚싯대·잠자리채)은 남에게 사 줄 수 있다 (2026-11-09)
  const giftBtn = (item: ShopItem, price: number) => {
    const b = el('button', { class: 'btn small', text: '🎁', title: `${item.name} 선물하기 (${fmtCoins(price)})` });
    if (h.wallet.balance < price) { b.disabled = true; b.title = '코인이 모자랍니다'; }
    b.onclick = async () => {
      b.disabled = true;
      try {
        const pick = await giftPicker(h, item, price);
        if (!pick) { b.disabled = false; return; }
        const r = await h.wallet.giftItem(item.id, price, pick.to, pick.msg);
        if (r === 'ok') h.toast(`🎁 ${pick.to.nick} 님에게 ${item.name}을(를) 선물했어요!`);
        else if (r === 'owned') h.toast(`${pick.to.nick} 님은 이미 ${item.name}을(를) 가지고 있어요.`, true);
        else if (r === 'coins') h.toast('코인이 모자랍니다.', true);
        else h.toast('선물을 전달하지 못했어요. 다음 접속 때 다시 전달됩니다.', true);
      } catch { h.toast('처리하지 못했습니다.', true); }
      render();
    };
    return b;
  };

  const cosmeticCard = (item: ShopItem, kind: CosmeticKind) => {
    const price = priceOf(item, prices);
    const owned = h.wallet.owns(item.id);
    const eq = h.wallet.equipped(kind) === item.id;
    const card = el('div', { class: 'shop-card' + (eq ? ' eq' : '') });
    const xp = kind === 'pet' ? h.wallet.petXp(item.id) : 0;
    if (kind === 'hat') card.append(hatPreview(h.profile.avatar, item.id));
    else if (kind === 'name') card.append(namePreview(h.profile.nick, item.id));
    else if (kind === 'pet') card.append(petPreview(item.id, petScale(xp), petCanRide(xp)));
    else card.append(el('div', { class: 'ic', text: item.icon }));
    const lv = petLevel(xp);
    card.append(el('div', { class: 'nm', text: kind === 'pet' ? `${item.name} Lv.${lv}${petCanRide(xp) ? ' 🏇' : ''}` : item.name }));
    if (kind === 'pet') {
      // 레벨·경험치 바·먹이 주기 (2026-11-10). 먹이는 데리고 있는 펫에게만 (한 번에 1·10개)
      const next = petNextXp(xp);
      const bar = el('div', { class: 'pet-xp' });
      const prev = PET_LEVEL_XP[lv - 1] || 0;
      bar.append(el('div', { class: 'fill', style: `width:${next ? Math.round(((xp - prev) / (next - prev)) * 100) : 100}%` }));
      card.append(bar, el('div', { class: 'ds', text: next ? `먹이 ${xp}/${next}개 → Lv.${lv + 1}` : `최고 레벨 · 타고 다니는 중` }));
      // 효과는 펫 종류와 상관없이 같다 (2026-11-10 밤)
      card.append(el('div', { class: 'ds', text: `걷기 +${Math.round(PET_SPEED_PER_LEVEL * lv * 100)}% (레벨마다 +${PET_SPEED_PER_LEVEL * 100}%)` }));
      card.append(el('div', { class: 'ds', text: `${lv >= PET_RANGE_LEVEL ? '✅' : `Lv${PET_RANGE_LEVEL}`} 채집 2칸 · 달려도 벌레 안 도망` }));
      card.append(el('div', { class: 'ds', text: `${petGuard(xp) ? '✅' : `Lv${PET_GUARD_LEVEL}`} 채집 3칸 · 밀치기·말랑이·끌기 100% 막고 80% 되받아침` }));
      card.append(el('div', { class: 'ds', text: `${petCanRide(xp) ? '✅' : `Lv${PET_MAX_LEVEL}`} 타고 다니기` }));
      if (owned && eq && next) {
        // 먹이 주기 칸: 카드 폭(150px)에 가로로 안 들어가서 위아래로 쌓는다. 가격은 먹인 수에 따라 오르므로 지금 값을 보여 준다 (2026-11-10)
        const fp = priceOf(PET_FOOD, prices);
        const feedBox = el('div', { class: 'pet-feed' });
        feedBox.append(el('div', { class: 'ds', text: `${PET_FOOD.icon} 먹이 주기 · 다음 ${fmtCoins(foodPrice(fp, xp))}` }));
        for (const n of [1, 10]) {
          const cost = foodCost(fp, xp, n);
          const b = el('button', { class: 'btn small' + (n === 1 ? ' primary' : ''), text: `${n}개 ${fmtCoins(cost)}`, title: `먹이 ${n}개 주기` });
          if (h.wallet.balance < cost) { b.disabled = true; b.title = '코인이 모자랍니다'; }
          b.onclick = async () => {
            b.disabled = true;
            const before = petLevel(h.wallet.petXp(item.id));
            const ok = await h.wallet.feedPet(item.id, fp, n);
            if (!ok) h.toast('코인이 모자랍니다.', true);
            else { const after = petLevel(h.wallet.petXp(item.id)); if (after > before) h.toast(`${item.icon} ${item.name} Lv.${after}! 몸집이 커졌다.${petCanRide(h.wallet.petXp(item.id)) ? ' 이제 타고 다닙니다!' : ''}`); }
            render(`[data-pet="${item.id}"][data-feed="${n}"]`); // 연타할 수 있게 같은 자리의 새 버튼에 포커스를 돌려준다
          };
          b.dataset.pet = item.id; b.dataset.feed = String(n);
          feedBox.append(b);
        }
        card.append(feedBox);
      } else if (owned && !eq && next) card.append(el('div', { class: 'ds muted', text: '먹이는 데리고 있을 때 줄 수 있어요' }));
    } else if (item.desc) card.append(el('div', { class: 'ds', text: item.desc }));
    const pet = kind === 'pet';
    card.append(el('div', { class: 'pr', text: owned ? (eq ? (pet ? '데리고 있음' : '착용 중') : '보유') : fmtCoins(price) }));
    const btn = el('button', { class: 'btn small' + (owned ? '' : ' primary'), text: owned ? (eq ? (pet ? '집에 두기' : '해제') : (pet ? '데리고 다니기' : '착용')) : '구매' });
    if (!owned && h.wallet.balance < price) { btn.disabled = true; btn.title = '코인이 모자랍니다'; }
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (!owned) {
          if (!(await confirmModal(`${item.name}을(를) ${fmtCoins(price)}에 살까요?`))) { btn.disabled = false; return; }
          if (!(await h.wallet.buyCosmetic(item.id, price))) { h.toast('코인이 모자랍니다.', true); btn.disabled = false; return; }
          await h.wallet.equip(kind, item.id);
          h.toast(pet ? `${item.icon} ${item.name} 입양! 바로 따라옵니다.` : `${item.icon} ${item.name} 구매! 바로 착용했습니다.`);
        } else await h.wallet.equip(kind, eq ? null : item.id);
      } catch { h.toast('처리하지 못했습니다.', true); }
      render();
    };
    card.append(el('div', { class: 'row', style: 'gap:4px;justify-content:center' }, [btn, giftBtn(item, price)]));
    return card;
  };

  // 🎒 용품: 자동 낚시 · 자동 채집 · 미끼 (자동 아이템 하루 개수 제한은 2026-11-05 에 없앴다)
  const fishPane = () => {
    const box = el('div', { class: 'shop-goods' });
    const bait = FISH_GOODS.find((i) => i.id === 'bait')!;
    // 자동 버프 한 줄: 남은 시간 + 10분·30분·1시간 구매 버튼. 켜져 있으면 이어 붙고, 남은 시간 포함 1시간을 넘기는 건 못 산다 (2026-11-09)
    const autoRow = (kind: 'fish' | 'bug', active: boolean, leftText: string, what: string, hint: string) => {
      const items = FISH_GOODS.filter((i) => autoKindOf(i.id) === kind);
      const first = items[0];
      const row = el('div', { class: 'shop-good' });
      const desc = `${first.desc.replace(/^[^ ]+ 동안 /, '')} ${active ? `지금 켜져 있음 · 남은 ${leftText}` : ''}`;
      row.append(el('div', { class: 'ic', text: first.icon }), el('div', { class: 'txt' }, [el('div', { class: 'nm', text: `${what}${active ? ` · 남은 ${leftText}` : ''}` }), el('div', { class: 'ds', text: desc })]));
      const btns = el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;justify-content:flex-end' });
      const room = h.wallet.autoRoom(kind);
      for (const it of items) {
        const price = priceOf(it, prices), ms = autoItemMs(it.id) || 0;
        const label = it.name.replace(/^자동 (낚시|채집) /, '');
        const b = el('button', { class: 'btn small' + (it === first ? ' primary' : ''), text: `${label} ${fmtCoins(price)}` });
        if (h.wallet.balance < price) { b.disabled = true; b.title = '코인이 모자랍니다'; }
        else if (ms > room + 1000) { b.disabled = true; b.title = '남은 시간을 더하면 1시간을 넘어요'; }
        b.onclick = async () => {
          b.disabled = true;
          if (!(await confirmModal(`${fmtCoins(price)}로 ${what} ${label}을(를) ${active ? '이어 붙일까요?' : '켤까요?'} ${hint}`))) { b.disabled = false; return; }
          const r = await h.wallet.buyAuto(it.id, price);
          if (r === 'ok') h.toast(`${first.icon} ${what} ${label} ${active ? '연장!' : '시작!'} ${hint}`);
          else if (r === 'full') h.toast('남은 시간을 더하면 1시간을 넘어 살 수 없어요.', true);
          else h.toast('코인이 모자랍니다.', true);
          render();
        };
        btns.append(b);
      }
      row.append(btns);
      return row;
    };
    const aRow = autoRow('fish', h.wallet.autoReelActive(), h.wallet.autoReelLeftText(), '자동 낚시', '물가에 서 있으면 알아서 던지고 거둡니다.');
    const gRow = autoRow('bug', h.wallet.autoBugActive(), h.wallet.autoBugLeftText(), '자동 채집', '풀밭을 걸어 다니면 옆에 온 벌레를 알아서 잡습니다.');
    // 미끼
    const bPrice = priceOf(bait, prices);
    const bRow = el('div', { class: 'shop-good' });
    bRow.append(el('div', { class: 'ic', text: bait.icon }), el('div', { class: 'txt' }, [el('div', { class: 'nm', text: `${bait.name} · 보유 ${h.wallet.bait}개` }), el('div', { class: 'ds', text: bait.desc })]));
    const bBtns = el('div', { class: 'row', style: 'gap:6px' });
    for (const n of [5, 20, 50]) {
      const b = el('button', { class: 'btn small' + (n === 5 ? ' primary' : ''), text: `${n}개 ${fmtCoins(bPrice * n)}` });
      if (h.wallet.balance < bPrice * n) b.disabled = true;
      b.onclick = async () => { b.disabled = true; if (await h.wallet.buyBait(bPrice, n)) h.toast(`🐛 미끼 ${n}개 구매`); else h.toast('코인이 모자랍니다.', true); render(); };
      bBtns.append(b);
    }
    bRow.append(bBtns);
    const use = el('label', { class: 'shop-toggle' });
    const cb = el('input', { type: 'checkbox' }); cb.checked = h.wallet.baitOn;
    cb.onchange = () => { void h.wallet.setBaitUse(cb.checked); };
    use.append(cb, ' 미끼가 있으면 던질 때 자동으로 쓰기');
    box.append(aRow, gRow, bRow, use);
    return box;
  };

  // ⚔ 장비: 밀치기 업그레이드 2단 + 만 코인 장비 4종 (모두 영구). 갑옷은 입고 벗을 수 있다
  const gearPane = () => {
    const box = el('div', { class: 'shop-goods' });
    const gearRow = (it: ShopItem, afterBuy: string, needs?: string) => {
      const price = priceOf(it, prices);
      const owned = h.wallet.owns(it.id);
      const armor = ARMOR_KEY[it.id];
      const on = armor ? h.wallet.armorOn(armor) : false;
      const state = !owned ? '' : armor ? (on ? ' · 입는 중' : ' · 벗음') : ' · 보유 중';
      const row = el('div', { class: 'shop-good' });
      row.append(el('div', { class: 'ic', text: it.icon }), el('div', { class: 'txt' }, [el('div', { class: 'nm', text: it.name + state }), el('div', { class: 'ds', text: it.desc })]));
      const b = el('button', { class: 'btn small' + (owned ? '' : ' primary'), text: owned ? (armor ? (on ? '벗기' : '입기') : '보유 중') : `구매 ${fmtCoins(price)}` });
      if (owned ? !armor : (!!needs || h.wallet.balance < price)) b.disabled = true;
      if (needs && !owned) b.title = needs;
      b.onclick = async () => {
        b.disabled = true;
        try {
          if (owned && armor) await h.wallet.setArmor(armor, !on);
          else if (!owned) {
            if (!(await confirmModal(`${it.name}을(를) ${fmtCoins(price)}에 살까요? 영구 적용됩니다.`))) { b.disabled = false; return; }
            if (!(await h.wallet.buyCosmetic(it.id, price))) { h.toast('코인이 모자랍니다.', true); b.disabled = false; return; }
            if (armor) await h.wallet.setArmor(armor, true);
            h.toast(`${it.icon} ${it.name}! ${afterBuy}`);
          }
        } catch { h.toast('처리하지 못했습니다.', true); }
        render();
      };
      row.append(el('div', { class: 'row', style: 'gap:4px' }, [b, giftBtn(it, price)]));
      return row;
    };
    box.append(el('h4', { style: 'margin:0', text: '🎣 낚싯대 · 🥅 잠자리채' }));
    box.append(gearRow(ROD_GOODS[0], '희귀 이상이 더 잘 뭅니다.'));
    box.append(gearRow(ROD_GOODS[1], '최고의 낚싯대! 희귀 이상 2.5배.', !h.wallet.owns('rod1') ? '좋은 낚싯대를 먼저 사야 합니다' : undefined));
    // 낚싯대 강화 (2026-11-10): 명품 낚싯대가 있을 때만. 주문서 구매 + 강화 버튼
    if (h.wallet.owns('rod2')) {
      const stars = h.wallet.stars, scrolls = h.wallet.scrolls, sp = priceOf(SCROLL, prices);
      const row = el('div', { class: 'shop-good enh' });
      const chance = stars >= ROD_MAX_STARS ? 0 : enhanceChance(stars);
      const f = starFactor(stars);
      const effect = `희귀 ×${f.toFixed(2)} · 영웅 ×${(f * f).toFixed(2)} · 전설 ×${(f * f * f).toFixed(2)}`;
      row.append(el('div', { class: 'ic', text: '📜' }), el('div', { class: 'txt' }, [
        el('div', { class: 'nm', text: `명품 낚싯대 ★${stars}${stars >= ROD_MAX_STARS ? ' (최고)' : ''} · 주문서 ${scrolls}장` }),
        el('div', { class: 'ds', text: `${stars >= ROD_MAX_STARS ? '더 강화할 수 없습니다.' : `다음 강화 성공 ${Math.round(chance * 100)}%, 실패하면 명품 낚싯대가 부서져 좋은 낚싯대로 돌아갑니다(성 0).`} 지금 효과: ${effect}` }),
      ]));
      const btns = el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;justify-content:flex-end' });
      for (const n of [1, 10]) {
        const b = el('button', { class: 'btn small', text: `주문서 ${n}장 ${fmtCoins(sp * n)}` });
        if (h.wallet.balance < sp * n) { b.disabled = true; b.title = '코인이 모자랍니다'; }
        b.onclick = async () => { b.disabled = true; if (await h.wallet.buyScrolls(sp, n)) h.toast(`📜 강화 주문서 ${n}장 구매`); else h.toast('코인이 모자랍니다.', true); render(); };
        btns.append(b);
      }
      const go = el('button', { class: 'btn small primary', text: stars >= ROD_MAX_STARS ? '최고 강화' : `강화 (${Math.round(chance * 100)}%)` });
      if (scrolls <= 0 || stars >= ROD_MAX_STARS) { go.disabled = true; go.title = scrolls <= 0 ? '주문서가 없습니다' : ''; }
      go.onclick = async () => {
        go.disabled = true;
        if (chance < 1 && !(await confirmModal(`★${stars} → ★${stars + 1} 강화에 도전할까요? 성공 ${Math.round(chance * 100)}%. 실패하면 명품 낚싯대(15,000)가 부서져 좋은 낚싯대로 돌아가고 성은 0 이 됩니다.`))) { go.disabled = false; return; }
        const r = await h.wallet.enhanceRod();
        if (r === 'ok') h.toast(`✨ 강화 성공! 명품 낚싯대 ★${stars + 1}`);
        else if (r === 'broke') { await h.wallet.breakRod(); h.toast(`💥 강화 실패… 명품 낚싯대가 부서졌다. 좋은 낚싯대로 돌아갑니다. (★${stars} 소멸)`, true); }
        else h.toast('강화하지 못했습니다. (주문서 없음)', true);
        render();
      };
      btns.append(go);
      row.append(btns);
      box.append(row);
    }
    // 킹 낚싯대 (2026-11-11): 명품 30성이 있어야 금덩이 + 코인으로 만든다. 만든 뒤에는 주문서 1장 + 금덩이 1개로 강화하고, 실패하면 부서져 다시 만들어야 한다. 선물 버튼은 없다
    if (h.wallet.owns('rod2')) {
      const king = ROD_GOODS[2], kp = priceOf(king, prices);
      const gold = h.wallet.gold, scrolls = h.wallet.scrolls, sp = priceOf(SCROLL, prices);
      const row = el('div', { class: 'shop-good enh' });
      const btns = el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;justify-content:flex-end' });
      if (!h.wallet.owns(KING_ROD_ID)) {
        const rs = h.wallet.stars;
        const missing = rs < KING_NEED_STARS ? `명품 낚싯대 ★${KING_NEED_STARS} 이 필요합니다 (지금 ★${rs})` : gold < KING_CRAFT_GOLD ? `금덩이가 모자랍니다 (${gold}/${KING_CRAFT_GOLD}). 포탈로 금광에 가서 캐세요` : h.wallet.balance < kp ? '코인이 모자랍니다' : '';
        row.append(el('div', { class: 'ic', text: king.icon }), el('div', { class: 'txt' }, [
          el('div', { class: 'nm', text: `${king.name} · ${fmtGold(gold)}` }),
          el('div', { class: 'ds', text: `${king.desc} 제작: 명품 ★${KING_NEED_STARS}${rs >= KING_NEED_STARS ? ' ✅' : ` (지금 ★${rs})`} · 금덩이 ${KING_CRAFT_GOLD}개${gold >= KING_CRAFT_GOLD ? ' ✅' : ` (보유 ${gold})`} · ${fmtCoins(kp)}. 명품 낚싯대와 30성은 그대로 남는다.` }),
        ]));
        const make = el('button', { class: 'btn small primary', text: `제작 ${fmtCoins(kp)} + 🟡${KING_CRAFT_GOLD}` });
        if (missing) { make.disabled = true; make.title = missing; }
        make.onclick = async () => {
          make.disabled = true;
          if (!(await confirmModal(`${king.name}를 만들까요? ${fmtCoins(kp)}과 금덩이 ${KING_CRAFT_GOLD}개가 듭니다. 강화에 실패해 부서지면 다시 만들어야 합니다.`))) { make.disabled = false; return; }
          const r = await h.wallet.craftKing(kp);
          if (r === 'ok') h.toast(`👑 ${king.name} 완성! 이제 가끔 킹 사이즈가 낚입니다.`);
          else h.toast(r === 'need' ? `명품 낚싯대 ★${KING_NEED_STARS} 이 필요합니다.` : r === 'gold' ? '금덩이가 모자랍니다.' : r === 'coins' ? '코인이 모자랍니다.' : '만들지 못했습니다. 잠시 후 다시 시도하세요.', true);
          render();
        };
        btns.append(make);
      } else {
        const ks = h.wallet.kingStars;
        const chance = ks >= KING_MAX_STARS ? 0 : enhanceChance(ks);
        const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
        row.append(el('div', { class: 'ic', text: king.icon }), el('div', { class: 'txt' }, [
          el('div', { class: 'nm', text: `${king.name} ★${ks}${ks >= KING_MAX_STARS ? ' (최고)' : ''} · 주문서 ${scrolls}장 · ${fmtGold(gold)}` }),
          el('div', { class: 'ds', text: `${ks >= KING_MAX_STARS ? '더 강화할 수 없습니다.' : `강화 1회에 주문서 1장 + 금덩이 ${KING_ENHANCE_GOLD}개. 다음 강화 성공 ${Math.round(chance * 100)}%, 실패하면 ${king.name}가 부서져 명품 ★${KING_NEED_STARS} 으로 돌아갑니다(다시 제작).`} 지금 킹 사이즈 확률 ${pct(kingChance(ks))}${ks < KING_MAX_STARS ? ` → 다음 ${pct(kingChance(ks + 1))}` : ''}. 낚시 확률은 명품 ★${KING_BASE_STARS} 과 같다(고정).` }),
        ]));
        for (const n of [1, 10]) {
          const b = el('button', { class: 'btn small', text: `주문서 ${n}장 ${fmtCoins(sp * n)}` });
          if (h.wallet.balance < sp * n) { b.disabled = true; b.title = '코인이 모자랍니다'; }
          b.onclick = async () => { b.disabled = true; if (await h.wallet.buyScrolls(sp, n)) h.toast(`📜 강화 주문서 ${n}장 구매`); else h.toast('코인이 모자랍니다.', true); render(); };
          btns.append(b);
        }
        const go = el('button', { class: 'btn small primary', text: ks >= KING_MAX_STARS ? '최고 강화' : `강화 (${Math.round(chance * 100)}%)` });
        go.dataset.king = 'go';
        if (scrolls <= 0 || gold < KING_ENHANCE_GOLD || ks >= KING_MAX_STARS) { go.disabled = true; go.title = scrolls <= 0 ? '주문서가 없습니다' : gold < KING_ENHANCE_GOLD ? '금덩이가 없습니다' : ''; }
        go.onclick = async () => {
          go.disabled = true;
          if (chance < 1 && !(await confirmModal(`★${ks} → ★${ks + 1} 강화에 도전할까요? 성공 ${Math.round(chance * 100)}%. 실패하면 ${king.name}가 부서져 명품 ★${KING_NEED_STARS} 으로 돌아가고, 다시 만들려면 ${fmtCoins(kp)}과 금덩이 ${KING_CRAFT_GOLD}개가 듭니다.`))) { go.disabled = false; return; }
          const r = await h.wallet.enhanceKing();
          if (r === 'ok') h.toast(`✨ 강화 성공! ${king.name} ★${ks + 1}`);
          else if (r === 'broke') { await h.wallet.breakKing(); h.toast(`💥 강화 실패… ${king.name}가 부서졌다. 명품 ★${KING_NEED_STARS} 으로 돌아갑니다. (★${ks} 소멸)`, true); }
          else h.toast('강화하지 못했습니다. (주문서나 금덩이가 없음)', true);
          render('[data-king="go"]');
        };
        btns.append(go);
      }
      row.append(btns);
      box.append(row);
    }
    box.append(gearRow(NET_GOODS[0], '채집 실패가 절반으로 줄었습니다.'));
    box.append(gearRow(NET_GOODS[1], '이제 휘두르면 무조건 잡습니다.', !h.wallet.owns('net1') ? '튼튼한 잠자리채를 먼저 사야 합니다' : undefined));
    box.append(el('h4', { style: 'margin:10px 0 0', text: '👊 밀치기' }));
    for (const it of PUSH_GOODS) box.append(gearRow(it, '밀치기 쿨타임이 줄었습니다.', it.id === 'push2' && !h.wallet.owns('push1') ? '날쌘 손을 먼저 사야 합니다' : undefined));
    box.append(el('h4', { style: 'margin:10px 0 0', text: '🏅 고급 장비' }));
    const after: Record<string, string> = { wave: '이제 밀치기(0)가 앞 4×4칸의 모두를 두 칸 밀어냅니다.', tossbag: '앞 4×4칸 모두에게 던집니다.', pusharmor: '바로 입었습니다. 밀치기가 안 먹힙니다.', tossarmor: '바로 입었습니다. 말랑이가 안 먹힙니다.', hook: '이제 끌기(R)로 앞 4×4칸 안의 한 명을 끌어옵니다.' };
    for (const it of GEAR_GOODS) box.append(gearRow(it, after[it.id] || ''));
    return box;
  };

  // 다시 그릴 때 스크롤(격자·모달 본문)을 그대로 두고, focusSel 이 있으면 그 버튼에 포커스를 준다 (먹이 연타: 2026-11-10 전에는 살 때마다 맨 위로 튀었다)
  let lastTab: Tab | null = null;
  const render = (focusSel?: string) => {
    const oldGrid = pane.querySelector<HTMLElement>('.shop-grid');
    const scrollers = [oldGrid, pane, body, m.root].filter((x): x is HTMLElement => !!x && x.scrollTop > 0).map((x) => [x === oldGrid ? 'grid' : x, x.scrollTop] as const);
    head.innerHTML = '';
    head.append(el('span', { text: `잔액 ${fmtCoins(h.wallet.balance)}${h.wallet.gold > 0 ? ` · ${fmtGold(h.wallet.gold)}` : ''}` }), el('span', { class: 'muted', text: `누적 ${fmtCoins(h.wallet.wallet.e || 0)} · 낚시·게임 점수 1점 = 1코인` }));
    tabBtns.forEach((b, id) => b.classList.toggle('active', id === tab));
    pane.innerHTML = '';
    if (tab === 'fish') pane.append(fishPane());
    else if (tab === 'gear') pane.append(gearPane());
    else {
      const grid = el('div', { class: 'shop-grid' + (tab === 'pet' ? ' pets' : '') });
      const list = tab === 'hat' ? HATS : tab === 'name' ? NAME_COLORS : tab === 'pet' ? PET_GOODS : FX;
      for (const item of list) grid.append(cosmeticCard(item, tab));
      pane.append(grid);
    }
    if (lastTab === tab) for (const [k, top] of scrollers) { const t = k === 'grid' ? pane.querySelector<HTMLElement>('.shop-grid') : k; if (t) t.scrollTop = top; }
    lastTab = tab;
    if (focusSel) pane.querySelector<HTMLElement>(focusSel)?.focus({ preventScroll: true });
  };
  // 지갑이 바뀌면(획득·구매) 다시 그린다. 모달이 닫히면 구독 해제
  const off = h.wallet.listen(render);
  const origClose = m.close;
  m.close = () => { off(); origClose(); };
  render();
}
