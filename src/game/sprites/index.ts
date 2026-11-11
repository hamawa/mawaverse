import { drawHuman } from './human';
import { drawCreature } from './creature';
import { presetById } from './presets';
import { OUTLINE, type Pose } from './types';
import type { Dir } from '../../shared/types';

export { PRESETS, presetById, DEFAULT_AVATAR, GROUP_NAMES } from './presets';
export { FRAME_W, FRAME_H } from './types';
export type { Pose, Preset } from './types';

const cache = new Map<string, HTMLCanvasElement>();

export function getSprite(presetId: string, dir: Dir, frame: number, pose: Pose = 'none'): HTMLCanvasElement {
  frame = frame & 3;
  const key = `${presetId}|${dir}|${frame}|${pose}`;
  let cv = cache.get(key);
  if (cv) return cv;
  const preset = presetById(presetId);
  const drawDir: Dir = dir === 2 ? 1 : dir;
  let buf = preset.params.kind === 'human'
    ? drawHuman(preset.params, drawDir, frame, pose)
    : drawCreature(preset.params, drawDir, frame, pose);
  buf = buf.autoShade(-0.16).outline(OUTLINE);
  if (dir === 2) buf = buf.mirrorX();
  cv = buf.toCanvas();
  cache.set(key, cv);
  return cv;
}

// 아바타 선택 UI용 썸네일 (정면, 정지)
export function getThumb(presetId: string): HTMLCanvasElement {
  return getSprite(presetId, 0, 0, 'none');
}

export function clearSpriteCache(): void { cache.clear(); }
