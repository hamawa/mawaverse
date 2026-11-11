import { TILE, BUBBLE_MS, EMOTE_MS, ROOM_RESULT_MS } from '../shared/config';
import type { Dir, RoomState } from '../shared/types';
import { wrapText } from '../shared/util';
import type { Engine } from './engine';
import { G, TALL_OBJECTS, waterDepth, type MapData, type Zone } from './map';
import { groundTile, objectSprite } from './tiles';
import { getSprite, FRAME_W, FRAME_H, type Pose } from './sprites';
import type { FishingView } from './fishing';
import type { BugView } from './bugs';
import type { TossView } from './toss';
import { drawHat, hatAbove, nameStyle, rainbowGradient, spawnFx, drawFx, drawPet, drawMount, mountInfo } from './cosmetics';

export type BubbleKind = 'near' | 'all' | 'w';
export interface Bubble { text: string; kind: BubbleKind; at: number }

export interface Entity {
  uid: string;
  nick: string;
  avatar: string;
  x: number;          // 보간된 타일 좌표
  y: number;
  dir: Dir;
  moving: boolean;
  moveT: number;      // 0..1 이동 진행
  pose: Pose;
  poseAt: number;     // 포즈 시작 시각 (performance.now 기준)
  emoteId: number;
  bubble: Bubble | null;
  isMe: boolean;
  ready: boolean;
  pushAt: number;     // 밀침 당한 시각
  hitAt: number;      // 말랑이에 맞은 시각 (1초 동안 😵 + 흔들림)
  blockAt: number;    // 갑옷으로 막은 시각 (1초 동안 🛡)
  pushDir: Dir;
  fishing: FishingView | null; // 낚시 중이면 찌 위치
  hat: string | null;          // 꾸미기 (상점)
  nameColor: string | null;
  fx: string | null;
  pet: PetView | null;         // 데리고 다니는 펫 (한 칸 뒤)
  ghost?: boolean;             // 마피아 유령: 반투명 (유령에게만 보임. 산 사람 화면에는 아예 안 들어온다)
}
// 마피아 시체: 죽은 자리에 누운 아바타
export interface BodyView { uid: string; avatar: string; nick: string; x: number; y: number }
// 펫 표시: 타일 좌표(보간), 이동 중 여부·진행, 마지막 점프(벌레 잡기) 시각. scale: 레벨에 따른 크기 (2026-11-10), ride: 주인이 타고 있다 (주인 발밑에 그린다)
export interface PetView { id: string; x: number; y: number; moving: boolean; moveT: number; hopAt: number; dir: Dir; scale: number; ride: boolean }
// 마피아 미션 자리 표시 (2026-11-10): 테두리(mine 이면 금색 깜빡임, 아니면 흐리게) + 화면 밖이면 가장자리 화살표(mine 일 때만)
export interface TaskMark { x: number; y: number; w: number; h: number; label: string }

export interface RenderState {
  map: MapData;
  entities: Entity[];
  rooms: Record<string, RoomState>;
  now: number;        // performance.now()
  serverNow: number;  // 서버 시각 (ms)
  hint: { x: number; y: number; text: string } | null; // 상호작용 힌트 (타일 좌표)
  bugs: BugView[];    // 내 화면의 벌레 (클라이언트 로컬)
  tosses: TossView[]; // 날아가는 말랑이
  bodies?: BodyView[]; // 마피아 시체
  marks?: { spots: TaskMark[]; mine: boolean } | null; // 마피아 미션 자리
}

const EMOTE_ICON: Record<number, string> = { 1: '👋', 2: '', 3: '😆', 4: '💧', 5: '💤', 6: '🥱', 7: '💢', 8: '❤', 9: '♪', 10: '💥', 11: '🥅', 12: '🧸', 13: '⛏', 14: '🧲', 15: '🐤' }; // 15: 삐약 (예전 병아리 스킬. 이모트 자리는 남겨 둔다)

export function poseForEmote(id: number): Pose {
  return (['none', 'wave', 'jump', 'laugh', 'cry', 'sleep', 'yawn', 'angry', 'heart', 'dance', 'push', 'push', 'push', 'push', 'push', 'dance'] as Pose[])[id] || 'none'; // 11 = 잠자리채 휘두르기, 12 = 말랑이 던지기, 13 = 삽질, 14 = 끌기, 15 = 삐약 합창
}

interface Drawable { sortY: number; order: number; draw: () => void }

// 수영: 물에 완전히 잠기면 스프라이트의 실제 꼭대기(첫 불투명 줄)부터 SWIM_VISIBLE 줄만 보인다.
// 사람은 머리카락 + 눈까지, 입은 물속. 키가 작은 슬라임 같은 캐릭터도 꼭대기 기준이라 눈이 보인다.
// 수면은 타일 아래쪽 가장자리에서 SWIM_RAISE 만큼 위로 올라와 머리가 타일 가운데쯤에 온다.
const SWIM_VISIBLE = 12;
const SWIM_RAISE = 10;
const topCache = new WeakMap<HTMLCanvasElement, number>();
// 스프라이트의 첫 불투명 줄 (캔버스별로 한 번만 계산)
export function spriteTop(cv: HTMLCanvasElement): number {
  let top = topCache.get(cv);
  if (top !== undefined) return top;
  top = 0;
  const data = cv.getContext('2d')?.getImageData(0, 0, cv.width, cv.height).data;
  if (data) {
    outer: for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (data[(y * cv.width + x) * 4 + 3]) { top = y; break outer; }
  }
  topCache.set(cv, top);
  return top;
}

export function render(eng: Engine, st: RenderState): void {
  const { ctx } = eng;
  const { map } = st;
  eng.clear('#12201a');
  eng.beginWorld();
  const vis = eng.visibleTiles(map.w, map.h);
  const waterFrame = Math.floor(st.now / 450) % 3;

  // ---- 바닥 ----
  for (let y = vis.y0; y <= vis.y1; y++) for (let x = vis.x0; x <= vis.x1; x++) {
    const id = map.ground[y * map.w + x];
    const variant = (x * 7 + y * 13) % 3;
    ctx.drawImage(groundTile(id, variant, id === G.WATER ? waterFrame : 0), x * TILE, y * TILE);
  }

  // ---- 방 바닥 강조 (대기 중인 방은 살짝 밝게) ----
  for (const z of map.zones) if (z.kind === 'room') {
    const rs = st.rooms[z.id];
    if (rs && rs.state === 'result') { ctx.fillStyle = 'rgba(255, 200, 60, 0.25)'; ctx.fillRect(z.x * TILE, z.y * TILE, z.w * TILE, z.h * TILE); }
  }
  // ---- 포탈 바닥 효과 (오브젝트·캐릭터 아래) ----
  for (const z of map.zones) if (z.kind === 'portal') {
    if (!eng.isTileVisible(z.x + z.w / 2 - 0.5, z.y + z.h / 2 - 0.5, TILE * 2)) continue;
    drawPortalGround(ctx, z, st.now);
  }
  // ---- 마피아 미션 자리 테두리 (바닥 위, 오브젝트 아래) ----
  if (st.marks) {
    const pulse = 0.55 + 0.45 * Math.sin(st.now / 220);
    for (const m of st.marks.spots) {
      if (!eng.isTileVisible(m.x + m.w / 2 - 0.5, m.y + m.h / 2 - 0.5, TILE * 2)) continue;
      const tall = TALL_OBJECTS.has(map.objects[m.y * map.w + m.x]) ? TILE : 0;
      const x = m.x * TILE - 2, y = m.y * TILE - tall - 2, w = m.w * TILE + 4, h = m.h * TILE + tall + 4;
      ctx.lineWidth = 2;
      if (st.marks.mine) {
        ctx.strokeStyle = `rgba(255, 216, 77, ${0.5 + 0.5 * pulse})`;
        ctx.shadowColor = 'rgba(255, 216, 77, 0.9)'; ctx.shadowBlur = 6 + 8 * pulse;
      } else { ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'; ctx.setLineDash([4, 4]); }
      roundRect(ctx, x, y, w, h, 4); ctx.stroke();
      ctx.shadowBlur = 0; ctx.setLineDash([]);
    }
  }

  // ---- 오브젝트 + 캐릭터 (y 정렬) ----
  const items: Drawable[] = [];
  for (let y = Math.max(0, vis.y0 - 1); y <= Math.min(map.h - 1, vis.y1 + 1); y++) for (let x = vis.x0; x <= vis.x1; x++) {
    const id = map.objects[y * map.w + x];
    if (!id) continue;
    const spr = objectSprite(id);
    if (!spr) continue;
    const tall = TALL_OBJECTS.has(id);
    items.push({ sortY: y + 0.9, order: 0, draw: () => ctx.drawImage(spr.cv, x * TILE, y * TILE - (tall ? TILE : 0)) });
  }
  // 이름표·말풍선 위치용: 물속에서 가라앉은 픽셀(sink), 보이는 발끝(물속이면 수면)이 타일 아래 끝에서 벗어난 픽셀(feet), 모자가 프레임 위로 솟은 픽셀(above)
  const posByUid = new Map<string, { sink: number; feet: number; above: number }>();
  for (const e of st.entities) {
    const px = e.x * TILE + (TILE - FRAME_W) / 2;
    let py = e.y * TILE + TILE - FRAME_H;
    const frame = e.moving ? Math.floor(e.moveT * 4) & 3 : 0;
    if (e.fx && e.moving) spawnFx(e.uid, e.fx, e.x * TILE + TILE / 2, e.y * TILE + TILE - 3, st.now);
    let pose = e.pose;
    let ddir = e.dir;
    const pt = (st.now - e.poseAt) / EMOTE_MS;
    if (pose !== 'none' && pt > 1) pose = 'none';
    let ox = 0;
    if (pose === 'jump') py -= Math.round(Math.sin(Math.min(1, pt) * Math.PI) * 10);
    if (pose === 'dance') { ddir = ([0, 1, 0, 2] as Dir[])[Math.floor(st.now / 220) % 4]; py += Math.floor(st.now / 110) % 2; }
    if (pose === 'angry' || pose === 'cry') ox = Math.floor(st.now / 60) % 2 === 0 ? -1 : 1;
    if (pose === 'push' && pt < 0.3) { const k = Math.sin((pt / 0.3) * Math.PI) * 5; ox += e.dir === 1 ? -k : e.dir === 2 ? k : 0; py += e.dir === 0 ? k : e.dir === 3 ? -k : 0; }
    if (pose === 'laugh') py += Math.floor(st.now / 120) % 2;
    const hitT = st.now - e.hitAt;
    if (hitT >= 0 && hitT < 1000) ox += Math.sin(hitT / 40) * 2; // 말랑이에 맞아 휘청
    const pushed = st.now - e.pushAt;
    if (pushed >= 0 && pushed < 250) { const k = Math.sin((pushed / 250) * Math.PI) * 3; ox += e.pushDir === 1 ? -k : e.pushDir === 2 ? k : 0; }
    const spr = getSprite(e.avatar, ddir, pose === 'dance' ? frame : frame, pose);
    // 물에 잠긴 정도. 물가를 오갈 때 0..1 사이를 지나며 서서히 가라앉거나 떠오른다
    const depth = waterDepth(map, e.x, e.y);
    let sink = 0, visibleH = FRAME_H;
    if (depth > 0) {
      const top = spriteTop(spr);
      const bodyH = FRAME_H - top;                                   // 꼭대기부터 발끝까지
      const shown = Math.round(bodyH - (bodyH - SWIM_VISIBLE) * depth); // 그 중 보이는 줄 수
      const bobW = Math.round(Math.sin(st.now / 420 + e.x * 3 + e.y * 5)); // 둥실거림 ±1px
      visibleH = top + shown;
      // 보이는 부분의 아래 끝이 수면에 오도록 내린다
      sink = Math.round(FRAME_H - SWIM_RAISE * depth) - visibleH + bobW;
    }
    const above = e.hat ? Math.max(0, hatAbove(e.hat) - spriteTop(spr)) : 0;
    // 탑승 (2026-11-10 저녁): 물 밖에서만 탈것(MOUNT_ART)을 그리고 캐릭터는 다리 아래 hide 줄을 가려 앉은 모양으로. 물속에선 펫을 아예 안 그린다 (물밑에 있는 셈, 평소 수영 모습)
    const ride = !!e.pet?.ride, rideShown = ride && depth <= 0;
    let hide = 0, lift = 0;
    if (rideShown && e.pet) {
      const mi = mountInfo(e.pet.id, e.dir);
      if (mi) { hide = Math.min(9, Math.round((FRAME_H - spriteTop(spr)) * 0.3)); lift = 2 + mi.h - mi.seat - hide; }
    }
    posByUid.set(e.uid, { sink: sink - lift, feet: sink + visibleH - FRAME_H, above });
    // 찌는 물 타일 위에, 캐릭터보다 뒤에 그린다
    if (e.fishing) { const fv = e.fishing; items.push({ sortY: fv.y + 0.5, order: 1, draw: () => drawBobber(ctx, e, fv, st.now) }); }
    // 펫: 자기 타일의 y 순서로 (주인과 겹치면 주인보다 앞뒤가 자연스럽게)
    if (e.pet && !ride) { const p = e.pet; items.push({ sortY: p.y + 0.95, order: 1, draw: () => drawPet(ctx, p.id, p.x, p.y, TILE, st.now, p.moving, p.moveT, p.hopAt, p.dir, p.scale) }); }
    items.push({
      sortY: e.y + 1, order: 1, draw: () => {
        const cx = e.x * TILE + TILE / 2;
        if (depth < 1) {
          ctx.fillStyle = `rgba(0,0,0,${0.22 * (1 - depth)})`;
          ctx.beginPath(); ctx.ellipse(cx, e.y * TILE + TILE - 2, rideShown ? 13 : 9, rideShown ? 4.5 : 3.5, 0, 0, Math.PI * 2); ctx.fill();
          if (e.isMe) { ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - depth)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cx, e.y * TILE + TILE - 2, rideShown ? 15 : 11, rideShown ? 5.5 : 4.5, 0, 0, Math.PI * 2); ctx.stroke(); }
        }
        let dx = Math.round(px + ox), dy = Math.round(py) + sink;
        if (rideShown && e.pet) {
          const mp = drawMount(ctx, e.pet.id, e.x, e.y, TILE, st.now, e.moving, e.moveT, e.pet.hopAt, e.dir);
          if (mp) { dx += mp.ox; dy = mp.seatY - (FRAME_H - hide) + (Math.round(py) - (e.y * TILE + TILE - FRAME_H)); } // 포즈(점프 등)로 움직인 만큼은 그대로
        }
        if (e.ghost) ctx.globalAlpha = 0.45 + 0.1 * Math.sin(st.now / 400);
        if (depth <= 0) { if (hide) ctx.drawImage(spr, 0, 0, FRAME_W, FRAME_H - hide, dx, dy, FRAME_W, FRAME_H - hide); else ctx.drawImage(spr, dx, dy); }
        else {
          // 물에 잠긴 아랫부분은 그리지 않는다
          ctx.drawImage(spr, 0, 0, FRAME_W, visibleH, dx, dy, FRAME_W, visibleH);
          // 수면 물결: 잘린 가장자리를 가려 주고, 내 캐릭터는 조금 더 밝게
          // 물결은 수면 아래쪽 반원만 그려 얼굴을 가리지 않게 한다. 수면 줄에는 밝은 선 한 줄
          const wy = dy + visibleH;
          const pulse = 1 + 0.08 * Math.sin(st.now / 300 + e.x * 7);
          ctx.fillStyle = `rgba(255,255,255,${0.45 * depth})`;
          ctx.fillRect(dx + 3, wy, FRAME_W - 6, 1);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = `rgba(255,255,255,${(e.isMe ? 0.75 : 0.55) * depth})`;
          ctx.beginPath(); ctx.ellipse(cx, wy, 11 * pulse, 4 * pulse, 0, 0, Math.PI); ctx.stroke();
          ctx.strokeStyle = `rgba(124,196,240,${0.6 * depth})`;
          ctx.beginPath(); ctx.ellipse(cx, wy + 1, 14 * pulse, 5.5 * pulse, 0, 0, Math.PI); ctx.stroke();
        }
        if (e.hat) drawHat(ctx, e.hat, dx, dy, spriteTop(spr), ddir);
        if (e.fishing) drawRod(ctx, e, e.fishing, st.now);
        ctx.globalAlpha = 1;
      },
    });
  }
  // 마피아 시체: 옆으로 누운 아바타 + 🩸 (모두에게 보임)
  for (const b of st.bodies || []) {
    items.push({ sortY: b.y + 0.9, order: 0, draw: () => {
      const spr = getSprite(b.avatar, 0, 0, 'none');
      const cx = b.x * TILE + TILE / 2, cy = b.y * TILE + TILE - 10;
      ctx.fillStyle = 'rgba(140, 20, 20, 0.55)'; ctx.beginPath(); ctx.ellipse(cx + 4, b.y * TILE + TILE - 4, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI / 2); ctx.drawImage(spr, -FRAME_W / 2, -FRAME_H / 2 + 6); ctx.restore();
      ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🩸', cx + 12, cy - 8);
    } });
  }
  items.sort((a, b) => a.sortY - b.sortY || a.order - b.order);
  for (const it of items) it.draw();
  drawFx(ctx, st.now); // 이동 이펙트 파티클
  // 벌레: 가만히 떠다니다가 날아가거나(flee) 잡히면(caught) 0.7초 동안 사라진다
  for (const b of st.bugs) {
    const t = st.now - b.since;
    let alpha = 1, dy = Math.sin(st.now / 250 + b.seed) * 2, dx = Math.sin(st.now / 700 + b.seed) * 3;
    if (b.state === 'flee') { alpha = 1 - t / 700; dy -= (t / 700) * 40; dx += Math.sin(t / 60) * 6; }
    else if (b.state === 'caught') { alpha = 1 - t / 700; dy -= (t / 700) * 10; }
    else if (t < 400) alpha = t / 400;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(b.icon, b.x * TILE + TILE / 2 + dx, b.y * TILE + TILE / 2 + dy);
    ctx.globalAlpha = 1;
  }
  // 날아가는 말랑이: 던진 칸에서 겨냥한 칸까지 포물선
  for (const t of st.tosses) {
    const k = Math.min(1, (st.now - t.start) / 400);
    const arc = t.icon ? 0 : Math.sin(k * Math.PI) * 18; // 장풍(💨)은 직선, 말랑이는 포물선
    const x = (t.fx + (t.tx - t.fx) * k) * TILE + TILE / 2, y = (t.fy + (t.ty - t.fy) * k) * TILE + TILE / 2 - 10 - arc;
    if (t.icon === '⚓') { // 갈고리: 던진 사람에게서 줄이 이어진다
      ctx.strokeStyle = '#d9c7a0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(t.fx * TILE + TILE / 2, t.fy * TILE + TILE / 2 - 10); ctx.lineTo(x, y); ctx.stroke();
    }
    ctx.font = `${t.icon ? 16 : 13}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t.icon || '🧸', x, y);
  }

  // ---- 화면 좌표 오버레이 ----
  eng.beginScreen();
  const s = eng.scale;
  // 방 간판
  for (const z of map.zones) if (z.kind === 'room' || z.kind === 'casino') drawRoomSign(eng, z, st.rooms[z.id], st.serverNow);
  // 포탈 간판/라벨
  for (const z of map.zones) if (z.kind === 'portal') {
    if (!eng.isTileVisible(z.x + z.w / 2 - 0.5, z.y + z.h / 2 - 0.5, TILE * 2)) continue;
    const [sx, sy] = eng.worldToScreen((z.x + z.w / 2) * TILE, z.y * TILE);
    drawLabel(ctx, `🌀 ${z.label || '포탈'}`, sx, sy - 6 * s, '#dbeafe', 'rgba(15, 23, 42, 0.75)', 11, '#60a5fa');
  }
  // 마피아 미션: 화면 밖의 내 미션은 가장자리 화살표 + 이름 (2026-11-10)
  if (st.marks?.mine) for (const m of st.marks.spots) if (!eng.isTileVisible(m.x + m.w / 2 - 0.5, m.y + m.h / 2 - 0.5, -TILE / 2)) drawEdgeArrow(eng, (m.x + m.w / 2) * TILE, (m.y + m.h / 2) * TILE, m.label, st.now);
  // 힌트
  if (st.hint) {
    const [sx, sy] = eng.worldToScreen(st.hint.x * TILE + TILE / 2, st.hint.y * TILE);
    drawLabel(ctx, st.hint.text, sx, sy - 10 * s, '#ffe9a8', 'rgba(0,0,0,0.65)', 12);
  }
  // 이름표/말풍선/이모트 (y 순서대로, 아래 있는 캐릭터가 위에 그려짐)
  const ents = [...st.entities].sort((a, b) => a.y - b.y);
  for (const e of ents) {
    const pos = posByUid.get(e.uid) || { sink: 0, feet: 0, above: 0 };
    // 이름표는 발 아래(물속이면 수면 아래). 점프해도 그림자처럼 제자리. 파티 이름은 그 아래
    const [sx, syFeet] = eng.worldToScreen(e.x * TILE + TILE / 2, e.y * TILE + TILE + pos.feet);
    const ns = nameStyle(e.nameColor);
    const nameColor = ns ? ns.color : e.isMe ? '#ffe9a8' : '#ffffff';
    const name = e.ready ? `✓ ${e.nick}` : e.nick;
    const under = syFeet + 2 + 18; // drawLabel 은 라벨의 아래쪽 y 를 받는다 (높이 = 글자 크기 + 6)
    drawLabel(ctx, name, sx, under, nameColor, ns?.bg ?? 'rgba(0,0,0,0.55)', 12, ns?.border);
    // 머리 위: 😵 · 입질 · 이모트 · 말풍선. 물속이면 가라앉은 만큼 내려가고, 모자가 프레임 위로 솟았으면 그만큼 올라간다
    const [, syTop] = eng.worldToScreen(e.x * TILE + TILE / 2, e.y * TILE + TILE - FRAME_H + pos.sink - pos.above);
    let top = syTop - 4;
    if (e.pose === 'jump' && st.now - e.poseAt < EMOTE_MS) top -= Math.sin(Math.min(1, (st.now - e.poseAt) / EMOTE_MS) * Math.PI) * 10 * s;
    // 말랑이에 맞음
    if (st.now - e.hitAt >= 0 && st.now - e.hitAt < 1000) { drawLabel(ctx, '😵', sx, top, '#fff', 'rgba(0,0,0,0.5)', 14); top -= 20; }
    // 갑옷으로 막음
    if (st.now - e.blockAt >= 0 && st.now - e.blockAt < 1000) { drawLabel(ctx, '🛡', sx, top, '#fff', 'rgba(0,0,0,0.5)', 14); top -= 20; }
    // 입질! (본인 화면에만)
    if (e.fishing?.bite) { const bounce = Math.abs(Math.sin(st.now / 110)) * 6 * s; drawLabel(ctx, '!', sx, top - 2 - bounce, '#ffd84d', 'rgba(0,0,0,0.7)', 18); }
    // 자동 회수 버프 중이면 찌 위에 표시 (남들도 본다: 밀러 갈 재미). 강화한 명품 낚싯대는 ★n (2026-11-10)
    if (e.fishing?.auto || e.fishing?.stars) {
      const [bx, by] = eng.worldToScreen(e.fishing.x * TILE + TILE / 2, e.fishing.y * TILE);
      const txt = `${e.fishing.auto ? '자동' : ''}${e.fishing.auto && e.fishing.stars ? ' ' : ''}${e.fishing.stars ? `★${e.fishing.stars}` : ''}`;
      drawLabel(ctx, txt, bx, by - 4 * s, e.fishing.stars ? '#ffd84d' : '#cfe9dc', 'rgba(0,0,0,0.5)', 9);
    }
    // 이모트 아이콘
    const pt = st.now - e.poseAt;
    if (e.pose !== 'none' && pt < EMOTE_MS && EMOTE_ICON[e.emoteId]) {
      const float = -Math.min(1, pt / EMOTE_MS) * 10;
      ctx.font = `${16 + 4 * (s - 1)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.globalAlpha = pt > EMOTE_MS * 0.7 ? 1 - (pt - EMOTE_MS * 0.7) / (EMOTE_MS * 0.3) : 1;
      ctx.fillText(EMOTE_ICON[e.emoteId], sx + 14 * s, top - 2 + float);
      ctx.globalAlpha = 1;
    }
    // 말풍선
    if (e.bubble && st.now - e.bubble.at < BUBBLE_MS) drawBubble(ctx, e.bubble, sx, top - 2, s);
  }
}

// ---- 낚시 ----
// 낚싯대를 쥔 손 위치 (월드 px)
function handPos(e: Entity): [number, number] {
  const cx = e.x * TILE + TILE / 2, cy = e.y * TILE + TILE - 16;
  const ox = e.dir === 2 ? 7 : e.dir === 1 ? -7 : 5;
  return [cx + ox, cy];
}
// 찌 위치. 던진 직후 0.3초 동안 손에서 물까지 포물선, 그 뒤 둥실거림. 입질 중이면 푹 잠기며 흔들린다
function bobberPos(e: Entity, fv: FishingView, now: number): [number, number, number] {
  const bx = fv.x * TILE + TILE / 2, by = fv.y * TILE + TILE / 2 + 2;
  const t = fv.since ? Math.min(1, (now - fv.since) / 300) : 1;
  const [hx, hy] = handPos(e);
  const bob = fv.bite ? 4 + Math.sin(now / 50) * 2 : Math.sin(now / 350 + fv.x) * 1.5;
  return [hx + (bx - hx) * t, hy + (by - hy) * t - Math.sin(t * Math.PI) * 12 + bob * t, t];
}
function drawBobber(ctx: CanvasRenderingContext2D, e: Entity, fv: FishingView, now: number): void {
  const [bx, by, t] = bobberPos(e, fv, now);
  if (t >= 1) {
    // 퍼져 나가는 물결. 입질 중에는 빠르고 크게
    const k = fv.bite ? (now / 400) % 1 : (now / 1600) % 1;
    ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - k)})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(bx, by + 2, 4 + k * (fv.bite ? 10 : 6), 2 + k * (fv.bite ? 5 : 3), 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = '#e8402a'; ctx.beginPath(); ctx.arc(bx, by, 3, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI); ctx.fill();
  ctx.strokeStyle = '#262626'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.stroke();
}
// 낚싯대(손 → 끝)와 늘어진 낚싯줄(끝 → 찌)
function drawRod(ctx: CanvasRenderingContext2D, e: Entity, fv: FishingView, now: number): void {
  const [hx, hy] = handPos(e);
  const [bx, by] = bobberPos(e, fv, now);
  const tx = hx + (bx - hx) * 0.5, ty = Math.min(hy, by) - 12;
  ctx.lineCap = 'round';
  // 낚싯대 색: 기본 나무색, 좋은 낚싯대 은색, 명품 낚싯대 금색
  const rodColor = fv.rod === 2 ? '#ffd84d' : fv.rod === 1 ? '#cfd8e3' : '#8a5a2b';
  ctx.strokeStyle = '#262626'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.strokeStyle = rodColor; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + bx) / 2, Math.max(ty, by) + 3, bx, by - 3); ctx.stroke();
  ctx.lineCap = 'butt';
}

// 화면 밖 목표(월드 px)를 가리키는 가장자리 화살표 + 이름표. 화면 중심에서 목표로 향하는 선이 화면 테두리(여백 안쪽)와 만나는 점에 그린다
function drawEdgeArrow(eng: Engine, wx: number, wy: number, label: string, now: number): void {
  const { ctx } = eng;
  const [tx, ty] = eng.worldToScreen(wx, wy);
  const cx = eng.w / 2, cy = eng.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return;
  const mx = 26, my = 26; // 테두리 여백
  const hw = eng.w / 2 - mx, hh = eng.h / 2 - my;
  const k = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6)); // 테두리까지의 비율
  const ax = cx + dx * k, ay = cy + dy * k;
  const ang = Math.atan2(dy, dx);
  const bob = Math.sin(now / 180) * 3; // 살짝 들썩
  ctx.save();
  ctx.translate(ax + Math.cos(ang) * bob, ay + Math.sin(ang) * bob);
  ctx.rotate(ang);
  ctx.fillStyle = '#ffd84d'; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -9); ctx.lineTo(-4, 0); ctx.lineTo(-8, 9); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
  // 이름표는 화살표 안쪽(화면 중심 쪽)에. 화면 밖으로 잘리지 않게 안쪽으로 민다
  ctx.font = 'bold 11px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const tw = ctx.measureText(label).width + 8;
  const lx = Math.max(tw / 2 + 4, Math.min(eng.w - tw / 2 - 4, ax - Math.cos(ang) * 22));
  const ly = Math.max(22, Math.min(eng.h - 6, ay - Math.sin(ang) * 22 + 8));
  drawLabel(ctx, label, lx, ly, '#ffe9a8', 'rgba(0,0,0,0.6)', 11);
}

// color 가 'rainbow' 면 흐르는 무지개 그라데이션. border 가 있으면 테두리를 두른다 (금테)
export function drawLabel(ctx: CanvasRenderingContext2D, text: string, cx: number, bottom: number, color: string, bg: string, size: number, border?: string): void {
  ctx.font = `bold ${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const w = ctx.measureText(text).width + 8;
  const h = size + 6;
  ctx.fillStyle = bg;
  roundRect(ctx, cx - w / 2, bottom - h, w, h, 4); ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.fillStyle = color === 'rainbow' ? rainbowGradient(ctx, cx - w / 2, cx + w / 2, performance.now()) : color;
  ctx.fillText(text, cx, bottom - 3);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function zigzagRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, amp = 2, step = 5): void {
  ctx.beginPath();
  let i = 0;
  const pts: [number, number][] = [];
  for (let px = x; px < x + w; px += step, i++) pts.push([px, y + (i % 2 ? -amp : amp)]);
  for (let py = y; py < y + h; py += step, i++) pts.push([x + w + (i % 2 ? -amp : amp), py]);
  for (let px = x + w; px > x; px -= step, i++) pts.push([px, y + h + (i % 2 ? -amp : amp)]);
  for (let py = y + h; py > y; py -= step, i++) pts.push([x + (i % 2 ? -amp : amp), py]);
  pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
}

const BUBBLE_STYLE: Record<BubbleKind, { fill: string; stroke: string; text: string }> = {
  near: { fill: '#ffffff', stroke: '#333333', text: '#222222' },
  all: { fill: '#fff6d8', stroke: '#b36b00', text: '#4a2c00' },
  w: { fill: '#f3e9ff', stroke: '#6b3fa0', text: '#3b1f5e' },
};

export function drawBubble(ctx: CanvasRenderingContext2D, b: Bubble, cx: number, bottom: number, s: number): void {
  const st = BUBBLE_STYLE[b.kind];
  const size = 12 + (s >= 2 ? 1 : 0);
  ctx.font = `${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  const maxW = 170;
  const lines = wrapText(ctx, b.text, maxW);
  const lh = size + 4;
  const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + 16;
  const h = lines.length * lh + 10;
  const x = cx - w / 2, y = bottom - h - 8;
  ctx.fillStyle = st.fill; ctx.strokeStyle = st.stroke; ctx.lineWidth = 1.5;
  ctx.setLineDash(b.kind === 'w' ? [4, 3] : []);
  if (b.kind === 'all') zigzagRect(ctx, x, y, w, h); else roundRect(ctx, x, y, w, h, 6);
  ctx.fill(); ctx.stroke();
  // 꼬리
  ctx.beginPath(); ctx.moveTo(cx - 5, y + h); ctx.lineTo(cx, y + h + 7); ctx.lineTo(cx + 5, y + h); ctx.closePath();
  ctx.fill(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(cx - 5, y + h); ctx.lineTo(cx, y + h + 7); ctx.lineTo(cx + 5, y + h); ctx.strokeStyle = st.stroke; ctx.stroke();
  ctx.fillStyle = st.fill; ctx.fillRect(cx - 4, y + h - 1, 8, 2);
  ctx.setLineDash([]);
  ctx.fillStyle = st.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, cx, y + 5 + i * lh));
}

function drawRoomSign(eng: Engine, z: Zone, rs: RoomState | undefined, serverNow: number): void {
  const { ctx } = eng;
  const s = eng.scale;
  const cx = (z.x + z.w / 2) * TILE;
  const topY = (z.y - 1) * TILE - 6;
  if (!eng.isTileVisible(z.x + z.w / 2, z.y, TILE * 3)) return;
  const [sx, sy] = eng.worldToScreen(cx, topY);
  const members = rs?.members ? Object.values(rs.members) : [];
  const cap = z.cap || rs?.cap || 0;
  const lines: { text: string; color: string }[] = [];
  const inResult = rs?.state === 'result' && rs.result;
  if (inResult && rs?.result) {
    const left = Math.max(0, Math.ceil((rs.result.at + ROOM_RESULT_MS - serverNow) / 1000));
    lines.push({ text: `☕ ${rs.result.loserNick} 당첨!`, color: '#ffd84d' });
    lines.push({ text: `${left}초 후 퇴장`, color: '#ffffff' });
  } else if (z.kind === 'casino') {
    lines.push({ text: `${z.label || ''}  ${members.length}/${cap}`, color: members.length >= cap ? '#ff9b9b' : '#ffd84d' });
    if (members.length) lines.push({ text: members.sort((a, b) => a.at - b.at).map((m) => m.n).join(' · '), color: '#dddddd' });
  } else {
    lines.push({ text: `${z.label || ''}  ${members.length}/${cap}`, color: members.length >= cap ? '#ff9b9b' : '#ffffff' });
    for (const m of members.sort((a, b) => a.at - b.at)) lines.push({ text: `${m.ready ? '✓' : '·'} ${m.n} (${m.losses}패)`, color: m.ready ? '#9be7ff' : '#dddddd' });
  }
  const size = 11 + (s >= 2 ? 1 : 0);
  ctx.font = `bold ${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  const w = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 14;
  const lh = size + 4;
  const h = lines.length * lh + 8;
  ctx.fillStyle = inResult ? 'rgba(90, 50, 0, 0.85)' : 'rgba(20, 30, 40, 0.8)';
  roundRect(ctx, sx - w / 2, sy - h, w, h, 5); ctx.fill();
  ctx.strokeStyle = inResult ? '#ffd84d' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => { ctx.fillStyle = l.color; ctx.fillText(l.text, sx, sy - h + 4 + i * lh); });
}

function drawPortalGround(ctx: CanvasRenderingContext2D, z: Zone, now: number): void {
  const cx = (z.x + z.w / 2) * TILE;
  const cy = (z.y + z.h / 2) * TILE;
  const rx = Math.max(8, (z.w * TILE) / 2 - 3);
  const ry = Math.max(6, (z.h * TILE) / 2 - 3);
  const t = now / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.5);

  ctx.save();
  // 어두운 신비로운 베이스 원
  ctx.fillStyle = 'rgba(18, 12, 44, 0.7)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // 내부 소용돌이 / 마법진 (에메랄드/시안 그라데이션)
  const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, rx);
  grad.addColorStop(0, `rgba(165, 243, 252, ${0.85 + 0.15 * pulse})`);
  grad.addColorStop(0.45, `rgba(56, 189, 248, ${0.65 + 0.2 * pulse})`);
  grad.addColorStop(0.8, `rgba(99, 102, 241, ${0.45 + 0.15 * pulse})`);
  grad.addColorStop(1, 'rgba(67, 56, 202, 0.1)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx - 2, ry - 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // 회전하는 룬 대시 테두리
  ctx.strokeStyle = `rgba(147, 197, 253, ${0.7 + 0.3 * pulse})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.lineDashOffset = -t * 18;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx - 1, ry - 1, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 내부 룬 링
  ctx.strokeStyle = `rgba(196, 181, 253, ${0.5 + 0.3 * pulse})`;
  ctx.setLineDash([3, 5]);
  ctx.lineDashOffset = t * 14;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 피어오르는 미세 반짝이 파티클
  for (let i = 0; i < 4; i++) {
    const seed = z.x * 17 + z.y * 31 + i * 23;
    const pLife = (now * 0.05 + seed) % 30;
    const pFrac = pLife / 30;
    const pAng = (seed % 10) + t * 2 + i * 1.5;
    const px = cx + Math.cos(pAng) * (rx * 0.5 * (1 - pFrac * 0.3));
    const py = cy - pFrac * 16 + Math.sin(pAng) * (ry * 0.3);
    const alpha = (1 - pFrac) * (0.6 + 0.4 * pulse);
    ctx.fillStyle = i % 2 === 0 ? `rgba(165, 243, 252, ${alpha})` : `rgba(224, 231, 255, ${alpha})`;
    ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 2, 2);
  }

  ctx.restore();
}
