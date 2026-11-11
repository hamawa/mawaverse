import { seededRandom } from '../../shared/hash';
import type { Preset, HumanParams, CreatureParams } from './types';

const SKINS = ['#f8d7b8', '#f1c4a0', '#e0a982', '#c98b64', '#a06a45', '#6e4530', '#ffe3cf'];
const HAIR_COLORS = ['#2b2b2b', '#4a2c17', '#7a4a24', '#c99250', '#e3c27e', '#b23a2e', '#9a9a9a', '#f2f2f2', '#3f6fd1', '#2e9b5c', '#e86aa6', '#7d4cc9', '#e07b28', '#5c3b8a'];
const TOP_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1', '#34495e', '#ff7eb3', '#8e44ad', '#2c3e50', '#d35400', '#16a085', '#f39c12', '#95a5a6', '#c0392b', '#2980b9', '#27ae60', '#ffffff'];
const BOTTOM_COLORS = ['#2c3e50', '#34495e', '#5d6d7e', '#3b5998', '#7f8c8d', '#6d4c41', '#1e3a5f', '#8d6e63', '#2e4053', '#4a4a4a', '#b03a2e', '#f5cba7'];
const SHOES = ['#222222', '#5a3b1e', '#ffffff', '#8b0000', '#1b4f72', '#444444'];
const EYES = ['#2b2b2b', '#3b2a1a', '#2a4a8a', '#2e6b3a', '#5a3b6a'];
const ACC_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#ffffff', '#222222', '#ff7eb3', '#2ecc71', '#9b59b6'];

const MALE_HAIR = [0, 1, 6, 11, 8, 7, 9, 12, 13, 14, 0, 1, 4, 5];
const FEMALE_HAIR = [2, 3, 4, 5, 10, 11, 7, 12, 15, 16, 17, 2, 3, 13];
const MALE_TOPS = [0, 1, 2, 4, 5, 6, 8, 7, 0, 1];
const FEMALE_TOPS = [0, 1, 2, 3, 5, 6, 7, 8, 3, 0];
const MALE_ACC = [0, 0, 1, 2, 4, 5, 6, 0, 1, 0];
const FEMALE_ACC = [0, 3, 7, 1, 8, 9, 0, 3, 0, 1];

function pick<T>(arr: T[], r: number): T { return arr[Math.floor(r * arr.length) % arr.length]; }

function human(i: number, female: boolean): HumanParams {
  const rnd = seededRandom(`${female ? 'f' : 'm'}-${i}`);
  const hairList = female ? FEMALE_HAIR : MALE_HAIR;
  const topList = female ? FEMALE_TOPS : MALE_TOPS;
  const accList = female ? FEMALE_ACC : MALE_ACC;
  const top = topList[(i + Math.floor(i / 10)) % topList.length];
  let bottom = female ? [0, 2, 1, 3, 0, 2][i % 6] : [0, 0, 1, 0][i % 4];
  if (top === 3) bottom = 0;
  const topColor = pick(TOP_COLORS, rnd());
  let topColor2 = pick(TOP_COLORS, rnd());
  if (topColor2 === topColor) topColor2 = '#ffffff';
  return {
    kind: 'human',
    female,
    skin: SKINS[(i * 3 + (female ? 1 : 0)) % SKINS.length],
    hair: hairList[i % hairList.length],
    hairColor: HAIR_COLORS[(i * 5 + (female ? 3 : 0)) % HAIR_COLORS.length],
    eye: pick(EYES, rnd()),
    top,
    topColor,
    topColor2: top === 4 ? pick(['#e74c3c', '#3498db', '#f1c40f', '#8e44ad'], rnd()) : topColor2,
    bottom,
    bottomColor: pick(BOTTOM_COLORS, rnd()),
    shoe: pick(SHOES, rnd()),
    acc: accList[(i * 7 + Math.floor(i / 5)) % accList.length],
    accColor: pick(ACC_COLORS, rnd()),
  };
}

interface SpeciesDef { species: string; name: string; palettes: [string, string, string][]; eye?: string }
const SPECIES: SpeciesDef[] = [
  { species: 'cat', name: '고양이', palettes: [['#f4a259', '#fff4e0', '#8a5a2b'], ['#9e9e9e', '#f5f5f5', '#555'], ['#2b2b2b', '#ffffff', '#777'], ['#ffffff', '#f4a259', '#999']] },
  { species: 'dog', name: '강아지', palettes: [['#d9a066', '#fff1dc', '#5a3b1e'], ['#ffffff', '#c98b64', '#555'], ['#5a3b1e', '#d9a066', '#333']] },
  { species: 'rabbit', name: '토끼', palettes: [['#ffffff', '#f7b2c6', '#999'], ['#c9b8a8', '#f7d6c6', '#555'], ['#9fb4d9', '#f7b2c6', '#555']] },
  { species: 'bear', name: '곰', palettes: [['#8b5a2b', '#d9a066', '#333'], ['#f1c27d', '#fff1dc', '#333'], ['#ffffff', '#cfd8dc', '#333']] },
  { species: 'panda', name: '판다', palettes: [['#ffffff', '#222222', '#555'], ['#ffffff', '#5c3b8a', '#555']] },
  { species: 'fox', name: '여우', palettes: [['#e8722a', '#ffffff', '#4a2c17'], ['#f5f5f5', '#ffffff', '#555'], ['#8b4513', '#f1c27d', '#333']] },
  { species: 'pig', name: '돼지', palettes: [['#f7b2c6', '#f48fb1', '#c2185b'], ['#333333', '#f7b2c6', '#000']] },
  { species: 'frog', name: '개구리', palettes: [['#5fbf5f', '#c6f0a8', '#2f7a2f'], ['#2f9ad1', '#c6e9f8', '#1a5b85'], ['#f1c40f', '#fff3b0', '#8a6d00']] },
  { species: 'duck', name: '오리', palettes: [['#ffe066', '#f39c12', '#b26a00'], ['#ffffff', '#f39c12', '#999'], ['#2b2b2b', '#e67e22', '#555']] },
  { species: 'penguin', name: '펭귄', palettes: [['#2b2b2b', '#ffffff', '#f39c12'], ['#3b5998', '#ffffff', '#f39c12']] },
  { species: 'owl', name: '부엉이', palettes: [['#8b5a2b', '#f1c27d', '#f39c12'], ['#9e9e9e', '#ffffff', '#f39c12'], ['#5c3b8a', '#d7bde2', '#f1c40f']] },
  { species: 'slime', name: '슬라임', palettes: [['#5fd3a0', '#c8ffe8', '#2a8a62'], ['#6aa8ff', '#d6e8ff', '#2f5fb0'], ['#ff7eb3', '#ffd6e8', '#b03a6b'], ['#ffd84d', '#fff4c6', '#b08a00']] },
  { species: 'ghost', name: '유령', palettes: [['#f5f5ff', '#f7a1a1', '#888'], ['#d7bde2', '#ff7eb3', '#888'], ['#c6f0a8', '#2f7a2f', '#888']] },
  { species: 'robot', name: '로봇', palettes: [['#9aa5b1', '#2f9ad1', '#555'], ['#e74c3c', '#f1c40f', '#333'], ['#ffffff', '#5fd3a0', '#666'], ['#f1c40f', '#2b2b2b', '#777']] },
  { species: 'alien', name: '외계인', palettes: [['#7ed957', '#ff7eb3', '#2f7a2f'], ['#9fb4d9', '#f1c40f', '#3b5998'], ['#d7bde2', '#5fd3a0', '#5c3b8a']] },
  { species: 'mushroom', name: '버섯', palettes: [['#e74c3c', '#ffffff', '#fff1dc'], ['#8b5a2b', '#f1c27d', '#fff1dc'], ['#9b59b6', '#ffffff', '#fff1dc']] },
  { species: 'octopus', name: '문어', palettes: [['#e74c3c', '#f7a1a1', '#8b0000'], ['#9b59b6', '#d7bde2', '#5c3b8a'], ['#2f9ad1', '#c6e9f8', '#1a5b85']] },
  { species: 'dragon', name: '드래곤', palettes: [['#2ecc71', '#f1c40f', '#f5f5f5'], ['#e74c3c', '#f1c27d', '#f5f5f5'], ['#3b5998', '#9fb4d9', '#f5f5f5']] },
  { species: 'bat', name: '박쥐', palettes: [['#5c3b8a', '#e74c3c', '#333'], ['#2b2b2b', '#f1c40f', '#333']] },
  { species: 'cactus', name: '선인장', palettes: [['#5fbf5f', '#ff7eb3', '#fff'], ['#2f9ad1', '#f1c40f', '#fff']] },
];

function creature(i: number): { params: CreatureParams; label: string } {
  // 종을 돌아가며 배정하고, 색상 조합은 종별 팔레트를 순환
  let idx = 0;
  const flat: { def: SpeciesDef; pi: number }[] = [];
  let round = 0;
  while (flat.length < 60) {
    for (const def of SPECIES) if (round < def.palettes.length) flat.push({ def, pi: round });
    round++;
    if (round > 5) break;
  }
  idx = i % flat.length;
  const { def, pi } = flat[idx];
  const [c1, c2, c3] = def.palettes[pi];
  return { params: { kind: 'creature', species: def.species, c1, c2, c3, eye: def.eye || '#2b2b2b' }, label: `${def.name} ${pi + 1}` };
}

export const PRESETS: Preset[] = [];
for (let i = 0; i < 50; i++) PRESETS.push({ id: `m${String(i + 1).padStart(2, '0')}`, group: 'm', name: `남 ${i + 1}`, params: human(i, false) });
for (let i = 0; i < 50; i++) PRESETS.push({ id: `f${String(i + 1).padStart(2, '0')}`, group: 'f', name: `여 ${i + 1}`, params: human(i, true) });
for (let i = 0; i < 50; i++) { const c = creature(i); PRESETS.push({ id: `x${String(i + 1).padStart(2, '0')}`, group: 'x', name: c.label, params: c.params }); }

const byId = new Map(PRESETS.map((p) => [p.id, p]));
export function presetById(id: string): Preset { return byId.get(id) || PRESETS[0]; }
export const DEFAULT_AVATAR = 'm01';
export const GROUP_NAMES: Record<Preset['group'], string> = { m: '남자', f: '여자', x: '동물/캐릭터' };
