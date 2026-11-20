import { TILE, BUBBLE_MS, EMOTE_MS } from '../shared/config';
import type { Dir, RoomState } from '../shared/types';
import { wrapText } from '../shared/util';
import type { Engine } from './engine';
import { G, O, G_DANCE, TALL_OBJECTS, waterDepth, type MapData, type Zone } from './map';
import type { DayTint } from '../shared/daylight';
import { groundTile, objectSprite, seasonTree } from './tiles';
import { PARROT_ID, parrotEcho } from '../shared/shop';
import { goldNugget, drawGoldSparks } from './goldart';
import { getSprite, FRAME_W, FRAME_H, type Pose } from './sprites';
import type { FishingView } from './fishing';
import type { BugView } from './bugs';
import type { TossView } from './toss';
import type { SnowView } from './winterplay';
import { snowActive, SNOW_PENALTY_TITLE } from '../shared/snowpenalty';
import { LABEL_FADE, standsBelow, inRowBelow } from '../shared/overlap';
import { bubbleFont, hasBubbleSkin, paintBubble } from './bubbles';
import { drawHat, hatAbove, nameStyle, titleStyle, isLabelFlow, labelFlow, spawnFx, drawFx, drawPet, drawMount, mountInfo, drawAfterimages, AFTERIMAGE_FX } from './cosmetics';

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
  pushAt: number;     // 밀침 당한 시각
  hitAt: number;      // 말랑이에 맞은 시각 (1초 동안 😵 + 흔들림)
  blockAt: number;    // 갑옷으로 막은 시각 (1초 동안 🛡)
  pushDir: Dir;
  fishing: FishingView | null; // 낚시 중이면 찌 위치
  hat: string | null;          // 꾸미기 (상점)
  nameColor: string | null;
  fx: string | null;
  title?: string | null;       // 칭호 품목 id (닉네임 바로 위에 뜬다)
  bubbleSkin?: string | null;  // 말풍선 꾸미기 품목 id (일반 채팅 말풍선에만. bubbles.ts)
  sit?: boolean;               // 앉아 있다: 다리를 가리고 조금 내려 그린다 (x, y 는 앉은 가구의 칸)
  dance?: number;              // 클럽에서 추는 춤 (1~9: 이모트 번호마다 다른 춤)
  pet: PetView | null;         // 데리고 다니는 펫 (한 칸 뒤)
  ghost?: boolean;             // 마피아 유령: 반투명 (유령에게만 보임. 산 사람 화면에는 아예 안 들어온다)
  mining?: boolean;            // 금광에서 곡괭이질 중 (곡괭이를 휘두르는 모습)
  snowReady?: boolean;         // 스키 장갑으로 눈을 뭉쳐 손에 들고 있다 (내 캐릭터에만. 이 브라우저에만 있는 상태라 남에게는 안 보인다)
  progress?: { p: number; parts: number }; // 머리 위 진행 막대 (나무 캐는 중. p: 0~1, parts: 눈금 칸 수)
  snowBrokenAt?: number;       // 눈사람을 부순 서버 시각. SNOW_PENALTY_MS 동안 닉네임 바로 위에 빨간 칭호 (판단은 st.serverNow 로: 기기 시계·프레임 시계가 아니다)
}
// 마피아 시체: 죽은 자리에 누운 아바타
export interface BodyView { uid: string; avatar: string; nick: string; x: number; y: number }
// 펫 표시: 타일 좌표(보간), 이동 중 여부·진행, 마지막 점프(벌레 잡기) 시각. scale: 레벨에 따른 크기 (2026-11-10), ride: 주인이 타고 있다 (주인 발밑에 그린다)
export interface PetView { id: string; x: number; y: number; moving: boolean; moveT: number; hopAt: number; dir: Dir; scale: number; ride: boolean; look?: import('./cosmetics').PetLook | null; drawX?: number; drawTop?: number } // look: 꾸미기·이름·고유 동작 (2026-11-20)
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
  fires?: { x: number; y: number }[];                  // 불 (모닥불·마피아 사보타지. 타일 좌표). 밤에는 둘레가 밝다
  alerts?: { x: number; y: number; label: string }[];  // 급한 자리 (마피아의 불): 화면 밖이면 가장자리 화살표, 안이면 그 위에 이름
  fog?: { x: number; y: number; r: number } | null;    // 마피아 안개: 내 캐릭터(타일 좌표) 둘레 r 칸만 보인다
  snow?: SnowView[];  // 겨울 맵의 눈덩이·눈사람 (내 화면에만 있는 장난감, 클라이언트 로컬)
  objAt?: (x: number, y: number, id: number) => number; // 그 칸에 실제로 그릴 오브젝트 (벤 나무는 그루터기·덤불로. 맵 데이터는 그대로라 길은 계속 막힌다)
  plaques?: { x: number; y: number; icon: string; text: string; sub?: string; img?: CanvasImageSource | null; frame?: number; show?: boolean }[]; // 집 벽에 건 물고기 박제·사진 액자 (타일 좌표). text 이름, sub 크기(둘째 줄). img 가 있으면 사진 액자(frame 1 나무 · 2 금테)
  roamers?: PetView[]; // 집 안을 돌아다니는 펫 (homepets.ts)
  night?: DayTint | null; // 낮밤 덧칠 (바깥 맵만. shared/daylight.ts)
  treeLook?: 'autumn' | 'blossom' | null; // 계절 나무: 단풍·벚꽃 (shared/season.ts. 소나무는 그대로)
  rain?: { level: number; snow: boolean } | null; // 비 (0~1. 겨울 맵에서는 눈으로 그린다. shared/weather.ts)
  club?: { x: number; y: number; w: number; h: number; bpm: number; dancers: PetView[] } | null; // 클럽: 춤추는 바닥의 자리, 박자, 춤추는 펫 (어둡게 깔고 색 조명을 돌린다)
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
    if (id === G_DANCE) { drawDanceTile(ctx, x, y, st.now, st.club?.bpm ?? 126); continue; }
    const variant = (x * 7 + y * 13) % 3;
    ctx.drawImage(groundTile(id, variant, id === G.WATER ? waterFrame : 0), x * TILE, y * TILE);
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
    const raw = map.objects[y * map.w + x];
    if (!raw) continue;
    const id = st.objAt ? st.objAt(x, y, raw) : raw;
    const spr = id === O.TREE && st.treeLook ? seasonTree(st.treeLook, (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) // 계절 나무: 칸마다 빛깔이 조금 다르다
      : objectSprite(id, map.dirs?.[y * map.w + x] ?? 0); // 집 안의 돌려 놓은 가구는 그 방향 그림으로
    if (!spr) continue;
    const tall = TALL_OBJECTS.has(id);
    items.push({ sortY: y + 0.9, order: 0, draw: () => ctx.drawImage(spr.cv, x * TILE, y * TILE - (tall ? TILE : 0)) });
  }
  // 집 벽의 물고기 박제: 나무 판에 물고기 그림, 아래에 이름과 크기
  for (const p of st.plaques ?? []) items.push({ sortY: p.y + 0.95, order: 1, draw: () => {
    const px = p.x * TILE, py = p.y * TILE;
    if (p.frame) {
      // 사진 액자 (2026-11-20): 나무(1)·금테(2) 틀 안에 사진을 가운데 맞춰 잘라 넣는다. 아직 못 받았으면 빈 종이
      const gold = p.frame === 2;
      ctx.fillStyle = gold ? '#b8860b' : '#5a3a1e'; roundRect(ctx, px + 2, py + 2, TILE - 4, TILE - 6, 3); ctx.fill();
      ctx.fillStyle = gold ? '#ffd84d' : '#8a5a2e'; roundRect(ctx, px + 3, py + 3, TILE - 6, TILE - 8, 3); ctx.fill();
      if (gold) { ctx.fillStyle = '#fff2a8'; ctx.fillRect(px + 4, py + 3, TILE - 8, 1); }
      const ix = px + 5, iy = py + 5, iw = TILE - 10, ih = TILE - 12;
      ctx.fillStyle = '#f4ead2'; ctx.fillRect(ix, iy, iw, ih);
      const im = p.img as (CanvasImageSource & { naturalWidth?: number; naturalHeight?: number }) | null | undefined;
      if (im && im.naturalWidth && im.naturalHeight) {
        const ar = iw / ih, sw = Math.min(im.naturalWidth, im.naturalHeight * ar), sh = sw / ar;
        const was = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
        ctx.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, ix, iy, iw, ih);
        ctx.imageSmoothingEnabled = was;
      }
      return;
    }
    ctx.fillStyle = '#6e4620'; roundRect(ctx, px + 3, py + 3, TILE - 6, TILE - 8, 4); ctx.fill();
    ctx.fillStyle = '#f4ead2'; roundRect(ctx, px + 5, py + 5, TILE - 10, TILE - 12, 3); ctx.fill();
    ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#222';
    ctx.fillText(p.icon, px + TILE / 2, py + TILE / 2 - 1);
  } }); // 이름·크기 글자는 아래 화면 좌표에서 닉네임 이름표와 같은 크기로 그린다
  // 금광의 거대한 금덩어리: 큰 그림 한 장. 아랫줄 기준으로 정렬해 위쪽에 선 사람은 뒤에, 아래쪽에 선 사람은 앞에 온다
  for (const z of map.zones) if (z.kind === 'mine') {
    if (!eng.isTileVisible(z.x + z.w / 2 - 0.5, z.y + z.h / 2 - 0.5, TILE * Math.max(z.w, z.h))) continue;
    const art = goldNugget(z.w, z.h);
    items.push({ sortY: z.y + z.h - 0.05, order: 0, draw: () => { ctx.drawImage(art.cv, z.x * TILE, z.y * TILE - art.over); drawGoldSparks(ctx, art, z.x * TILE, z.y * TILE - art.over, st.now); } });
  }
  // 이름표·말풍선 위치용: 물속에서 가라앉은 픽셀(sink), 보이는 발끝(물속이면 수면)이 타일 아래 끝에서 벗어난 픽셀(feet), 모자가 프레임 위로 솟은 픽셀(above)
  const posByUid = new Map<string, { sink: number; feet: number; above: number }>();
  for (const e of st.entities) {
    const px = e.x * TILE + (TILE - FRAME_W) / 2;
    let py = e.y * TILE + TILE - FRAME_H;
    let frame = e.moving ? Math.floor(e.moveT * 4) & 3 : 0;
    if (e.fx && e.moving) spawnFx(e.uid, e.fx, e.x * TILE + TILE / 2, e.y * TILE + TILE - 3, st.now);
    let pose = e.pose;
    let ddir = e.dir;
    const pt = (st.now - e.poseAt) / EMOTE_MS;
    if (pose !== 'none' && pt > 1) pose = 'none';
    let ox = 0;
    if (e.dance) {
      // 클럽의 춤 (2026-11-18): 이모트 번호마다 다른 춤. 그림은 있는 포즈를 돌려 쓰고 움직임(좌우·위아래·방향)으로 구분한다
      const t = st.now + (e.x * 37 + e.y * 53) * 10; // 사람마다 조금 어긋나게
      switch (e.dance) {
        case 1: pose = 'wave'; ox = Math.sin(t / 160) * 3; py += Math.floor(t / 160) % 2; break;                                   // 손 흔들기
        case 2: pose = 'jump'; py -= Math.abs(Math.sin(t / 170)) * 9; ddir = 0; break;                                            // 제자리 뛰기
        case 3: pose = 'dance'; ddir = ([0, 2, 3, 1] as Dir[])[Math.floor(t / 110) % 4]; break;                                   // 빙글빙글
        case 4: { pose = 'none'; ddir = 1; const k = (t / 700) % 2; ox = (k < 1 ? k : 2 - k) * 10 - 5; frame = Math.floor(t / 110) & 3; break; } // 문워크
        case 5: pose = 'laugh'; py += Math.abs(Math.sin(t / 85)) * 4; ddir = 0; break;                                            // 머리 흔들기
        case 6: pose = 'dance'; ddir = 0; py -= Math.sin(t / 200) * 3; ox = Math.cos(t / 200) * 2; break;                         // 물결
        case 7: pose = 'none'; ddir = Math.floor(t / 240) % 2 ? 1 : 2; ox = Math.floor(t / 120) % 2 ? 2 : -2; py -= Math.abs(Math.sin(t / 120)) * 2; frame = Math.floor(t / 120) & 3; break; // 셔플
        case 8: pose = 'heart'; py -= Math.abs(Math.sin(t / 230)) * 5; ddir = 0; break;                                           // 하트
        default: pose = 'dance'; ddir = ([0, 1, 0, 2] as Dir[])[Math.floor(t / 220) % 4]; py += Math.floor(t / 110) % 2;          // 9: 기본 춤
      }
    }
    if (pose === 'jump' && !e.dance) py -= Math.round(Math.sin(Math.min(1, pt) * Math.PI) * 10);
    if (pose === 'dance' && !e.dance) { ddir = ([0, 1, 0, 2] as Dir[])[Math.floor(st.now / 220) % 4]; py += Math.floor(st.now / 110) % 2; }
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
    // 앉은 모습 (2026-11-19 수정, 사용자 제보: 앉는 위치가 어색하다): 엉덩이가 가구의 앉는 면에 오게 올려 그린다.
    // 전에는 다리 8줄을 가리고 5px 내려 그려서 가구 앞 바닥에 주저앉은 것처럼 보였다 (보이는 아랫단이 의자 다리 높이에 왔다).
    // 다리는 몸 높이의 30% 만큼만 가린다 (탑승과 같은 식: 키 작은 동물·음식 캐릭터가 반쯤 잘리지 않게).
    // 옆을 보는 가구면 등받이 반대쪽(앉는 면)으로 조금 옮기고, 뒤를 보는 가구면 등받이 뒤에 그려 머리만 보이게 한다
    let sitOff = 0, sitBack = false;
    if (e.sit && depth <= 0 && !rideShown) {
      hide = Math.min(8, Math.round((FRAME_H - spriteTop(spr)) * 0.3));
      sitBack = e.dir === 3;
      sitOff = (sitBack ? SEAT_BACK_Y : SEAT_Y) - TILE + hide;
      py += sitOff; ox += e.dir === 1 ? -SEAT_SIDE_X : e.dir === 2 ? SEAT_SIDE_X : 0;
    }
    posByUid.set(e.uid, { sink: sink - lift + sitOff, feet: sink + visibleH - FRAME_H, above });
    // 찌는 물 타일 위에, 캐릭터보다 뒤에 그린다
    if (e.fishing) { const fv = e.fishing; items.push({ sortY: fv.y + 0.5, order: 1, draw: () => drawBobber(ctx, e, fv, st.now) }); }
    // 펫: 자기 타일의 y 순서로 (주인과 겹치면 주인보다 앞뒤가 자연스럽게)
    if (e.pet && !ride) {
      const p = e.pet;
      if (p.look?.perch && e.sit && depth <= 0) {
        // 주인이 앉아 있으면 머리 위에 올라앉는다 (2026-11-20 사용자 요청). 주인(과 모자) 바로 다음에 그린다. drawX·drawTop: 이름표 자리 (월드 좌표)
        const headY = Math.round(py) + sink + spriteTop(spr) - above, hcx = Math.round(px + ox) + FRAME_W / 2;
        p.drawX = hcx; p.drawTop = headY + 3 - Math.round(10 * p.scale);
        items.push({ sortY: e.y + (sitBack ? 0.86 : 1.01), order: 1, draw: () => drawPet(ctx, p.id, (hcx - TILE / 2) / TILE, (headY + 6 - TILE) / TILE, TILE, st.now, false, 0, p.hopAt, e.dir, p.scale, false, !!st.club, p.look) });
      } else items.push({ sortY: p.y + 0.95, order: 1, draw: () => drawPet(ctx, p.id, p.x, p.y, TILE, st.now, p.moving, p.moveT, p.hopAt, p.dir, p.scale, false, !!st.club, p.look) });
    }
    items.push({
      sortY: e.y + (sitBack ? 0.85 : 1), order: 1, draw: () => { // 뒤를 보는 가구에 앉았으면 그 가구(y + 0.9)보다 먼저 그린다
        const cx = e.x * TILE + TILE / 2;
        if (depth < 1 && !e.sit) { // 앉아 있을 때는 바닥 그림자를 그리지 않는다 (가구 밑에 깔린다)
          ctx.fillStyle = `rgba(0,0,0,${0.22 * (1 - depth)})`;
          ctx.beginPath(); ctx.ellipse(cx, e.y * TILE + TILE - 2, rideShown ? 13 : 9, rideShown ? 4.5 : 3.5, 0, 0, Math.PI * 2); ctx.fill();
          if (e.isMe) { ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - depth)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cx, e.y * TILE + TILE - 2, rideShown ? 15 : 11, rideShown ? 5.5 : 4.5, 0, 0, Math.PI * 2); ctx.stroke(); }
        }
        let dx = Math.round(px + ox), dy = Math.round(py) + sink;
        if (rideShown && e.pet) {
          const mp = drawMount(ctx, e.pet.id, e.x, e.y, TILE, st.now, e.moving, e.moveT, e.pet.hopAt, e.dir);
          if (mp) { dx += mp.ox; dy = mp.seatY - (FRAME_H - hide) + (Math.round(py) - (e.y * TILE + TILE - FRAME_H)); } // 포즈(점프 등)로 움직인 만큼은 그대로
        }
        // 샤샤샥: 지나온 자리의 잔상을 먼저 그리고 그 위에 캐릭터 (물속·마피아 유령은 제외)
        if (e.fx === AFTERIMAGE_FX && depth <= 0 && !e.ghost) drawAfterimages(ctx, e.uid, st.now, e.moving, spr, dx, dy, FRAME_H - hide, e.hat, spriteTop(spr), ddir);
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
        if (e.mining) drawPickaxe(ctx, e, st.now);
        if (e.snowReady) { const [hx, hy] = handPos(e); snowOrb(ctx, hx, hy + 4, 3); }
        ctx.globalAlpha = 1;
      },
    });
  }
  // 클럽의 춤추는 펫: 박자에 맞춰 뛰고(hopAt 을 박자 머리로) 두 박마다 좌우를 바꾼다. 선글라스를 낀다
  if (st.club) {
    const beat = 60000 / st.club.bpm;
    st.club.dancers.forEach((p, i) => {
      const off = (i % 2) * (beat / 2), k = Math.floor((st.now + off) / beat);
      items.push({ sortY: p.y + 0.95, order: 1, draw: () => drawPet(ctx, p.id, p.x, p.y, TILE, st.now, false, 0, k * beat - off, ((k + i) % 4 < 2 ? 2 : 1) as Dir, p.scale, false, true) });
    });
  }
  // 집 안을 돌아다니는 펫: 따라다니는 펫과 같은 그림, 자기 칸의 y 순서로
  for (const p of st.roamers ?? []) items.push({ sortY: p.y + 0.95, order: 1, draw: () => drawPet(ctx, p.id, p.x, p.y, TILE, st.now, p.moving, p.moveT, p.hopAt, p.dir, p.scale, false, false, p.look) });
  // 눈덩이·눈사람: 칸 아랫줄 기준으로 정렬해 사람과 앞뒤가 맞는다
  for (const sv of st.snow || []) {
    if (!eng.isTileVisible(sv.x, sv.y, TILE)) continue;
    items.push({ sortY: sv.y + 0.85, order: 0, draw: () => (sv.kind === 'man' ? drawSnowman(ctx, sv.x * TILE + TILE / 2, sv.y * TILE + TILE - 3) : drawSnowball(ctx, sv.x * TILE + TILE / 2, sv.y * TILE + TILE - 3, sv.large ? 11 : 5 + sv.rolls)) });
  }
  for (const f of st.fires ?? []) { if (!eng.isTileVisible(f.x, f.y, TILE)) continue; items.push({ sortY: f.y + 0.9, order: 0, draw: () => drawFire(ctx, f.x * TILE, f.y * TILE, st.now + (f.x * 37 + f.y * 91) * 13) }); }
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
    if (t.snow) { snowOrb(ctx, x, y + 4, 4); continue; } // 스키 장갑 눈덩이
    ctx.font = `${t.icon ? 16 : 13}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t.icon || '🧸', x, y);
  }

  // ---- 낮과 밤: 이름표·말풍선·안내보다 먼저 덧칠한다 (글자는 어두워지지 않는다) ----
  if (st.night && st.night.a > 0.005) drawNight(eng, map, vis, st.night, st.fires);
  if (st.club) drawClubLights(eng, st.club, st.now);

  // ---- 화면 좌표 오버레이 ----
  eng.beginScreen();
  const s = eng.scale;
  if (st.rain && st.rain.level > 0.01) drawRain(eng, st.now, st.rain.level, st.rain.snow); // 이름표·말풍선보다 먼저 (글자를 가리지 않게)
  // 방 간판
  for (const z of map.zones) if (z.kind === 'casino') drawRoomSign(eng, z, st.rooms[z.id]);
  // 포탈 간판/라벨
  for (const z of map.zones) if (z.kind === 'portal') {
    if (!eng.isTileVisible(z.x + z.w / 2 - 0.5, z.y + z.h / 2 - 0.5, TILE * 2)) continue;
    const [sx, sy] = eng.worldToScreen((z.x + z.w / 2) * TILE, z.y * TILE);
    drawLabel(ctx, `🌀 ${z.label || '포탈'}`, sx, sy - 6 * s, '#dbeafe', 'rgba(15, 23, 42, 0.75)', 11, '#60a5fa');
  }
  // 마피아 미션: 화면 밖의 내 미션은 가장자리 화살표 + 이름 (2026-11-10)
  if (st.marks?.mine) for (const m of st.marks.spots) if (!eng.isTileVisible(m.x + m.w / 2 - 0.5, m.y + m.h / 2 - 0.5, -TILE / 2)) drawEdgeArrow(eng, (m.x + m.w / 2) * TILE, (m.y + m.h / 2) * TILE, m.label, st.now);
  // 펫 이름 (2026-11-20): 펫 바로 아래에 작게 (같은 날 사용자 요청으로 머리 위 → 아래. 맵과 함께 커지지 않게 화면 좌표에서). 타고 있을 때는 그리지 않는다.
  // 주인 머리 위에 올라앉은 펫은 아래가 주인 얼굴이라 펫 위에 그린다.
  // 펫 바로 아래 칸에 누가 서 있을 때도 위에 그린다 (같은 날 밤 사용자 제보: 펫이 주인의 북쪽에 있으면 이름이 주인 얼굴을 덮었다. shared/overlap.ts)
  for (const p of [...st.entities.map((e) => e.pet), ...(st.roamers ?? [])]) {
    if (!p || p.ride || !p.look?.name) continue;
    if (p.drawX !== undefined && p.drawTop !== undefined) { const [nx, ny] = eng.worldToScreen(p.drawX, p.drawTop - (p.look.hat ? Math.round(4 * p.scale) : 0)); drawLabel(ctx, p.look.name, nx, ny - 2, '#fff7d6', 'rgba(0,0,0,0.45)', 9); continue; }
    if (st.entities.some((e) => standsBelow(p.x, p.y, e.x, e.y))) {
      const [ax, ay] = eng.worldToScreen((p.x + 0.5) * TILE, (p.y + 1) * TILE - 3 - Math.round(10 * p.scale) - (p.look.hat ? Math.round(4 * p.scale) : 0)); // 펫(과 모자)의 머리 꼭대기
      drawLabel(ctx, p.look.name, ax, ay - 2, '#fff7d6', 'rgba(0,0,0,0.45)', 9);
      continue;
    }
    const [nx, ny] = eng.worldToScreen((p.x + 0.5) * TILE, (p.y + 1) * TILE);
    drawLabel(ctx, p.look.name, nx, ny + 14, '#fff7d6', 'rgba(0,0,0,0.45)', 9);
  }
  for (const a of st.alerts ?? []) {
    if (!eng.isTileVisible(a.x, a.y, -TILE / 2)) drawEdgeArrow(eng, (a.x + 0.5) * TILE, (a.y + 0.5) * TILE, a.label, st.now);
    else { const [ax, ay] = eng.worldToScreen((a.x + 0.5) * TILE, a.y * TILE); drawLabel(ctx, a.label, ax, ay - 4 * s, '#ffd9b0', 'rgba(70, 14, 0, 0.75)', 12, '#ff7a3c'); }
  }
  // 집 벽의 물고기 박제 이름: 액자 바로 아래 (2026-11-18 사용자 요청. 전에는 맵과 함께 확대돼 글자가 컸다). 옆 칸에 붙어 걸린 것은 한 줄 내려 겹치지 않게.
  // 그 액자를 눌렀을 때만 잠깐 그린다 (show. 2026-11-20 사용자 요청: 늘 떠 있으면 벽 아래에 선 캐릭터를 가린다)
  {
    let prevX = -9, prevLow = false;
    for (const p of [...(st.plaques ?? [])].sort((a, b) => a.x - b.x)) {
      if (!p.show || (!p.text && !p.sub)) continue; // 누르지 않은 박제·사진 액자는 글자가 없다 (옆 자리의 글자를 내릴 필요도 없다)
      const low: boolean = p.x - prevX === 1 && !prevLow;
      const [lx, ly] = eng.worldToScreen(p.x * TILE + TILE / 2, p.y * TILE + TILE - 5); // 액자의 아랫변
      // 2026-11-20 사용자 요청: 글자를 작게(12 → 9px), 이름과 크기를 두 줄로 (옆으로 길어지지 않게)
      const base = ly + 16 + (low ? 30 : 0);
      if (p.text) drawLabel(ctx, p.text, lx, base, '#ffffff', 'rgba(0,0,0,0.55)', 9);
      if (p.sub) drawLabel(ctx, p.sub, lx, base + (p.text ? 14 : 0), '#ffe9a8', 'rgba(0,0,0,0.55)', 9);
      prevX = p.x; prevLow = low;
    }
  }
  // 이름표 묶음(벌칙 칭호·칭호·이름)의 아래 끝 (화면 y). 아래 줄을 가리키는 안내 글자가 여기서부터 내려간다
  const autoBelow = (e: Entity): boolean => !!e.fishing && (!!e.fishing.auto || !!e.fishing.stars) && standsBelow(e.x, e.y, e.fishing.x, e.fishing.y); // 남쪽으로 던진 찌의 "자동 ★n" 은 이름표 아래에 붙는다
  const stackBottom = (e: Entity): number => {
    const [, feet] = eng.worldToScreen(0, e.y * TILE + TILE + (posByUid.get(e.uid)?.feet ?? 0));
    return feet + 2 + 18 + (snowActive(e.snowBrokenAt, st.serverNow) ? 17 : 0) + (titleStyle(e.title) ? 16 : 0) + (autoBelow(e) ? 17 : 0);
  };
  // 힌트
  if (st.hint) {
    const [sx, sy] = eng.worldToScreen(st.hint.x * TILE + TILE / 2, st.hint.y * TILE);
    const me = st.entities.find((e) => e.isMe);
    if (me && inRowBelow(me.x, me.y, st.hint.x, st.hint.y)) {
      // 내 아래 줄을 가리키는 안내 (남쪽을 보고 있다): 대상 칸 위에 그리면 내 캐릭터를 덮는다. 내 이름표 아래로 내린다 (대상 칸의 아래쪽보다 위로는 올리지 않는다)
      const [, tileBottom] = eng.worldToScreen(0, (st.hint.y + 1) * TILE);
      drawLabel(ctx, st.hint.text, sx, Math.max(tileBottom - 4, stackBottom(me) + 22), '#ffe9a8', 'rgba(0,0,0,0.65)', 12);
    } else drawLabel(ctx, st.hint.text, sx, sy - 10 * s, '#ffe9a8', 'rgba(0,0,0,0.65)', 12);
  }
  // 이름표/말풍선/이모트 (y 순서대로, 아래 있는 캐릭터가 위에 그려짐)
  const ents = [...st.entities].sort((a, b) => a.y - b.y);
  for (const e of ents) {
    const pos = posByUid.get(e.uid) || { sink: 0, feet: 0, above: 0 };
    // 이름표는 발 아래(물속이면 수면 아래). 점프해도 그림자처럼 제자리. 파티 이름은 그 아래
    const [sx, syFeet] = eng.worldToScreen(e.x * TILE + TILE / 2, e.y * TILE + TILE + pos.feet);
    const ns = nameStyle(e.nameColor);
    const nameColor = ns ? ns.color : e.isMe ? '#ffe9a8' : '#ffffff';
    const name = e.nick;
    let under = syFeet + 2 + 18; // drawLabel 은 라벨의 아래쪽 y 를 받는다 (높이 = 글자 크기 + 6)
    // 바로 아래 칸에 누가 서 있으면 내 이름표 묶음이 그 사람 머리를 덮는다: 비치게 그린다 (2026-11-20 사용자 제보. shared/overlap.ts)
    const fade = ents.some((o) => o !== e && standsBelow(e.x, e.y, o.x, o.y)) ? LABEL_FADE : undefined;
    // 눈사람을 부순 벌칙 칭호: 닉네임 바로 위에 딱 붙인다 (2026-11-18 사용자 요청. 전에는 머리 위였다). 칭호가 이름표 자리에 오고 이름표는 그만큼 내려간다 (캐릭터를 가리지 않게)
    if (snowActive(e.snowBrokenAt, st.serverNow)) { drawLabel(ctx, SNOW_PENALTY_TITLE, sx, under - 1, '#ffffff', 'rgba(185, 28, 28, 0.92)', 11, '#fecaca', fade); under += 17; }
    // 칭호 (상점): 닉네임 바로 위. 눈사람 칭호가 있으면 그 아래
    const ts = titleStyle(e.title);
    if (ts) { drawLabel(ctx, ts.text, sx, under - 1, ts.color, ts.bg, 10, ts.border, fade); under += 16; }
    drawLabel(ctx, name, sx, under, nameColor, ns?.bg ?? 'rgba(0,0,0,0.55)', 12, ns?.border, fade);
    // 머리 위: 😵 · 입질 · 이모트 · 말풍선. 물속이면 가라앉은 만큼 내려가고, 모자가 프레임 위로 솟았으면 그만큼 올라간다
    const [, syTop] = eng.worldToScreen(e.x * TILE + TILE / 2, e.y * TILE + TILE - FRAME_H + pos.sink - pos.above);
    let top = syTop - 4;
    // 진행 막대 (나무 캐는 중): 머리 바로 위. 이모트·말풍선은 그 위로 올라간다
    if (e.progress) { drawProgress(ctx, sx, top, e.progress.p, e.progress.parts, s); top -= Math.round(6 * s) + 6; }
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
      // 남쪽으로 던졌으면 찌 위는 내 다리다: 이름표 바로 아래에 한 줄로 붙인다 (2026-11-20. 연못 위쪽 벤치에서 낚으면 늘 이 방향이다)
      if (autoBelow(e)) drawLabel(ctx, txt, sx, under + 17, e.fishing.stars ? '#ffd84d' : '#cfe9dc', 'rgba(0,0,0,0.5)', 9);
      else drawLabel(ctx, txt, bx, by - 4 * s, e.fishing.stars ? '#ffd84d' : '#cfe9dc', 'rgba(0,0,0,0.5)', 9);
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
    const box = e.bubble && st.now - e.bubble.at < BUBBLE_MS ? drawBubble(ctx, e.bubble, sx, top - 2, s, e.bubbleSkin, st.now) : null;
    // 앵무새 (2026-11-19): 주인이 말하면 조금 뒤에 끝말을 따라 한다. 이 화면에 뜬 말풍선에서 만드는 것이라 서버로 가는 것은 없다 (귓속말은 따라 하지 않는다)
    if (box && e.pet?.id === PARROT_ID && e.bubble && e.bubble.kind !== 'w') {
      const age = st.now - e.bubble.at;
      const echo = age > PARROT_DELAY_MS && age < PARROT_DELAY_MS + PARROT_ECHO_MS ? parrotEcho(e.bubble.text) : '';
      // 주인 말풍선의 오른쪽 위에 작은 딱지로 붙인다 (앵무새는 주인 뒤·옆 어디에나 있어서, 앵무새 머리 위에 띄우면 주인 말풍선과 겹친다)
      if (echo) drawEcho(ctx, `🦜 ${echo}`, box.x + box.w - 6, box.y + 4, s);
    }
  }
  // 마피아 안개: 맨 마지막에 덮는다 (남의 이름표·말풍선·화살표도 가린다. 화면 위쪽 표시와 채팅은 DOM 이라 그대로 보인다)
  if (st.fog) drawFog(eng, st.fog);
}

// 불 (모닥불·마피아 사보타지): 장작 위에서 네 장면으로 일렁인다. 타일 왼쪽 위 좌표
function drawFire(ctx: CanvasRenderingContext2D, px: number, py: number, now: number): void {
  const f = Math.floor(now / 140) % 4, h = [14, 17, 15, 18][f], lean = [0, 1, 0, -1][f], top = py + 25 - h;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(px + 6, py + 28, 20, 2);
  ctx.fillStyle = '#5a3a1e'; ctx.fillRect(px + 7, py + 25, 18, 3); ctx.fillStyle = '#7a5230'; ctx.fillRect(px + 9, py + 23, 14, 2); ctx.fillStyle = '#3d2712'; ctx.fillRect(px + 6, py + 27, 20, 1);
  ctx.fillStyle = '#e8501c'; ctx.fillRect(px + 10, top + 6, 12, h - 6); ctx.fillRect(px + 12 + lean, top + 2, 8, 5); ctx.fillRect(px + 14 + lean * 2, top, 4, 3);
  ctx.fillStyle = '#ffa32b'; ctx.fillRect(px + 12, top + 9, 8, h - 9); ctx.fillRect(px + 13 + lean, top + 5, 6, 5);
  ctx.fillStyle = '#ffe36b'; ctx.fillRect(px + 14, top + 12, 4, h - 12);
  const rise = Math.floor(now / 60) % 12;
  ctx.fillStyle = 'rgba(255, 205, 100, 0.9)'; ctx.fillRect(px + 9 + (Math.floor(now / 200) % 14), top - rise, 1, 1); ctx.fillRect(px + 21 - (Math.floor(now / 260) % 9), top + 4 - rise, 1, 1);
}

let fogCv: HTMLCanvasElement | null = null;
function drawFog(eng: Engine, f: { x: number; y: number; r: number }): void {
  const { ctx, canvas } = eng;
  const k = eng.scale * eng.dpr;
  if (!fogCv) fogCv = document.createElement('canvas');
  if (fogCv.width !== canvas.width || fogCv.height !== canvas.height) { fogCv.width = canvas.width; fogCv.height = canvas.height; }
  const fc = fogCv.getContext('2d')!;
  fc.globalCompositeOperation = 'source-over';
  fc.clearRect(0, 0, fogCv.width, fogCv.height);
  fc.fillStyle = 'rgb(206, 213, 222)'; fc.fillRect(0, 0, fogCv.width, fogCv.height);
  const cx = ((f.x + 0.5) * TILE - eng.cam.x) * k, cy = ((f.y + 0.3) * TILE - eng.cam.y) * k, r = f.r * TILE * k;
  fc.globalCompositeOperation = 'destination-out';
  const g = fc.createRadialGradient(cx, cy, r * 0.45, cx, cy, r);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  fc.fillStyle = g; fc.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(fogCv, 0, 0); ctx.restore();
}
// 앉는 면의 높이: 타일 위에서부터 몇 px 에 엉덩이가 오는가 (tiles.ts 의 의자·소파·벤치 그림 기준). 뒤를 보는 가구는 머리가 등받이 위로 나오게 조금 높인다
const SEAT_Y = 21, SEAT_BACK_Y = 18, SEAT_SIDE_X = 3;
const PARROT_DELAY_MS = 900, PARROT_ECHO_MS = 2600;
// 앵무새의 작은 말풍선: (left, bottom) 이 왼쪽 아래 모서리
function drawEcho(ctx: CanvasRenderingContext2D, text: string, left: number, bottom: number, s: number): void {
  const size = 10 + (s >= 2 ? 1 : 0);
  ctx.font = `${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  const w = Math.min(150, ctx.measureText(text).width) + 10, h = size + 7;
  const x = left, y = bottom - h;
  ctx.fillStyle = 'rgba(240,255,240,0.96)'; ctx.strokeStyle = '#3fbf5a'; ctx.lineWidth = 1.2;
  roundRect(ctx, x, y, w, h, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#1f5c2e'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(text, x + 5, y + 3, 150);
}

// ---- 눈덩이·눈사람 (픽셀 원: 가로줄 하나씩 채운다) ----
function pixelDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.floor(Math.sqrt(r * r + r * 0.6 - dy * dy));
    ctx.fillRect(Math.round(cx) - hw, Math.round(cy) + dy, hw * 2 + 1, 1);
  }
}
// 둥근 눈덩이 하나: 바닥 그림자 → 테두리 → 아래쪽 그늘 → 본체 → 왼쪽 위 하이라이트. (cx, bottom) = 바닥 가운데
function snowOrb(ctx: CanvasRenderingContext2D, cx: number, bottom: number, r: number): number {
  const cy = bottom - r;
  pixelDisc(ctx, cx, cy, r + 1, '#8fa6c8');
  pixelDisc(ctx, cx, cy, r, '#c4d3ea');
  pixelDisc(ctx, cx - 1, cy - 1, Math.max(1, r - 2), '#eef4fc');
  pixelDisc(ctx, cx - Math.ceil(r / 3), cy - Math.ceil(r / 3), Math.max(1, Math.floor(r / 3)), '#ffffff');
  return cy;
}
function drawSnowball(ctx: CanvasRenderingContext2D, cx: number, bottom: number, r: number): void { // r: 굴린 만큼 커진다 (5..10, 큰 눈덩이 11)
  ctx.fillStyle = 'rgba(40,60,100,0.22)';
  ctx.beginPath(); ctx.ellipse(cx, bottom + 1, r + 2, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  snowOrb(ctx, cx, bottom, r);
}
function drawSnowman(ctx: CanvasRenderingContext2D, cx: number, bottom: number): void {
  ctx.fillStyle = 'rgba(40,60,100,0.22)';
  ctx.beginPath(); ctx.ellipse(cx, bottom + 1, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
  snowOrb(ctx, cx, bottom, 10);
  const midY = snowOrb(ctx, cx, bottom - 15, 7);
  const headY = snowOrb(ctx, cx, bottom - 27, 5);
  ctx.fillStyle = '#6b4a2b'; // 나뭇가지 팔
  ctx.fillRect(cx - 14, midY - 2, 7, 1); ctx.fillRect(cx + 8, midY - 2, 7, 1); ctx.fillRect(cx - 14, midY - 4, 1, 3); ctx.fillRect(cx + 14, midY - 4, 1, 3);
  ctx.fillStyle = '#1f2937'; // 눈·단추
  ctx.fillRect(cx - 3, headY - 2, 1, 2); ctx.fillRect(cx + 2, headY - 2, 1, 2);
  ctx.fillRect(cx, midY - 3, 1, 1); ctx.fillRect(cx, midY + 1, 1, 1);
  ctx.fillStyle = '#f97316'; ctx.fillRect(cx, headY, 4, 1); // 당근 코
  ctx.fillStyle = '#b91c1c'; ctx.fillRect(cx - 5, headY + 4, 11, 2); // 목도리
}

// ---- 낚시 ----
// 낚싯대를 쥔 손 위치 (월드 px)
function handPos(e: Entity): [number, number] {
  const cx = e.x * TILE + TILE / 2, cy = e.y * TILE + TILE - 16;
  const ox = e.dir === 2 ? 7 : e.dir === 1 ? -7 : 5;
  return [cx + ox, cy];
}
// 곡괭이질 (금광 채광 중): 손에서 곡괭이를 들어 올렸다가 바라보는 쪽으로 내리찍기를 0.6초마다 되풀이한다. 찍는 순간 끝에서 금가루가 튄다
function drawPickaxe(ctx: CanvasRenderingContext2D, e: Entity, now: number): void {
  const [hx, hy] = handPos(e);
  const p = ((now + (e.uid.charCodeAt(0) || 0) * 37) % 600) / 600; // 사람마다 박자가 조금 어긋나게
  // 들어 올린 각 → 내리찍은 각 (화면 기준, 오른쪽 0 · 아래 +). 0~0.6 천천히 들고, 0.6~0.75 빠르게 찍고, 나머지는 잠깐 멈춤
  const [up, down] = e.dir === 2 ? [-2.3, 0.35] : e.dir === 1 ? [Math.PI + 2.3, Math.PI - 0.35] : e.dir === 3 ? [-0.3, -1.75] : [-1.1, 1.3];
  const lift = p < 0.6 ? Math.sin((p / 0.6) * Math.PI / 2) : p < 0.75 ? 1 - (p - 0.6) / 0.15 : 0; // 1 = 다 든 상태, 0 = 찍은 상태
  const ang = down + (up - down) * lift;
  const L = 13, tx = hx + Math.cos(ang) * L, ty = hy + Math.sin(ang) * L;
  ctx.lineCap = 'round';
  // 자루
  ctx.strokeStyle = '#262626'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.strokeStyle = '#9a6a35'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
  // 머리: 자루 끝에 가로로 걸친 휜 쇠
  const nx = -Math.sin(ang), ny = Math.cos(ang), bx = Math.cos(ang), by = Math.sin(ang);
  const head = (w: number, color: string) => {
    ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(tx + nx * 6 - bx * 2.5, ty + ny * 6 - by * 2.5); ctx.quadraticCurveTo(tx + bx * 2, ty + by * 2, tx - nx * 6 - bx * 2.5, ty - ny * 6 - by * 2.5); ctx.stroke();
  };
  head(4, '#262626'); head(2, '#cfd8e3');
  ctx.lineCap = 'butt';
  // 찍는 순간의 금가루
  if (p >= 0.72 && p < 0.92) {
    const a = 1 - (p - 0.72) / 0.2, sx = tx + bx * 3, sy = ty + by * 3;
    ctx.fillStyle = `rgba(255, 226, 110, ${a})`;
    for (let i = 0; i < 4; i++) { const d = (1 - a) * 7 + 2, th = ang + (i - 1.5) * 0.7; ctx.fillRect(Math.round(sx + Math.cos(th) * d), Math.round(sy + Math.sin(th) * d - (1 - a) * 3), 2, 2); }
  }
}
// 클럽 (2026-11-18): 춤추는 바닥의 한 칸. 박자마다 빛깔이 바뀌고 칸마다 다르다
function drawDanceTile(ctx: CanvasRenderingContext2D, x: number, y: number, now: number, bpm: number): void {
  const beat = Math.floor(now / (60000 / bpm)), k = (now % (60000 / bpm)) / (60000 / bpm);
  const hue = ((x * 47 + y * 83 + beat * 67) % 360 + 360) % 360, on = (x + y + beat) % 2 === 0;
  ctx.fillStyle = `hsl(${hue}, 85%, ${on ? 62 - k * 14 : 30}%)`;
  ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x * TILE + 2, y * TILE + 2, TILE - 4, 3);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
}
// 클럽 조명: 방을 어둡게 깔고, 춤추는 바닥 위로 색 조명 여섯 개가 돌고, 미러볼 빛 점이 벽을 훑는다
function drawClubLights(eng: Engine, c: { x: number; y: number; w: number; h: number; bpm: number }, now: number): void {
  const { ctx, canvas } = eng, k = eng.scale * eng.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(8, 4, 26, 0.42)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cx = ((c.x + c.w / 2) * TILE - eng.cam.x) * k, cy = ((c.y + c.h / 2) * TILE - eng.cam.y) * k, rw = (c.w / 2) * TILE * k, rh = (c.h / 2) * TILE * k;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const a = now / (1400 + i * 230) + i * 1.05, x = cx + Math.cos(a) * rw * 0.85, y = cy + Math.sin(a * 1.3) * rh * 0.8, r = 2.4 * TILE * k;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${(i * 60 + now / 40) % 360}, 95%, 60%, 0.3)`); g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 14; i++) {
    const a = now / 2600 + i * 0.449, x = cx + Math.cos(a) * rw * 2.1, y = cy + Math.sin(a * 0.83 + i) * rh * 1.9;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(2, Math.round(1.5 * k)), Math.max(2, Math.round(1.5 * k)));
  }
  ctx.globalCompositeOperation = 'source-over';
}
// 비 (2026-11-18): 화면에 비스듬한 빗줄기와 바닥에 튀는 물방울을 그리고 살짝 흐리게 덧칠한다. 겨울 맵에서는 천천히 내리는 눈.
// 방울마다 상태를 두지 않는다: 번호와 시각으로 자리를 계산한다 (화면 크기가 바뀌어도 그대로 이어진다)
function drawRain(eng: Engine, now: number, level: number, snow: boolean): void {
  const { ctx } = eng, W = eng.w, H = eng.h;
  const frac = (v: number) => v - Math.floor(v);
  ctx.fillStyle = snow ? `rgba(220,230,245,${0.06 * level})` : `rgba(50,70,100,${0.12 * level})`;
  ctx.fillRect(0, 0, W, H);
  const n = Math.round(110 * level * Math.max(1, (W * H) / 480000));
  if (snow) {
    // 눈송이: 2~4px. 밝은 잔디·광장 돌 위에서도 보이게 옅은 그림자를 먼저 깐다 (2026-11-19: 눈이 오는 철에는 어느 맵에서나 내린다)
    const flakes: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const sp = 0.03 + frac(i * 0.137) * 0.03;
      flakes.push([Math.round(frac(i * 0.6180339 + Math.sin(now / 1700 + i) * 0.01) * W), Math.round(frac(i * 0.3819 + (now * sp) / H) * H), Math.round(2 + frac(i * 0.71) * 2.2)]);
    }
    ctx.fillStyle = 'rgba(60,80,110,0.3)'; for (const [x, y, r] of flakes) ctx.fillRect(x + 1, y + 1, r, r);
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; for (const [x, y, r] of flakes) ctx.fillRect(x, y, r, r);
    return;
  }
  ctx.strokeStyle = 'rgba(200,222,255,0.42)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const sp = 0.55 + frac(i * 0.137) * 0.35; // px/ms
    const y = frac(i * 0.3819 + (now * sp) / H) * (H + 40) - 20, x = frac(i * 0.6180339) * (W + 80) - 40 - (y / H) * 30, len = 9 + frac(i * 0.29) * 9;
    ctx.moveTo(x, y); ctx.lineTo(x - len * 0.28, y + len);
  }
  ctx.stroke();
  // 바닥에 튀는 물방울: 0.4초짜리 작은 고리가 여기저기서 번갈아 생긴다
  ctx.strokeStyle = 'rgba(220,235,255,0.35)';
  const m = Math.round(n / 5), slot = Math.floor(now / 400), k = (now % 400) / 400;
  for (let i = 0; i < m; i++) {
    const x = frac((i + slot * 7) * 0.6180339) * W, y = frac((i * 3 + slot * 5) * 0.3819) * H;
    ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.ellipse(x, y, 2 + k * 4, 1 + k * 1.5, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
// 낮과 밤 (2026-11-18): 화면 전체에 그 시각의 빛깔을 덧칠하고, 가로등·창문 둘레는 덜 어둡게 남긴 뒤 따뜻한 불빛을 살짝 더한다.
// 불빛이 화면에 없으면 한 번 칠하는 것으로 끝난다. 있으면 따로 둔 캔버스에 어둠을 칠하고 불빛 자리를 도려내 얹는다
let nightCv: HTMLCanvasElement | null = null;
function drawNight(eng: Engine, map: MapData, vis: { x0: number; y0: number; x1: number; y1: number }, n: DayTint, fires?: { x: number; y: number }[]): void {
  const { ctx, canvas } = eng;
  const k = eng.scale * eng.dpr;
  const lights: { x: number; y: number; r: number; s: number }[] = [];
  if (n.lamp > 0.02) for (let y = Math.max(0, vis.y0 - 3); y <= Math.min(map.h - 1, vis.y1 + 3); y++) for (let x = Math.max(0, vis.x0 - 3); x <= Math.min(map.w - 1, vis.x1 + 3); x++) {
    const o = map.objects[y * map.w + x];
    if (o === O.LAMP) lights.push({ x: ((x + 0.5) * TILE - eng.cam.x) * k, y: ((y - 0.4) * TILE - eng.cam.y) * k, r: 3 * TILE * k, s: 1 }); // 가로등 머리는 한 칸 위에 그려진다
    else if (o === O.WALL_WINDOW) lights.push({ x: ((x + 0.5) * TILE - eng.cam.x) * k, y: ((y + 0.5) * TILE - eng.cam.y) * k, r: 1.4 * TILE * k, s: 0.6 });
  }
  if (n.lamp > 0.02) for (const f of fires ?? []) lights.push({ x: ((f.x + 0.5) * TILE - eng.cam.x) * k, y: ((f.y + 0.5) * TILE - eng.cam.y) * k, r: 3.4 * TILE * k, s: 1 }); // 모닥불 둘레도 밝다
  const fill = `rgba(${n.r},${n.g},${n.b},${n.a})`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!lights.length) { ctx.fillStyle = fill; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
  if (!nightCv) nightCv = document.createElement('canvas');
  if (nightCv.width !== canvas.width || nightCv.height !== canvas.height) { nightCv.width = canvas.width; nightCv.height = canvas.height; }
  const nc = nightCv.getContext('2d')!;
  nc.globalCompositeOperation = 'source-over';
  nc.clearRect(0, 0, nightCv.width, nightCv.height);
  nc.fillStyle = fill; nc.fillRect(0, 0, nightCv.width, nightCv.height);
  nc.globalCompositeOperation = 'destination-out';
  for (const l of lights) {
    const g = nc.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    g.addColorStop(0, `rgba(0,0,0,${0.8 * n.lamp * l.s})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    nc.fillStyle = g; nc.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  ctx.drawImage(nightCv, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const r = l.r * 0.75, g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
    g.addColorStop(0, `rgba(255,190,110,${0.2 * n.lamp * l.s})`); g.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = g; ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
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
  if (fv.rod === 3) { drawCrown(ctx, bx, by + 2, 1, now); return; } // 킹 낚싯대: 찌가 금색 왕관
  ctx.fillStyle = '#e8402a'; ctx.beginPath(); ctx.arc(bx, by, 3, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI); ctx.fill();
  ctx.strokeStyle = '#262626'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.stroke();
}
// 금색 왕관 (킹 낚싯대의 찌와 낚싯대 끝). (cx, base) = 아랫변 가운데, k = 크기 배수. 가끔 반짝인다
function drawCrown(ctx: CanvasRenderingContext2D, cx: number, base: number, k: number, now: number): void {
  const w = 5 * k, h = 6 * k;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(cx - w, base); ctx.lineTo(cx - w, base - h); ctx.lineTo(cx - w / 2, base - h / 2); ctx.lineTo(cx, base - h - k); ctx.lineTo(cx + w / 2, base - h / 2); ctx.lineTo(cx + w, base - h); ctx.lineTo(cx + w, base);
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  path(); ctx.strokeStyle = '#3a2406'; ctx.lineWidth = 2.5; ctx.stroke();
  path(); ctx.fillStyle = '#ffd84d'; ctx.fill();
  ctx.fillStyle = '#b8791a'; ctx.fillRect(cx - w, base - 1.5 * k, w * 2, 1.5 * k); // 아래 띠
  ctx.fillStyle = '#e8402a'; ctx.fillRect(Math.round(cx) - 1, Math.round(base - h / 2) - 1, 2, 2); // 가운데 보석
  ctx.lineJoin = 'miter';
  const t = Math.sin(now / 380 + cx * 0.7);
  if (t > 0.75) { ctx.fillStyle = '#ffffff'; const x = Math.round(cx + w - 1), y = Math.round(base - h); ctx.fillRect(x - 2, y, 5, 1); ctx.fillRect(x, y - 2, 1, 5); }
}
// 낚싯대(손 → 끝)와 늘어진 낚싯줄(끝 → 찌)
function drawRod(ctx: CanvasRenderingContext2D, e: Entity, fv: FishingView, now: number): void {
  const [hx, hy] = handPos(e);
  const [bx, by] = bobberPos(e, fv, now);
  const tx = hx + (bx - hx) * 0.5, ty = Math.min(hy, by) - 12;
  ctx.lineCap = 'round';
  // 낚싯대 색: 기본 나무색, 좋은 낚싯대 은색, 명품 낚싯대 금색. 킹 낚싯대는 더 굵은 금색에 붉은 마디, 끝에 왕관
  const king = fv.rod === 3;
  const rodColor = (fv.rod || 0) >= 2 ? '#ffd84d' : fv.rod === 1 ? '#cfd8e3' : '#8a5a2b';
  ctx.strokeStyle = king ? '#3a2406' : '#262626'; ctx.lineWidth = king ? 4.5 : 3.5; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.strokeStyle = rodColor; ctx.lineWidth = king ? 3 : 2; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
  if (king) {
    ctx.fillStyle = '#e8402a';
    for (const q of [0.3, 0.62]) ctx.fillRect(Math.round(hx + (tx - hx) * q) - 1, Math.round(hy + (ty - hy) * q) - 1, 3, 3);
  }
  ctx.strokeStyle = king ? 'rgba(255,236,160,0.9)' : 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + bx) / 2, Math.max(ty, by) + 3, bx, by - 3); ctx.stroke();
  ctx.lineCap = 'butt';
  if (king) drawCrown(ctx, tx, ty + 1, 0.8, now);
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
// 머리 위 진행 막대: 어두운 바탕에 왼쪽부터 차오르고, parts 칸마다 눈금을 긋는다 (bottom = 막대의 아래쪽 y)
function drawProgress(ctx: CanvasRenderingContext2D, cx: number, bottom: number, p: number, parts: number, s: number): void {
  const w = Math.round(34 * s), h = Math.round(5 * s), x = Math.round(cx - w / 2), y = Math.round(bottom - h);
  ctx.fillStyle = 'rgba(0,0,0,0.72)'; roundRect(ctx, x - 2, y - 2, w + 4, h + 4, 4); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#a4e85c'; ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, p))), h);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let i = 1; i < parts; i++) ctx.fillRect(x + Math.round((w * i) / parts), y, 1, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1; roundRect(ctx, x - 1.5, y - 1.5, w + 3, h + 3, 4); ctx.stroke();
}

// fade: 비치게 그린다 (다른 캐릭터를 덮는 이름표. box 바탕 상자·text 글자의 진하기. 글자에는 그림자를 넣어 바탕이 옅어도 읽히게)
export function drawLabel(ctx: CanvasRenderingContext2D, text: string, cx: number, bottom: number, color: string, bg: string, size: number, border?: string, fade?: { box: number; text: number }): void {
  ctx.font = `bold ${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const w = ctx.measureText(text).width + 8;
  const h = size + 6;
  const alpha = ctx.globalAlpha;
  if (fade) ctx.globalAlpha = alpha * fade.box;
  ctx.fillStyle = bg;
  roundRect(ctx, cx - w / 2, bottom - h, w, h, 4); ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke(); }
  if (fade) { ctx.globalAlpha = alpha * fade.text; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 3; }
  ctx.fillStyle = isLabelFlow(color) ? labelFlow(ctx, color, cx - w / 2, cx + w / 2, performance.now()) : color;
  ctx.fillText(text, cx, bottom - 3);
  if (fade) { ctx.globalAlpha = alpha; ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }
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

// skin: 말풍선 꾸미기 (2026-11-20. 일반 채팅에만 입힌다: 귓속말은 점선 보라 그대로여야 구분된다). 글자 크기·줄 높이·여백은 꾸미기와 상관없이 같다
export function drawBubble(ctx: CanvasRenderingContext2D, b: Bubble, cx: number, bottom: number, s: number, skin?: string | null, now = 0): { x: number; y: number; w: number } {
  const st = BUBBLE_STYLE[b.kind];
  const size = 12 + (s >= 2 ? 1 : 0);
  const sk = b.kind === 'near' && hasBubbleSkin(skin) ? skin : null;
  const font = sk ? bubbleFont(sk, size, b.text) : `${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  ctx.font = font;
  const maxW = 170;
  const lines = wrapText(ctx, b.text, maxW);
  const lh = size + 4;
  const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + 16;
  const h = lines.length * lh + 10;
  const x = cx - w / 2, y = bottom - h - 8;
  if (sk) {
    const ink = paintBubble(ctx, sk, x, y, w, h, cx, now);
    ctx.save();
    if (ink.glow) { ctx.shadowColor = ink.glow; ctx.shadowBlur = 6; }
    ctx.font = font; ctx.fillStyle = ink.color; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, cx, y + 5 + i * lh));
    ctx.restore();
    return { x, y, w };
  }
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
  return { x, y, w };
}

// 방(카지노) 간판: 이름 · 인원/정원, 안에 있는 사람들
function drawRoomSign(eng: Engine, z: Zone, rs: RoomState | undefined): void {
  const { ctx } = eng;
  const s = eng.scale;
  const cx = (z.x + z.w / 2) * TILE;
  const topY = (z.y - 1) * TILE - 6;
  if (!eng.isTileVisible(z.x + z.w / 2, z.y, TILE * 3)) return;
  const [sx, sy] = eng.worldToScreen(cx, topY);
  const members = rs?.members ? Object.values(rs.members) : [];
  const cap = z.cap || rs?.cap || 0;
  const lines: { text: string; color: string }[] = [];
  {
    lines.push({ text: `${z.label || ''}  ${members.length}/${cap}`, color: members.length >= cap ? '#ff9b9b' : '#ffd84d' });
    if (members.length) lines.push({ text: members.sort((a, b) => a.at - b.at).map((m) => m.n).join(' · '), color: '#dddddd' });
  }
  const size = 11 + (s >= 2 ? 1 : 0);
  ctx.font = `bold ${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  const w = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 14;
  const lh = size + 4;
  const h = lines.length * lh + 8;
  ctx.fillStyle = 'rgba(20, 30, 40, 0.8)';
  roundRect(ctx, sx - w / 2, sy - h, w, h, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();
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
