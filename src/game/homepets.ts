// 집 안을 돌아다니는 펫 (2026-11-18, 사용자 요청): 집에는 주인이 가진 펫이 전부 나와 자유롭게 돌아다닌다.
// 같은 날 추가 요청: 집에 들어가면 데리고 다니던 펫도 풀려나 같이 돌아다니고, 손님이 데리고 온 펫도 그렇다 (집 안에서는 아무도 펫을 달고 다니거나 타지 않는다).
// 화면에만 있는 모습이라 서버에 쓰지 않는다. 대신 어디에 있는지는 서버 시각과 (집 주인, 펫 종류)로 정해져서, 같은 집에 있는 사람은 같은 자리의 펫을 본다.
// 걷는 법: SLOT_MS 마다 제자리에 있거나 옆 칸(걸을 수 있는 칸)으로 한 칸 옮긴다. EPOCH_MS 마다 새 자리에서 다시 시작한다 (그 사이는 처음부터 이어서 계산한다)
import type { Dir } from '../shared/types';
import type { PetView } from './render';
import { cyrb53 } from '../shared/hash';
import { isWalkable, type MapData } from './map';
import { PET_IDS } from '../shared/shop';

export const ROAM_SLOT_MS = 1400;   // 한 번 움직일지 정하는 간격
export const ROAM_WALK_MS = 620;    // 한 칸 걷는 시간 (나머지는 쉰다)
export const ROAM_EPOCH_MS = 5 * 60 * 1000;
const STAY = 0.45;                  // 그 간격에 제자리에 있을 확률

// 가진 품목에서 펫만 (상점 순서)
export function ownedPets(own: Record<string, unknown> | null | undefined): string[] { return own ? PET_IDS.filter((id) => own[id] === true) : []; }

// 펫이 걸어 다닐 수 있는 칸: 걸을 수 있는 바닥 (가구·벽 제외)
export function roamTiles(map: MapData): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (isWalkable(map, x, y)) out.push({ x, y });
  return out;
}

const rnd = (key: string): number => (cyrb53(key) % 100000) / 100000; // 0 ~ 1

// 돌아다니는 펫 하나. key: 자리를 정하는 열쇠(같은 열쇠면 누구 화면에서나 같은 자리), scale: 크기(데리고 온 펫은 레벨 크기 그대로)
export interface RoamPet { key: string; id: string; scale?: number }
interface Walk { key: string; epoch: number; slot: number; x: number; y: number; px: number; py: number; dir: Dir }

export class HomePets {
  private walks = new Map<string, Walk>();
  private tiles: { x: number; y: number }[] = [];
  private free = new Set<string>();
  private sig = '';

  // 방 모양(가구가 바뀌면 달라진다)을 받아 둔다
  setMap(map: MapData): void {
    this.tiles = roamTiles(map);
    const sig = `${map.w}x${map.h}:${this.tiles.map((t) => `${t.x},${t.y}`).join(';')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.free = new Set(this.tiles.map((t) => `${t.x},${t.y}`));
    this.walks.clear();
  }
  clear(): void { this.walks.clear(); this.tiles = []; this.free.clear(); this.sig = ''; }

  // 이 펫들이 지금(serverMs) 어디에 있나
  views(pets: RoamPet[], serverMs: number): PetView[] {
    if (!this.tiles.length) return [];
    return pets.map((p) => this.viewOf(p, serverMs));
  }

  private viewOf(pet: RoamPet, serverMs: number): PetView {
    const { key, id } = pet;
    const epoch = Math.floor(serverMs / ROAM_EPOCH_MS), into = serverMs - epoch * ROAM_EPOCH_MS;
    const slot = Math.floor(into / ROAM_SLOT_MS);
    let w = this.walks.get(key);
    if (!w || w.epoch !== epoch || w.slot > slot) {
      const t = this.tiles[cyrb53(`${key}|${epoch}`) % this.tiles.length];
      w = { key, epoch, slot: 0, x: t.x, y: t.y, px: t.x, py: t.y, dir: 0 };
      this.walks.set(key, w);
    }
    while (w.slot < slot) { w.slot++; this.step(w); }
    const t = Math.min(1, (into - slot * ROAM_SLOT_MS) / ROAM_WALK_MS);
    const moving = t < 1 && (w.px !== w.x || w.py !== w.y);
    return { id, x: moving ? w.px + (w.x - w.px) * t : w.x, y: moving ? w.py + (w.y - w.py) * t : w.y, moving, moveT: moving ? t : 0, hopAt: -1e9, dir: w.dir, scale: pet.scale ?? 1, ride: false };
  }

  // slot 번째 간격의 움직임: 제자리 또는 옆 칸
  private step(w: Walk): void {
    w.px = w.x; w.py = w.y;
    const r = rnd(`${w.key}|${w.epoch}|${w.slot}`);
    if (r < STAY) return;
    const d = Math.floor(((r - STAY) / (1 - STAY)) * 4) as Dir; // 0 아래 1 왼쪽 2 오른쪽 3 위
    const nx = w.x + (d === 2 ? 1 : d === 1 ? -1 : 0), ny = w.y + (d === 0 ? 1 : d === 3 ? -1 : 0);
    if (!this.free.has(`${nx},${ny}`)) return;
    w.x = nx; w.y = ny; w.dir = d;
  }
}
