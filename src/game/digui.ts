import { el } from '../shared/util';
import { modal, withCloseX } from './ui';
import { G, O, type MapData } from './map';
import { DIG_HINT_RADIUS, DIG_BOX_COINS, type DigSpot } from './dig';

const GROUND_COLOR: Record<number, string> = {
  [G.GRASS]: '#5fa84a', [G.GRASS2]: '#4e9440', [G.PATH]: '#d9c38a', [G.PATH2]: '#c9b58a', [G.WATER]: '#4aa3df', [G.FLOWER]: '#7cbf5a',
  [G.WOOD]: '#a0744a', [G.TILE_FLOOR]: '#bfbfbf', [G.PLAZA]: '#b8b0a0', [G.SAND]: '#e8d9a8', [G.CARPET]: '#a05050', [G.DARK_FLOOR]: '#555',
};

// 오늘의 보물 지도: 미니맵 위에 반경 4칸짜리 원. 판 자리는 ✓
export function openDigMap(map: MapData, spots: DigSpot[], dug: Set<number>, me: { x: number; y: number }): void {
  const body = el('div', { class: 'digmap' });
  const m = modal('🗺 오늘의 보물 지도', body, [], false);
  m.root.querySelector('.actions')?.remove();
  withCloseX(m);
  const S = 4;
  const cv = document.createElement('canvas');
  cv.width = map.w * S; cv.height = map.h * S;
  const c = cv.getContext('2d')!;
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    c.fillStyle = GROUND_COLOR[map.ground[y * map.w + x]] || '#777';
    c.fillRect(x * S, y * S, S, S);
    const o = map.objects[y * map.w + x];
    if (o === O.TREE || o === O.PINE || o === O.BUSH || o === O.HEDGE) { c.fillStyle = '#2d6b2d'; c.fillRect(x * S + 1, y * S + 1, S - 2, S - 2); }
    else if (o === O.WALL || o === O.WALL_SIDE || o === O.WALL_WINDOW) { c.fillStyle = '#6b5b4b'; c.fillRect(x * S, y * S, S, S); }
  }
  for (const s of spots) {
    const done = dug.has(s.i);
    c.beginPath(); c.arc((s.cx + 0.5) * S, (s.cy + 0.5) * S, DIG_HINT_RADIUS * S, 0, Math.PI * 2);
    c.fillStyle = done ? 'rgba(120,120,120,0.35)' : 'rgba(255,216,77,0.3)'; c.fill();
    c.lineWidth = 2; c.strokeStyle = done ? 'rgba(200,200,200,0.7)' : '#ffd84d'; c.setLineDash(done ? [] : [4, 3]); c.stroke(); c.setLineDash([]);
    if (done) { c.fillStyle = '#fff'; c.font = 'bold 14px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('✓', (s.cx + 0.5) * S, (s.cy + 0.5) * S); }
  }
  // 내 위치
  c.fillStyle = '#ff5c5c'; c.beginPath(); c.arc((me.x + 0.5) * S, (me.y + 0.5) * S, 3.5, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke();
  cv.style.width = '100%'; cv.style.imageRendering = 'pixelated';
  body.append(cv);
  body.append(el('p', { class: 'muted', style: 'margin:8px 0 0', text: `오늘 ${dug.size}/${spots.length}곳 · 노란 원 안 어딘가에 묻혀 있어요. 그 칸에 서면 "F 땅 파기"가 뜹니다. 동전 10~50, 가끔 꽝, 한 곳은 💎 보물 상자(${DIG_BOX_COINS}코인). 매일 새 자리, 각자 한 번씩. 빨간 점은 나.` }));
}
