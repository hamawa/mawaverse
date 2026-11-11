export type Pose = 'none' | 'wave' | 'sleep' | 'cry' | 'angry' | 'laugh' | 'yawn' | 'jump' | 'heart' | 'dance' | 'push';

export interface HumanParams {
  kind: 'human';
  female: boolean;
  skin: string;
  hair: number;
  hairColor: string;
  eye: string;
  top: number;        // 0 티셔츠 1 셔츠 2 후드 3 원피스 4 정장 5 줄무늬 6 멜빵 7 민소매 8 재킷
  topColor: string;
  topColor2: string;
  bottom: number;     // 0 바지 1 반바지 2 치마 3 긴치마
  bottomColor: string;
  shoe: string;
  acc: number;        // 0 없음 1 안경 2 캡모자 3 리본 4 비니 5 헤드폰 6 선글라스 7 머리띠 8 꽃 9 베레모
  accColor: string;
}

export interface CreatureParams {
  kind: 'creature';
  species: string;
  c1: string;
  c2: string;
  c3: string;
  eye: string;
}

export type SpriteParams = HumanParams | CreatureParams;

export interface Preset {
  id: string;
  group: 'm' | 'f' | 'x';
  name: string;
  params: SpriteParams;
}

export const FRAME_W = 24;
export const FRAME_H = 36;
export const OUTLINE = '#262626';
