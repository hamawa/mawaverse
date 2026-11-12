// Firebase 없이 그래픽/이동/렌더링을 확인하는 개발용 미리보기 페이지
import '../styles.css';
import { Engine } from '../game/engine';
import { Input } from '../game/input';
import { render, poseForEmote, type Entity, type RenderState } from '../game/render';
import { buildDefaultMap, buildPortalGarden, buildGoldMine, buildWinterMap, isWalkable, isWater, isFishable, roomAt, portalNear, portalDests, labelAt, type MapData } from '../game/map';
import { MAIN_MAP_ID, GARDEN_MAP_ID, GOLD_MINE_MAP_ID, WINTER_MAP_ID } from '../shared/maps';
import { destView, MAP_INFO } from '../game/portal';
import { WinterPlay } from '../game/winterplay';
import { snowActive } from '../shared/snowpenalty';
import { SnowfightState, snowGateAt, snowfightAction, planSnowThrow, snowStillThere, SNOW_PACK_HINT, SNOW_THROW_HINT } from '../game/snowfight';
import { SKI_GLOVES_EQ } from '../shared/shop';
import type { TossView } from '../game/toss';
import { openPortalPicker } from '../game/portalui';
import { PRESETS, getSprite, GROUP_NAMES } from '../game/sprites';
import { TILE, STEP_MS, EMOTES } from '../shared/config';
import type { Dir } from '../shared/types';
import { el } from '../shared/util';

const app = document.getElementById('app')!;
app.style.overflow = 'auto';
app.style.position = 'static';
document.body.style.overflow = 'auto';

const mode = location.hash === '#gallery' ? 'gallery' : 'play';
const locBadge = el('span', { style: 'font-weight:bold;color:#38bdf8;margin-left:8px', text: '📍 위치: 중앙 광장 (기본 맵)' });
const nav = el('div', { style: 'padding:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
  el('a', { href: '#play', text: '플레이그라운드' }), el('span', { text: ' | ' }), el('a', { href: '#gallery', text: '캐릭터 갤러리 (150)' }),
  el('span', { class: 'muted', text: '  방향키 이동, F 상호작용/포탈 이동, J 정원, K 금광, I 겨울 (그래픽 미리보기)' }),
  locBadge,
]);
app.append(nav);
window.addEventListener('hashchange', () => location.reload());

if (mode === 'gallery') {
  for (const g of ['m', 'f', 'x'] as const) {
    app.append(el('h3', { text: GROUP_NAMES[g], style: 'padding:0 8px;margin:8px 0' }));
    const grid = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;padding:0 8px' });
    for (const p of PRESETS.filter((x) => x.group === g)) {
      const cv = document.createElement('canvas');
      cv.width = 24 * 4; cv.height = 36;
      cv.style.width = `${24 * 4 * 2}px`; cv.style.height = '72px'; cv.style.imageRendering = 'pixelated';
      const box = el('div', { style: 'display:flex;flex-direction:column;align-items:center;background:#0d1510;border-radius:8px;padding:4px' }, [cv, el('span', { class: 'muted', text: `${p.id} ${p.name}` })]);
      grid.append(box);
      const ctx = cv.getContext('2d')!;
      const draw = (frame: number) => {
        ctx.clearRect(0, 0, cv.width, cv.height);
        ([0, 1, 2, 3] as Dir[]).forEach((d, i) => ctx.drawImage(getSprite(p.id, d, frame), i * 24, 0));
      };
      draw(0);
      let f = 0;
      setInterval(() => { f = (f + 1) & 3; draw(f); }, 180);
    }
    app.append(grid);
  }
  // 포즈 샘플
  app.append(el('h3', { text: '포즈 샘플 (m01, f01, x01)', style: 'padding:0 8px' }));
  const poses = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;padding:0 8px' });
  for (const id of ['m01', 'f01', 'x01', 'x12', 'x14']) for (const e of EMOTES) {
    const cv = document.createElement('canvas'); cv.width = 24; cv.height = 36; cv.style.width = '72px'; cv.style.height = '108px'; cv.style.imageRendering = 'pixelated';
    cv.getContext('2d')!.drawImage(getSprite(id, 0, 0, poseForEmote(e.id)), 0, 0);
    poses.append(el('div', { style: 'display:flex;flex-direction:column;align-items:center' }, [cv, el('span', { class: 'muted', text: e.name })]));
  }
  app.append(poses);
} else {
  const wrap = el('div', { id: 'game', style: 'position:relative;width:100%;height:calc(100vh - 44px)' });
  const canvas = document.createElement('canvas');
  wrap.append(canvas);
  app.append(wrap);
  const eng = new Engine(canvas);
  const input = new Input();

  const maps: Record<string, MapData> = {
    [MAIN_MAP_ID]: buildDefaultMap(),
    [GARDEN_MAP_ID]: buildPortalGarden(),
    [GOLD_MINE_MAP_ID]: buildGoldMine(),
    [WINTER_MAP_ID]: buildWinterMap(),
  };
  const requestedMap = new URLSearchParams(location.search).get('map');
  let currentMapId: string = requestedMap && Object.hasOwn(maps, requestedMap) ? requestedMap : MAIN_MAP_ID;
  let map: MapData = maps[currentMapId];

  const me: Entity = {
    uid: 'me', nick: '테스터', avatar: 'f03', x: map.spawn.x, y: map.spawn.y, dir: 0, moving: false, moveT: 0, pose: 'none', poseAt: 0, emoteId: 0,
    bubble: null, isMe: true, pushAt: -1, pushDir: 0, hitAt: -1e9, blockAt: -1e9, fishing: null, hat: null, nameColor: null, fx: null,
    pet: { id: 'petdog', x: map.spawn.x, y: map.spawn.y + 1, moving: false, moveT: 0, hopAt: -1e9, dir: 0, scale: 1.3, ride: false }, // 미리보기: 강아지 Lv5 크기
  };
  const others: Entity[] = [];
  const names = ['철수', '영희', '민수', '지은', '고양이씨'];
  for (let i = 0; i < 5; i++) others.push({ ...me, uid: 'o' + i, nick: names[i], avatar: PRESETS[(i * 37) % 150].id, x: map.spawn.x - 4 + i * 2, y: map.spawn.y - 3, isMe: false, bubble: i === 1 ? { text: '안녕하세요! 커피 내기 하실 분?', kind: 'near', at: performance.now() + 1e9 } : i === 2 ? { text: '전체 채팅 테스트입니다', kind: 'all', at: performance.now() + 1e9 } : i === 3 ? { text: '귓속말이에요', kind: 'w', at: performance.now() + 1e9 } : i === 4 ? { text: '오늘 날씨 좋다', kind: 'near', at: performance.now() + 1e9 } : null });
  // 겨울 맵의 방어 더미: 가만히 서 있는 가짜 접속자 (스키 장갑 눈싸움 미리보기용). 눈덩이가 맞으면 방어(🛡)와 상관없이 스턴 표시가 뜬다
  const dummies: Entity[] = [
    { ...me, uid: 'd0', nick: '🛡 방어 더미 (갑옷·펫 방어 중)', avatar: PRESETS[10].id, x: 20, y: 16, isMe: false, bubble: null, pet: null },
    { ...me, uid: 'd1', nick: '🛡 방어 더미 2', avatar: PRESETS[60].id, x: 24, y: 19, isMe: false, bubble: null, pet: null },
  ];
  let from = { x: me.x, y: me.y }, to = { x: me.x, y: me.y }, moveStart = 0;
  const occupied = (x: number, y: number) => (currentMapId === MAIN_MAP_ID ? others : currentMapId === WINTER_MAP_ID ? dummies : []).some((o) => Math.round(o.x) === x && Math.round(o.y) === y);
  // 겨울 맵의 빙판 관성·눈덩이: 실제 게임(world.ts)과 같은 순수 로직(winterplay.ts)을 쓴다. 눈덩이는 이 화면에만 있는 장난감이고, 맵을 옮기면 새로 놓는다
  const winterBlocked = (x: number, y: number) => (to.x === x && to.y === y) || (me.moving && from.x === x && from.y === y) || occupied(x, y);
  let winter = new WinterPlay(map, winterBlocked);
  const resetWinter = () => { winter = new WinterPlay(map, winterBlocked); };
  const canStep = (nx: number, ny: number) => isWalkable(map, nx, ny) && !occupied(nx, ny) && !winter.stepBlocked(to.x, to.y, nx, ny, winterBlocked);
  let lastFrameAt = 0;
  // 눈사람 부수기 미리보기: 게임과 같이 F 두 번(확인 → 부수기). 서버가 없어서 벌칙은 이 페이지의 시계(Date.now)로 흉내만 낸다 (모의, 저장·전파 없음)
  let smash: { mx: number; my: number; px: number; py: number; dir: number } | null = null;
  let mockBrokenAt = 0;
  const manAhead = () => (me.moving || me.fishing ? null : winter.manAhead(to.x, to.y, me.dir));

  // 스키 장갑 눈싸움 미리보기 (모의: DB·지갑·다른 사람 없음). 실제 게임과 같은 순수 로직(game/snowfight.ts: 상태·F 동작·겨냥)을 쓴다.
  // 켜고 끄는 것은 프로필 eq.sg 에 해당하는 아래 체크박스(게임에서는 상점의 끼기/빼기 버튼). 던지기는 가짜 접속자(방어 더미)를 맞히고, 더미가 갑옷·펫 방어 중이어도 스턴(😵)이 걸리는 것만 보여 준다
  const MOCK_TOSS_COOLDOWN_MS = 3000; // game/toss.ts TOSS_COOLDOWN_MS 와 같은 값 (toss.ts 는 Firebase 를 불러와 여기서 못 쓴다)
  let glovesOn = false;
  const snow = new SnowfightState();
  const flights: TossView[] = [];
  let lastSnowThrow = -1e9;
  let snowGen = 0; // 맵을 옮기면 +1: 날아가던 눈덩이의 착지 판정을 버린다
  const gloveBox = el('input', { type: 'checkbox', id: 'dev-eq-sg' }) as HTMLInputElement;
  gloveBox.onchange = () => { glovesOn = gloveBox.checked; };
  nav.append(el('label', { style: 'display:flex;gap:4px;align-items:center;font-weight:bold;color:#7dd3fc' }, [gloveBox, `🧤 스키 장갑 끼기 (프로필 eq.${SKI_GLOVES_EQ}, 모의·저장 안 함) — 겨울 맵(I)에서 눈 위 F=뭉치기, 다시 F=던지기`]));
  const dummyAt = (x: number, y: number) => {
    const d = currentMapId === WINTER_MAP_ID ? dummies.find((o) => Math.round(o.x) === x && Math.round(o.y) === y) : undefined;
    return d ? { st: {}, x: d.x, y: d.y, ent: d } : null;
  };
  const snowGate = () => snowGateAt(map, currentMapId, to.x, to.y, glovesOn, me.moving || !input.enabled);
  const castTarget = () => { const fx = to.x + (me.dir === 2 ? 1 : me.dir === 1 ? -1 : 0), fy = to.y + (me.dir === 0 ? 1 : me.dir === 3 ? -1 : 0); return !isWater(map, to.x, to.y) && isFishable(map, fx, fy); };
  // 게임(world.ts canvasHint)과 같은 우선순위: 뭉친 눈이 있으면 던지기가 낚시 시작보다 먼저, 뭉치기는 낚시를 던질 수 있는 자리면 양보
  const snowAction = () => { const a = snowfightAction(snow.packed, snowGate()); return a === 'throw' || (a === 'pack' && !castTarget()) ? a : null; };
  const snowF = () => {
    const a = snow.press(snowGate(), input.interactRepeat);
    if (a !== 'throw') return;
    const now = performance.now();
    if (now - lastSnowThrow < MOCK_TOSS_COOLDOWN_MS) { me.bubble = { text: `(모의) 눈덩이는 ${Math.ceil((MOCK_TOSS_COOLDOWN_MS - (now - lastSnowThrow)) / 1000)}초 후에 다시 던질 수 있어요`, kind: 'near', at: now }; return; }
    lastSnowThrow = now;
    snow.consume();
    const plan = planSnowThrow({ x: to.x, y: to.y, dir: me.dir }, dummyAt);
    flights.push({ fx: to.x, fy: to.y, tx: plan.tx, ty: plan.ty, start: now, snow: true });
    const gen = snowGen;
    if (plan.target) window.setTimeout(() => {
      if (gen !== snowGen) return;
      const d = plan.target!.ent;
      if (!snowStillThere(d, plan.tx, plan.ty)) return;
      d.hitAt = performance.now();
      me.bubble = { text: `(모의) 명중! ${d.nick} — 방어를 무시하고 1초 스턴`, kind: 'near', at: performance.now() };
    }, 400);
  };

  const switchMap = (targetMapId: string, spawnTarget?: { x: number; y: number }) => {
    const target = targetMapId === MAIN_MAP_ID ? MAIN_MAP_ID : targetMapId;
    if (!maps[target]) return;
    currentMapId = target;
    map = maps[target];
    const spawnPos = spawnTarget || map.spawn;
    from = { ...spawnPos };
    to = { ...spawnPos };
    me.x = spawnPos.x;
    me.y = spawnPos.y;
    me.moving = false;
    me.fishing = null;
    resetWinter();
    smash = null;
    snow.reset(); snowGen++; flights.length = 0; // 뭉친 눈·날아가던 눈덩이는 맵을 옮기면 사라진다
  };

  input.onAction = (a) => {
    if (typeof a === 'object' && 'emote' in a) { me.pose = poseForEmote(a.emote); me.poseAt = performance.now(); me.emoteId = a.emote; if (a.emote === 10) { const t = others.find((o) => Math.round(o.x) === to.x + (me.dir === 2 ? 1 : me.dir === 1 ? -1 : 0) && Math.round(o.y) === to.y + (me.dir === 0 ? 1 : me.dir === 3 ? -1 : 0)); if (t) { t.pushAt = performance.now(); t.pushDir = me.dir; t.x += me.dir === 2 ? 1 : me.dir === 1 ? -1 : 0; t.y += me.dir === 0 ? 1 : me.dir === 3 ? -1 : 0; } } }
    else if (a === 'interact') {
      winter.resetSlide(); // F 는 빙판 관성을 먼저 멈춘다
      const nearPortal = portalNear(map, to.x, to.y);
      if (nearPortal) {
        // 행선지가 하나면 바로, 둘 이상이면 게임과 같은 선택 창
        const dests = portalDests(nearPortal);
        if (dests.length === 1) switchMap(dests[0].map, dests[0].spawn);
        else if (dests.length > 1) {
          input.releaseAll(); input.enabled = false;
          openPortalPicker(dests.map((d) => destView(d, currentMapId, d.map === MAIN_MAP_ID ? others.length : 0)), (i) => switchMap(dests[i].map, dests[i].spawn), () => { input.enabled = true; });
        }
        return;
      }
      // 바로 앞 눈사람 부수기: F 두 번 (포탈·하던 낚시 다음, 새로 던지는 낚시보다 먼저). 누르고 있어 반복된 F 는 세지 않는다
      const man = manAhead();
      if (!man) smash = null;
      else {
        if (input.interactRepeat) return;
        if (!smash) smash = { mx: man.x, my: man.y, px: to.x, py: to.y, dir: me.dir };
        else {
          winter.removeMan(man.x, man.y); smash = null; mockBrokenAt = Date.now();
          me.bubble = { text: '(미리보기·모의) 눈사람을 부쉈다: 30분 벌칙 표시만 흉내', kind: 'near', at: performance.now() };
        }
        return;
      }
      // 스키 장갑 눈싸움: 포탈·눈사람 확인 다음. 뭉친 눈이 있으면 던지기가 새 낚시보다 먼저고, 하던 낚시는 그대로 이어진다
      if (!me.fishing && snowAction()) { snowF(); return; }
      // 낚시 미리보기: 물가에서 F → 찌 던지기, 다시 F → 입질(!), 다시 F → 끝
      if (me.fishing) me.fishing = me.fishing.bite ? null : { ...me.fishing, bite: true };
      else { const fx = to.x + (me.dir === 2 ? 1 : me.dir === 1 ? -1 : 0), fy = to.y + (me.dir === 0 ? 1 : me.dir === 3 ? -1 : 0); if (!isWater(map, to.x, to.y) && isFishable(map, fx, fy)) me.fishing = { x: fx, y: fy, bite: false, since: performance.now() }; }
    }
    else if (a === 'chat') { me.bubble = { text: '테스트 말풍선 ' + Math.random().toFixed(2), kind: 'near', at: performance.now() }; }
  };
  // 개발용 순간이동: T 커피거리, B 게시판, L 라운지, P 공원, G 정원 포탈 앞, J 포탈 정원
  const TELEPORTS: Record<string, [string, number, number]> = {
    t: [MAIN_MAP_ID, 30, 11],
    b: [MAIN_MAP_ID, 30, 19],
    l: [MAIN_MAP_ID, 10, 22],
    p: [MAIN_MAP_ID, 48, 26],
    g: [MAIN_MAP_ID, 30, 35],
    j: [GARDEN_MAP_ID, 12, 13],
    k: [GOLD_MINE_MAP_ID, 12, 13],
    i: [WINTER_MAP_ID, 20, 19],
  };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (TELEPORTS[k]) {
      const [targetMapId, x, y] = TELEPORTS[k];
      if (targetMapId !== currentMapId) switchMap(targetMapId, { x, y });
      else { from = { x, y }; to = { x, y }; me.x = x; me.y = y; me.moving = false; me.fishing = null; winter.resetSlide(); }
    }
  });
  (window as unknown as { __dev: unknown }).__dev = { me, others, input, get to() { return to; }, get currentMapId() { return currentMapId; }, get map() { return map; }, get winter() { return winter; }, switchMap, get snow() { return snow; }, get glovesOn() { return glovesOn; }, dummies };
  const rooms: RenderState['rooms'] = { casino: { cap: 10, round: 1, state: 'open', members: { a: { n: '철수', ready: false, losses: 0, at: 1 } } } };
  eng.start((_dt, now) => {
    if (now - lastFrameAt > 500) winter.resetSlide(); // 뒤쪽 탭이었다가 돌아온 첫 프레임: 밀린 미끄러짐을 따라잡지 않는다
    lastFrameAt = now;
    if (smash) { const m = manAhead(); if (!m || m.x !== smash.mx || m.y !== smash.my || to.x !== smash.px || to.y !== smash.py || me.dir !== smash.dir) smash = null; }
    const penalty = snowActive(mockBrokenAt, Date.now()); // 모의: 이 페이지의 시계로만
    me.snowBrokenAt = penalty ? mockBrokenAt : 0;
    me.nick = penalty ? '테스터 💥' : '테스터';
    if (me.moving) {
      me.moveT = Math.min(1, (now - moveStart) / STEP_MS);
      me.x = from.x + (to.x - from.x) * me.moveT; me.y = from.y + (to.y - from.y) * me.moveT;
      if (me.moveT >= 1) { me.moving = false; me.x = to.x; me.y = to.y; }
    }
    if (!me.moving) {
      const d = input.heldDir();
      if (d !== null) {
        me.fishing = null;
        me.dir = d;
        const nx = to.x + (d === 2 ? 1 : d === 1 ? -1 : 0), ny = to.y + (d === 0 ? 1 : d === 3 ? -1 : 0);
        if (canStep(nx, ny)) {
          const push = winter.pushPlan(to.x, to.y, d, winterBlocked); // 눈덩이 쪽으로 걸어 들어가면 한 칸 밀린다 (미리보기는 걸음이 늘 받아들여진다)
          if (push) winter.applyPush(push, now, winterBlocked);
          from = { ...to }; to = { x: nx, y: ny }; moveStart = now; me.moving = true; me.moveT = 0; winter.armSlide(d);
        }
        else winter.resetSlide();
      } else if (winter.sliding) {
        // 키를 뗀 뒤 빙판에서 이어 가는 칸 (입력이 막혀 있으면 멈춘다)
        const s = input.enabled ? winter.slideStep(to.x, to.y, canStep) : null;
        if (s) { me.fishing = null; me.dir = s.dir; from = { ...to }; to = { x: s.x, y: s.y }; moveStart = now; me.moving = true; me.moveT = 0; } else winter.resetSlide();
      }
    }
    eng.follow(me.x * TILE + TILE / 2, me.y * TILE + TILE / 2, map.w, map.h);
    const room = roomAt(map, to.x, to.y);
    const portal = portalNear(map, to.x, to.y);
    let hint: { x: number; y: number; text: string } | null = null;
    if (portal) {
      hint = { x: to.x, y: to.y - 1, text: `F 이동 (${portal.label || '포탈'})` };
    } else if (room) {
      hint = { x: to.x, y: to.y - 1, text: `F 준비 (${room.label})` };
    } else {
      const man = manAhead();
      if (man) hint = { x: man.x, y: man.y, text: smash ? 'F · 진짜 부술거야..?' : 'F · 눈사람 부수기..?' };
      else if (!me.fishing) { const a = snowAction(); if (a) hint = { x: to.x, y: to.y - 1, text: a === 'pack' ? SNOW_PACK_HINT : SNOW_THROW_HINT }; }
    }
    snow.sync(snowGate()); // 장갑을 빼거나 겨울 맵을 벗어나면 뭉친 눈이 사라진다
    me.snowReady = snow.packed;
    while (flights.length && now - flights[0].start > 480) flights.shift();
    const loc = labelAt(map, to.x, to.y) || MAP_INFO[currentMapId]?.name || '광장';
    locBadge.textContent = `📍 위치: ${loc} (${map.name})`;
    render(eng, { map, entities: [me, ...(currentMapId === MAIN_MAP_ID ? others : currentMapId === WINTER_MAP_ID ? dummies : [])], rooms, now, serverNow: Date.now(), hint, bugs: [], tosses: flights, snow: winter.views(now) });
  });
}
