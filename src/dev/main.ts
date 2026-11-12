// Firebase 없이 그래픽/이동/렌더링을 확인하는 개발용 미리보기 페이지
import '../styles.css';
import { Engine } from '../game/engine';
import { Input } from '../game/input';
import { render, poseForEmote, type Entity, type RenderState } from '../game/render';
import { buildDefaultMap, buildPortalGarden, buildGoldMine, isWalkable, isWater, roomAt, portalNear, portalDests, labelAt, type MapData } from '../game/map';
import { MAIN_MAP_ID, GARDEN_MAP_ID, GOLD_MINE_MAP_ID } from '../shared/maps';
import { destView, MAP_INFO } from '../game/portal';
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
  el('span', { class: 'muted', text: '  방향키 이동, 1~0 이모트, 2~9 포즈, F 상호작용/포탈 이동, J 정원, K 금광' }),
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
  };
  let currentMapId: string = MAIN_MAP_ID;
  let map: MapData = maps[currentMapId];

  const me: Entity = {
    uid: 'me', nick: '테스터', avatar: 'f03', x: map.spawn.x, y: map.spawn.y, dir: 0, moving: false, moveT: 0, pose: 'none', poseAt: 0, emoteId: 0,
    bubble: null, isMe: true, pushAt: -1, pushDir: 0, hitAt: -1e9, blockAt: -1e9, fishing: null, hat: null, nameColor: null, fx: null,
    pet: { id: 'petdog', x: map.spawn.x, y: map.spawn.y + 1, moving: false, moveT: 0, hopAt: -1e9, dir: 0, scale: 1.3, ride: false }, // 미리보기: 강아지 Lv5 크기
  };
  const others: Entity[] = [];
  const names = ['철수', '영희', '민수', '지은', '고양이씨'];
  for (let i = 0; i < 5; i++) others.push({ ...me, uid: 'o' + i, nick: names[i], avatar: PRESETS[(i * 37) % 150].id, x: map.spawn.x - 4 + i * 2, y: map.spawn.y - 3, isMe: false, bubble: i === 1 ? { text: '안녕하세요! 커피 내기 하실 분?', kind: 'near', at: performance.now() + 1e9 } : i === 2 ? { text: '전체 채팅 테스트입니다', kind: 'all', at: performance.now() + 1e9 } : i === 3 ? { text: '귓속말이에요', kind: 'w', at: performance.now() + 1e9 } : i === 4 ? { text: '오늘 날씨 좋다', kind: 'near', at: performance.now() + 1e9 } : null });
  let from = { x: me.x, y: me.y }, to = { x: me.x, y: me.y }, moveStart = 0;
  const occupied = (x: number, y: number) => (currentMapId === MAIN_MAP_ID ? others.some((o) => Math.round(o.x) === x && Math.round(o.y) === y) : false);

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
  };

  input.onAction = (a) => {
    if (typeof a === 'object' && 'emote' in a) { me.pose = poseForEmote(a.emote); me.poseAt = performance.now(); me.emoteId = a.emote; if (a.emote === 10) { const t = others.find((o) => Math.round(o.x) === to.x + (me.dir === 2 ? 1 : me.dir === 1 ? -1 : 0) && Math.round(o.y) === to.y + (me.dir === 0 ? 1 : me.dir === 3 ? -1 : 0)); if (t) { t.pushAt = performance.now(); t.pushDir = me.dir; t.x += me.dir === 2 ? 1 : me.dir === 1 ? -1 : 0; t.y += me.dir === 0 ? 1 : me.dir === 3 ? -1 : 0; } } }
    else if (a === 'interact') {
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
      // 낚시 미리보기: 물가에서 F → 찌 던지기, 다시 F → 입질(!), 다시 F → 끝
      if (me.fishing) me.fishing = me.fishing.bite ? null : { ...me.fishing, bite: true };
      else { const fx = to.x + (me.dir === 2 ? 1 : me.dir === 1 ? -1 : 0), fy = to.y + (me.dir === 0 ? 1 : me.dir === 3 ? -1 : 0); if (!isWater(map, to.x, to.y) && isWater(map, fx, fy)) me.fishing = { x: fx, y: fy, bite: false, since: performance.now() }; }
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
  };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (TELEPORTS[k]) {
      const [targetMapId, x, y] = TELEPORTS[k];
      if (targetMapId !== currentMapId) switchMap(targetMapId, { x, y });
      else { from = { x, y }; to = { x, y }; me.x = x; me.y = y; me.moving = false; me.fishing = null; }
    }
  });
  (window as unknown as { __dev: unknown }).__dev = { me, others, input, get to() { return to; }, get currentMapId() { return currentMapId; }, get map() { return map; }, switchMap };
  const rooms: RenderState['rooms'] = { casino: { cap: 10, round: 1, state: 'open', members: { a: { n: '철수', ready: false, losses: 0, at: 1 } } } };
  eng.start((_dt, now) => {
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
        if (isWalkable(map, nx, ny) && !occupied(nx, ny)) { from = { ...to }; to = { x: nx, y: ny }; moveStart = now; me.moving = true; me.moveT = 0; }
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
    }
    const loc = labelAt(map, to.x, to.y) || MAP_INFO[currentMapId]?.name || '광장';
    locBadge.textContent = `📍 위치: ${loc} (${map.name})`;
    render(eng, { map, entities: [me, ...(currentMapId === MAIN_MAP_ID ? others : [])], rooms, now, serverNow: Date.now(), hint, bugs: [], tosses: [] });
  });
}
