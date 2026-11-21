// 소리 (2026-11-18, 사용자 요청): 효과음과 배경음악. 소리 파일 없이 Web Audio 로 그 자리에서 합성한다 (저작권·용량·호스팅 전송량 걱정이 없다. 곡은 전부 이 파일의 숫자로 적은 것이다).
// 처음에는 꺼져 있고(사용자 결정: 회사·공공장소에서 갑자기 소리가 나지 않게) 화면 위 🔇 버튼으로 켠다. 설정은 이 브라우저에만 적는다 (mv-sound).
// 어디서든 sfx('catch') 처럼 부른다: 꺼져 있거나 화면이 뒤에 있으면 아무 일도 하지 않는다. 테스트(Node)에서도 불러올 수 있게 모듈을 읽을 때는 아무것도 만들지 않는다.
import { mulberry32, cyrb53 } from '../shared/hash';
import { EDM_BARS, drawEdmBar, type EdmSong } from './edm';

export type Sfx =
  | 'push' | 'wave' | 'hook' | 'pull' | 'toss' | 'hit' | 'block' | 'bat' | 'snow'
  | 'cast' | 'bite' | 'catch' | 'junk' | 'miss' | 'swing' | 'bug'
  | 'chop' | 'wood' | 'mine' | 'gold' | 'coin' | 'portal' | 'door' | 'ui' | 'on'
  | 'card' | 'chip' | 'spin' | 'win' | 'lose' | 'horn' | 'alarm' | 'stab';
// 배경음악이 달라지는 상황. main 은 여러 곡이 돌아가며 나오고 밤에는 밤 곡이 나온다
export type Scene = 'main' | 'home' | 'mine' | 'winter' | 'race' | 'slots' | 'poker' | 'mafia' | 'club';

export interface SoundPrefs { on: boolean; music: number; sfx: number }
const KEY = 'mv-sound';
const DEFAULTS: SoundPrefs = { on: false, music: 0.6, sfx: 0.7 };
const MUSIC_GAIN = 1.5, SFX_GAIN = 1, CLUB_GAIN = 0.5; // 음량 설정에 곱하는 값 (오프라인으로 그려 잰 크기에 맞췄다: 기본 설정에서 배경음악은 작게 깔리고 효과음은 그보다 또렷하게)

const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);

// ---------- 소리 만들기 (실시간·오프라인 공용: 음량 점검은 OfflineAudioContext 로 한다) ----------
type Wave = 'pluck' | 'bell' | 'marimba' | 'rhodes' | 'square' | 'brass' | 'saw' | 'box'; // box: 오르골 (캐롤의 가락. 종보다 빨리 사그라들어 빠른 음이 뭉개지지 않는다)
type Drums = 'gallop' | 'bounce' | 'swing' | 'heart' | 'sleigh' | 'four' | 'bells'; // four: 박마다 킥 (클럽) · bells: 썰매 방울 (캐롤)
export interface Tune {
  name: string; bpm: number; beats: number; root: number; scale: readonly number[]; prog: readonly number[]; bars: number;
  pad?: number;                                              // 깔리는 화음의 크기
  arp?: { vol: number; oct: number; pat: readonly number[]; wave: Wave }; // 한 마디를 pat 길이로 나눠 화음 음을 친다 (-1 = 쉼)
  lead?: { vol: number; oct: number; dens: number; wave: Wave };          // 가락: 박마다 dens 확률로 한 음
  bass?: { vol: number; walk?: boolean; off?: boolean }; // off: 박 사이(엇박)에 짧게 친다 (클럽)
  drums?: Drums; swing?: number; drone?: boolean; rev?: number;           // rev: 울림(잔향)으로 보내는 양
  edm?: EdmSong;                                             // 클럽 곡: 구간이 있는 편곡 (edm.ts 가 그린다. 위의 악기 칸은 쓰지 않는다)
  song?: Song;                                               // 가락이 정해진 곡 (캐롤): 가락과 화음을 적어 둔 대로 친다 (prog·scale·lead.dens 는 쓰지 않는다)
}
const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10], DORIAN = [0, 2, 3, 5, 7, 9, 10], LYDIAN = [0, 2, 4, 6, 7, 9, 11], PHRYG = [0, 1, 3, 5, 7, 8, 10];

// 기본 맵: 느리고 평화로운 곡 넷 + 밤 곡 둘. 한 곡이 끝나면 잠깐 조용했다가 다른 곡이 나온다
export const TUNES: Record<string, Tune> = {
  morning: { name: '맑은 아침', bpm: 66, beats: 4, root: 60, scale: MAJOR, prog: [0, 4, 5, 3], bars: 32, pad: 0.5, arp: { vol: 0.5, oct: 0, pat: [0, -1, 1, -1, 2, -1, 1, -1], wave: 'pluck' }, lead: { vol: 0.42, oct: 1, dens: 0.34, wave: 'bell' }, bass: { vol: 0.4 }, rev: 0.5 },
  noon: { name: '느린 오후', bpm: 56, beats: 4, root: 65, scale: LYDIAN, prog: [0, 1, 0, 5], bars: 28, pad: 0.6, arp: { vol: 0.42, oct: 0, pat: [0, -1, -1, 2, -1, -1, 1, -1], wave: 'rhodes' }, lead: { vol: 0.4, oct: 1, dens: 0.26, wave: 'pluck' }, bass: { vol: 0.35 }, rev: 0.6 },
  meadow: { name: '풀밭 왈츠', bpm: 84, beats: 3, root: 67, scale: MAJOR, prog: [0, 3, 4, 0, 5, 3, 4, 0], bars: 40, pad: 0.4, arp: { vol: 0.45, oct: 0, pat: [0, 1, 2, 1, 2, 1], wave: 'pluck' }, lead: { vol: 0.4, oct: 1, dens: 0.3, wave: 'bell' }, bass: { vol: 0.38 }, rev: 0.5 },
  dusk: { name: '저녁 바람', bpm: 60, beats: 4, root: 57, scale: MINOR, prog: [0, 5, 2, 6], bars: 32, pad: 0.6, arp: { vol: 0.46, oct: 1, pat: [0, -1, 2, -1, 1, -1, 2, -1], wave: 'pluck' }, lead: { vol: 0.4, oct: 1, dens: 0.3, wave: 'rhodes' }, bass: { vol: 0.4 }, rev: 0.6 },
  stars: { name: '별밤', bpm: 48, beats: 4, root: 62, scale: DORIAN, prog: [0, 3, 0, 4], bars: 24, pad: 0.7, arp: { vol: 0.4, oct: 1, pat: [0, -1, -1, -1, 2, -1, -1, -1], wave: 'bell' }, lead: { vol: 0.36, oct: 1, dens: 0.2, wave: 'bell' }, bass: { vol: 0.3 }, rev: 0.8 },
  lake: { name: '새벽 호수', bpm: 52, beats: 4, root: 64, scale: MINOR, prog: [0, 3, 5, 4], bars: 24, pad: 0.7, arp: { vol: 0.4, oct: 0, pat: [-1, 0, -1, 1, -1, 2, -1, -1], wave: 'pluck' }, lead: { vol: 0.36, oct: 1, dens: 0.2, wave: 'rhodes' }, bass: { vol: 0.3 }, rev: 0.8 },
  home: { name: '아늑한 집', bpm: 96, beats: 3, root: 72, scale: MAJOR, prog: [0, 5, 3, 4], bars: 32, arp: { vol: 0.42, oct: 0, pat: [0, 2, 1, 2, 1, 2], wave: 'bell' }, lead: { vol: 0.4, oct: 1, dens: 0.36, wave: 'bell' }, bass: { vol: 0.28 }, rev: 0.45 },
  mine: { name: '금광', bpm: 80, beats: 4, root: 50, scale: MINOR, prog: [0, 0, 5, 6], bars: 32, pad: 0.35, arp: { vol: 0.5, oct: 1, pat: [0, 2, 1, 2, 0, 2, 1, 3], wave: 'marimba' }, lead: { vol: 0.3, oct: 3, dens: 0.14, wave: 'bell' }, bass: { vol: 0.4 }, drone: true, rev: 0.9 },
  winter: { name: '얼음 낚시터', bpm: 72, beats: 4, root: 67, scale: MAJOR, prog: [0, 5, 3, 4], bars: 32, pad: 0.4, arp: { vol: 0.22, oct: 1, pat: [0, 1, 2, 3, 2, 1, 2, 1], wave: 'bell' }, lead: { vol: 0.3, oct: 1, dens: 0.3, wave: 'bell' }, bass: { vol: 0.3 }, drums: 'sleigh', rev: 0.7 },
  race: { name: '경마장', bpm: 138, beats: 4, root: 60, scale: MAJOR, prog: [0, 0, 3, 4, 0, 5, 3, 4], bars: 32, arp: { vol: 0.2, oct: 0, pat: [0, 2, 1, 2, 0, 2, 1, 2], wave: 'square' }, lead: { vol: 0.3, oct: 1, dens: 0.6, wave: 'brass' }, bass: { vol: 0.42, walk: true }, drums: 'gallop', rev: 0.15 },
  slots: { name: '슬롯 방', bpm: 120, beats: 4, root: 65, scale: MAJOR, prog: [0, 3, 4, 3], bars: 32, arp: { vol: 0.2, oct: 0, pat: [0, 1, 2, 3, 2, 1, 0, -1], wave: 'square' }, lead: { vol: 0.26, oct: 1, dens: 0.5, wave: 'square' }, bass: { vol: 0.4 }, drums: 'bounce', rev: 0.15 },
  poker: { name: '포커 방', bpm: 88, beats: 4, root: 50, scale: DORIAN, prog: [1, 4, 0, 0], bars: 32, arp: { vol: 0.34, oct: 1, pat: [0, -1, 2, -1, 1, -1, 2, -1], wave: 'rhodes' }, lead: { vol: 0.32, oct: 2, dens: 0.24, wave: 'rhodes' }, bass: { vol: 0.45, walk: true }, drums: 'swing', swing: 0.3, rev: 0.35 },
  home2: { name: '창가의 오후', bpm: 80, beats: 4, root: 65, scale: MAJOR, prog: [0, 3, 1, 4], bars: 32, pad: 0.35, arp: { vol: 0.4, oct: 0, pat: [0, -1, 2, 1, -1, 2, 1, -1], wave: 'rhodes' }, lead: { vol: 0.38, oct: 1, dens: 0.3, wave: 'pluck' }, bass: { vol: 0.3 }, rev: 0.45 },
  mine2: { name: '깊은 갱도', bpm: 66, beats: 4, root: 48, scale: DORIAN, prog: [0, 3, 0, 6], bars: 28, pad: 0.4, arp: { vol: 0.46, oct: 1, pat: [0, -1, 2, -1, 1, 2, -1, 3], wave: 'marimba' }, lead: { vol: 0.28, oct: 3, dens: 0.12, wave: 'bell' }, bass: { vol: 0.4 }, drone: true, rev: 0.9 },
  winter2: { name: '첫눈', bpm: 96, beats: 3, root: 62, scale: MAJOR, prog: [0, 4, 5, 3], bars: 40, pad: 0.4, arp: { vol: 0.26, oct: 1, pat: [0, 2, 1, 2, 3, 2], wave: 'bell' }, lead: { vol: 0.3, oct: 1, dens: 0.28, wave: 'pluck' }, bass: { vol: 0.3 }, rev: 0.7 },
  race2: { name: '결승선', bpm: 144, beats: 4, root: 62, scale: MAJOR, prog: [0, 3, 0, 4, 5, 3, 4, 0], bars: 32, arp: { vol: 0.2, oct: 0, pat: [0, 1, 2, 1, 0, 1, 2, 3], wave: 'square' }, lead: { vol: 0.3, oct: 1, dens: 0.55, wave: 'brass' }, bass: { vol: 0.42, walk: true }, drums: 'gallop', rev: 0.15 },
  slots2: { name: '잭팟 거리', bpm: 126, beats: 4, root: 60, scale: MAJOR, prog: [0, 5, 3, 4], bars: 32, arp: { vol: 0.2, oct: 1, pat: [0, 2, 1, 2, 3, 2, 1, 2], wave: 'square' }, lead: { vol: 0.26, oct: 1, dens: 0.45, wave: 'square' }, bass: { vol: 0.4 }, drums: 'bounce', rev: 0.15 },
  poker2: { name: '늦은 밤 테이블', bpm: 76, beats: 4, root: 45, scale: MINOR, prog: [0, 3, 4, 0], bars: 32, arp: { vol: 0.34, oct: 2, pat: [-1, 0, -1, 2, -1, 1, -1, 2], wave: 'rhodes' }, lead: { vol: 0.3, oct: 2, dens: 0.22, wave: 'rhodes' }, bass: { vol: 0.45, walk: true }, drums: 'swing', swing: 0.3, rev: 0.4 },
  mafia2: { name: '그림자', bpm: 54, beats: 4, root: 43, scale: PHRYG, prog: [0, 5, 1, 0], bars: 24, pad: 0.5, lead: { vol: 0.28, oct: 3, dens: 0.18, wave: 'bell' }, bass: { vol: 0.35 }, drums: 'heart', drone: true, rev: 0.8 },
  // 클럽 (2026-11-18): 박마다 킥이 들어가는 빠른 전자 음악. 다른 곡과 달리 쉬지 않고 이어진다
  // 클럽 (2026-11-19 다시 만듦): 구간이 있는 EDM 세 곡 (edm.ts). 빅룸 하우스 · 퓨처 하우스 · 트랜스. 가락(hook)은 한 마디 16칸: 숫자·글자 = 음계의 몇 번째 음, '-' = 잇기, '.' = 쉼
  club1: edmTune('네온 드롭', { bpm: 128, root: 65, scale: MINOR, prog: [0, 5, 2, 6, 0, 5, 3, 4], bass: 'offbeat', lead: 'saw', gain: 1,
    hook: ['7--7--7-9-7-6-4-', '5--5--5-6-5-4-2-', '4--4--4-6-4-2-4-', '6--6--6-7-6-4-6-', '7--7--7-9-7-6-4-', '5--5--5-6-5-4-2-', '7--7--7-5-7-9-a-', 'b---b-a-8---6-4-'] }),
  club2: edmTune('바운스 하우스', { bpm: 126, root: 57, scale: MINOR, prog: [0, 0, 5, 6, 0, 0, 3, 4], bass: 'bounce', lead: 'pluck', gain: 1, swing: 0.12,
    bounce: [0, null, null, 0, null, null, 12, null, null, 0, null, null, 7, null, 12, null], stabs: '..x...x..x....x.',
    hook: ['b-e-g---e-b-e---', 'g-i-g-e-----b-d-', 'g-e-c---e-g-j---', 'h-f-d---f-h-k---', 'b-e-g---e-b-e---', 'g-i-g-e-----i-j-', 'h-e-c---e-h-j---', 'i-f-d-b-d-f-i-k-'] }),
  club3: edmTune('새벽 질주', { bpm: 138, root: 62, scale: MINOR, prog: [0, 5, 2, 6, 0, 5, 3, 4], bass: 'roll', lead: 'saw', gain: 1, arp: true,
    hook: ['4---7---9--8--7-', '9---7---5--7--9-', 'b---9---b--9--8-', '8---a---8--6--4-', '4---7---9--b--9-', 'c---9---7--9--c-', 'a---c---a--9--7-', 'b---d---b-d-e---'] }),
  mafia: { name: '마피아', bpm: 60, beats: 4, root: 45, scale: PHRYG, prog: [0, 1, 0, 5], bars: 24, pad: 0.5, lead: { vol: 0.3, oct: 3, dens: 0.2, wave: 'bell' }, bass: { vol: 0.35 }, drums: 'heart', drone: true, rev: 0.8 },
};
// 클럽 곡 하나: 마디 수는 편곡의 길이, 나머지 악기 칸은 쓰지 않는다 (Synth.bar 가 edm 이 있으면 edm.ts 로 넘긴다)
function edmTune(name: string, edm: EdmSong): Tune { return { name, bpm: edm.bpm, beats: 4, root: edm.root, scale: edm.scale, prog: edm.prog, bars: EDM_BARS, edm }; }
// ---------- 캐롤 (2026-11-21, 건의 반영): 가락이 정해진 곡 ----------
// 크리스마스 철(12/1~12/25, shared/season.ts)에는 광장·집·금광·겨울 낚시터·카지노 방의 곡 대신 캐롤만 나온다 (사용자 결정. 마피아·클럽은 그대로).
// **저작권이 끝난 옛 곡만 적는다** (작곡자가 죽은 지 오래된 전래 캐롤·찬송). 울면 안 돼·루돌프 사슴코·화이트 크리스마스처럼 권리가 살아 있는 곡은 옮겨 적지 말 것.
// 가락은 ABC 표기를 줄인 것이다: 으뜸음을 C 로 적고(root 가 그 C 의 높이를 정한다) 마디는 '|' 로 가른다.
//   C D E F G A B = 가온 도부터, c d e … = 한 옥타브 위, 뒤의 , ' = 한 옥타브 아래·위, 앞의 ^ _ = 반음 올림·내림, z = 쉼
//   뒤의 숫자 = 길이 (2 = 두 칸, 3/2 = 한 칸 반, /2 = 반 칸). 한 마디의 길이를 다 더하면 unit 칸이어야 한다 (tests/ambience.test.mjs 가 본다)
// 화음도 C 를 으뜸으로 적는다 (C F G7 Am Dm D7 E …). 한 마디에 여럿이면 빈칸으로 갈라 같은 길이로 나눈다.
// **이 환경에서는 소리를 들어 볼 수 없다**: 음은 악보대로 적었지만 듣기에 어떤지는 사용자가 들어야 안다 (2026-11-21 에 미리 듣기 파일을 만들어 보냈다)
export interface Song { unit: number; mel: string; chords: string }
interface SongBar { notes: { at: number; dur: number; n: number }[]; chords: number[][] }
const NOTE_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const songCache = new WeakMap<Song, SongBar[]>();
// 화음 이름 → 으뜸음(C)에서 잰 반음 넷 (밑음·3음·5음·맨 위). 으뜸음 둘레에 모이게 F 보다 높은 밑음은 한 옥타브 내린다
export function parseChord(sym: string): number[] {
  const m = /^([A-G])([#b]?)(m?)(7?)$/.exec(sym);
  if (!m) throw new Error(`모르는 화음: ${sym}`);
  let r = NOTE_SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  if (r > 5) r -= 12;
  return [r, r + (m[3] ? 3 : 4), r + 7, r + (m[4] ? 10 : 12)];
}
export function parseSong(so: Song): SongBar[] {
  const hit = songCache.get(so);
  if (hit) return hit;
  const mel = so.mel.split('|').map((s) => s.trim()).filter(Boolean), chords = so.chords.split('|').map((s) => s.trim()).filter(Boolean);
  if (mel.length !== chords.length) throw new Error(`가락 ${mel.length}마디, 화음 ${chords.length}마디`);
  const bars = mel.map((src, i): SongBar => {
    const notes: SongBar['notes'] = [];
    let at = 0;
    for (const m of src.matchAll(/([_^]?)([A-Ga-gz])([,']*)(\d*)(\/(\d*))?/g)) {
      const dur = (m[4] ? +m[4] : 1) / (m[5] ? (m[6] ? +m[6] : 2) : 1);
      if (m[2] !== 'z') {
        const up = m[2] !== m[2].toUpperCase();
        let n = NOTE_SEMI[m[2].toUpperCase()] + (up ? 12 : 0) + (m[1] === '^' ? 1 : m[1] === '_' ? -1 : 0);
        for (const ch of m[3]) n += ch === ',' ? -12 : 12;
        notes.push({ at, dur, n });
      }
      at += dur;
    }
    if (Math.abs(at - so.unit) > 1e-6) throw new Error(`${i + 1}번째 마디의 길이가 ${at} (${so.unit} 이어야 한다): ${src}`);
    return { notes, chords: chords[i].split(/\s+/).map(parseChord) };
  });
  songCache.set(so, bars);
  return bars;
}
interface CarolOpt { bpm: number; beats: number; root: number; unit: number; mel: string; chords: string; rep?: number; lead?: Wave; arp: readonly number[]; drums?: Drums; pad?: number; rev?: number; vol?: number }
function carol(name: string, o: CarolOpt): Tune {
  const song: Song = { unit: o.unit, mel: o.mel, chords: o.chords };
  return {
    name, bpm: o.bpm, beats: o.beats, root: o.root, scale: MAJOR, prog: [0], bars: o.mel.split('|').filter((s) => s.trim()).length * (o.rep ?? 1),
    pad: o.pad ?? 0.4, arp: { vol: 0.3, oct: 0, pat: o.arp, wave: 'pluck' }, lead: { vol: o.vol ?? 0.62, oct: 1, dens: 0, wave: o.lead ?? 'box' }, bass: { vol: 0.34 }, drums: o.drums, rev: o.rev ?? 0.4, song,
  };
}
const ARP4 = [0, 2, 1, 2, 0, 2, 1, 2], ARP3 = [0, 1, 2, 1, 2, 1], ARP6 = [0, 1, 2, 3, 2, 1];
// 같은 마디를 여러 번 적지 않게: 마디들을 ' | ' 로 잇는다
const J = (...parts: string[]): string => parts.join(' | ');
const JB_V = J('G,2 E2 D2 C2', 'G,6 G, G,', 'G,2 E2 D2 C2', 'A,8', 'A,2 F2 E2 D2', 'B,8', 'G2 G2 F2 D2', 'E8', 'G,2 E2 D2 C2', 'G,8', 'G,2 E2 D2 C2', 'A,6 A,2', 'A,2 F2 E2 D2', 'G2 G2 G2 G2', 'A2 G2 F2 D2', 'C4 G4');
const JB_C1 = J('E2 E2 E4', 'E2 E2 E4', 'E2 G2 C3 D', 'E8', 'F2 F2 F3 F', 'F2 E2 E2 E E');
const WW_A = J('C2 C D C B,', 'A,2 A,2 A,2', 'D2 D E D C', 'B,2 G,2 G,2', 'E2 E F E D', 'C2 A,2 G, G,', 'A,2 D2 B,2');
const WW_B = J('C2 C2 C2', 'B,4 B,2', 'C2 B,2 A,2', 'G,4 D2', 'E2 D2 C2', 'G2 G,2 G, G,', 'A,2 D2 B,2', 'C4 G,2');
const WW_AC = 'C | F | D7 | G | E7 | Am | F G7 G7 | C', WW_BC = 'C | G | Am | G | C | G | F G7 G7 | C';
const DH_A = J('G3 F E2 D2', 'C2 D2 E2 C2', 'D E F D E3 D', 'C2 B,2 C4'), DH_AC = 'C | C | G7 C | C G7 C C';
const OT_A = J('C3/2 C/2 C2 D2', 'E3/2 E/2 E3 E', 'D E F2 B,2'), OT_AC = 'C | C | G7';
const SN_1 = 'G3/2 A/2 G E3', SN_5 = 'A2 A c3/2 B/2 A';
const FN_V = J('C3 D E F', 'G4 A B', 'c2 B2 A2', 'G4 A B', 'c2 B2 A2', 'G2 A2 B2', 'c2 G2 F2'), FN_VC = 'C | C C G | Am G F | C C G | Am G F | C F G | C C G7';
const AN_V = J('E2 E2 E2 G2', 'G3 F E4', 'E2 D2 E2 G2', 'E3 D C4'), AN_VC = 'C | G7 C | C | C G7 C C';
const AN_G = J('G4 A G F E', 'F4 G F E D', 'E4 F E D C', 'D3 G, G,4', 'C2 D2 E2 F2'), AN_GC = 'C Am | Dm G7 | C F | G | C G C F';
const HK_1 = J('G,2 C2 C3 B,', 'C2 E2 E2 D2'), HK_9 = J('G2 G2 G2 C2', 'F2 E2 E2 D2'), HK_13 = J('A3 A A2 G2', 'F2 E2 F4', 'D2 E F G3 C');
const AM_1 = J('G3 F E2', 'E2 D2 C2', 'C2 B,2 A,2', 'G,4 G,2');
export const CAROL_TUNES: Record<string, Tune> = {
  jingle: carol('징글벨', { bpm: 112, beats: 4, root: 65, unit: 8, arp: ARP4, drums: 'bells', rev: 0.3,
    mel: J(JB_V, JB_C1, 'E2 D2 D2 E2', 'D4 G4', JB_C1, 'G2 G2 F2 D2', 'C8'),
    chords: 'C | C | C | F | Dm | G7 | G7 | C | C | C | C | F | Dm | G7 | G7 | C G7 | C | C | C | C | F | C | D7 | G7 | C | C | C | C | F | C | G7 | C' }),
  wewish: carol('위 위시 유 어 메리 크리스마스', { bpm: 138, beats: 3, root: 67, unit: 6, arp: ARP3, drums: 'bells', rev: 0.3,
    mel: J('z4 G,2', WW_A, 'C4 G,2', WW_B, WW_A, 'C4 G,2', WW_B, WW_A, 'C6'),
    chords: J('C', WW_AC, WW_BC, WW_AC, WW_BC, WW_AC) }),
  deck: carol('덱 더 홀스', { bpm: 120, beats: 4, root: 62, unit: 8, arp: ARP4, drums: 'bells', rev: 0.3, rep: 2,
    mel: J(DH_A, DH_A, 'D3 E F2 D2', 'E3 F G2 D2', 'E F G2 A B c2', 'B2 A2 G4', 'G3 F E2 D2', 'C2 D2 E2 C2', 'A A A A G3 F', 'E2 D2 C4'),
    chords: J(DH_AC, DH_AC, 'G7 | C | C D7 | G | C | C | F C | C G7 C C') }),
  tannen: carol('소나무야', { bpm: 92, beats: 3, root: 65, unit: 6, arp: ARP3, rep: 2, rev: 0.5,
    mel: J('z4 G,2', OT_A, 'D2 C2 G,2', OT_A, 'D2 C2 z G', 'G E A3 G', 'G F F3 F', 'F D G3 F', 'F E E2 G,2', OT_A, 'D2 C4'),
    chords: J('C', OT_AC, 'G7 C C', OT_AC, 'G7 C C', 'C F F | G7 | G7 | C', OT_AC, 'G7 C C') }),
  silent: carol('고요한 밤 거룩한 밤', { bpm: 126, beats: 6, root: 58, unit: 6, arp: ARP6, lead: 'bell', pad: 0.6, rev: 0.7, rep: 2,
    mel: J(SN_1, SN_1, 'd2 d B3', 'c2 c G3', SN_5, SN_1, SN_5, SN_1, 'd2 d f3/2 d/2 B', 'c3 e3', 'c G E G3/2 F/2 D', 'C6'),
    chords: 'C | C | G7 | C | F | C | F | C | G7 | C | C G7 | C' }),
  joy: carol('기쁘다 구주 오셨네', { bpm: 80, beats: 2, root: 62, unit: 8, arp: ARP4, rep: 2, rev: 0.35,
    mel: J('c4 B3 A', 'G6 F2', 'E4 D4', 'C6 G2', 'A6 A2', 'B6 B2', 'c6 c2', 'c2 B2 A2 G2', 'G3 F E2 c2', 'c2 B2 A2 G2', 'G3 F E2 E2', 'E2 E2 E2 E F', 'G6 F E', 'D2 D2 D2 D E', 'F6 E D', 'C2 c4 A2', 'G3 F E2 F2', 'E4 D4', 'C8'),
    chords: 'C | C G7 | C G7 | C | F | G7 | C | C | C | C | C | C | C | G7 | G7 | C F | C G7 | C G7 | C' }),
  noel: carol('저 들 밖에 한밤중에', { bpm: 96, beats: 3, root: 62, unit: 6, arp: ARP3, rev: 0.5,
    mel: J('z4 E D', FN_V, 'E4 E D', FN_V, 'E4 E D', 'C3 D E F', 'G4 c B', 'A4 A2', 'G6', 'c2 B2 A2', 'G2 A2 B2', 'c2 G2 F2', 'E6'),
    chords: J('C', FN_VC, 'C', FN_VC, 'C', 'C | C C G | F | C | Am G F | C F G | C C G7 | C') }),
  faithful: carol('참 반가운 성도여', { bpm: 100, beats: 4, root: 67, unit: 8, arp: ARP4, rev: 0.5,
    mel: J('z6 C2', 'C4 G,2 C2', 'D4 G,4', 'E2 D2 E2 F2', 'E4 D2 C2', 'C4 B,2 A,2', 'B,2 C2 D2 E2', 'B,4 A,3 G,', 'G,6 z2', 'G4 F2 E2', 'F4 E4', 'D2 E2 C2 D2', 'B,3 A, G,2 C2', 'C2 B,2 C2 D2', 'C4 G,2 E2', 'E2 D2 E2 F2', 'E4 D2 E2', 'F2 E2 D2 C2', 'B,4 C2 F2', 'E4 D3 C', 'C8'),
    chords: 'C | C | G | C G C F | C C G C | Am | G C G C | G G D7 D7 | G | C | G7 C | G C Am D7 | G G G C | C G C G | C | C G C F | C C G C | F C G Am | G G Am F | C C G7 G7 | C' }),
  angels: carol('천사들의 노래가', { bpm: 112, beats: 4, root: 65, unit: 8, arp: ARP4, rev: 0.45,
    mel: J(AN_V, AN_V, AN_G, 'E4 D4', AN_G, 'E4 D4', 'C8'),
    chords: J(AN_VC, AN_VC, AN_GC, 'C G', AN_GC, 'C G7', 'C') }),
  hark: carol('천사 찬송하기를', { bpm: 108, beats: 4, root: 65, unit: 8, arp: ARP4, rev: 0.45,
    mel: J(HK_1, 'G2 G2 G3 F', 'E2 D2 E4', HK_1, 'G2 D2 D3 B,', 'B,2 A,2 G,4', HK_9, HK_9, HK_13, 'C2 D2 E4', HK_13, 'C2 D2 C4'),
    chords: 'C | C C C G | C | C G C C | C | C C C G | G | G D7 G G | C | F C C G | C | F C C G | F | Dm | G7 C | C G C C | F | Dm | G7 C | C G7 C C' }),
  manger: carol('그 어린 주 예수', { bpm: 92, beats: 3, root: 65, unit: 6, arp: ARP3, lead: 'bell', pad: 0.55, rev: 0.6, rep: 2,
    mel: J('z4 G2', AM_1, 'G,3 A, G,2', 'G,2 D2 B,2', 'A,2 G,2 C2', 'E4 G2', AM_1, 'F3 E D2', 'E2 D2 C2', 'D2 A,2 B,2', 'C6'),
    chords: 'C | C | C | F | C | G7 | G7 | G7 G7 C | C | C | C | F | C | Dm | C | G7 | C' }),
};
// 크리스마스 철에 나오는 곡과, 캐롤로 바뀌는 상황 (마피아의 긴장감과 클럽의 춤곡은 그대로 둔다).
// 열한 곡은 사용자가 미리 듣기 13곡에서 골랐다 (2026-11-21. 뺀 것: Carol of the Bells · God Rest Ye Merry, Gentlemen)
export const CAROL_LIST: readonly string[] = Object.keys(CAROL_TUNES);
const CAROL_SCENES: ReadonlySet<Scene> = new Set<Scene>(['main', 'home', 'mine', 'winter', 'race', 'slots', 'poker']);
const CAROL_GAP: [number, number] = [8, 20];
Object.assign(TUNES, CAROL_TUNES);
const SCENE_TUNES: Record<Scene, { day: string[]; night?: string[]; gap: [number, number] }> = {
  main: { day: ['morning', 'noon', 'meadow', 'dusk'], night: ['stars', 'lake'], gap: [15, 40] },
  home: { day: ['home', 'home2'], gap: [8, 20] },
  mine: { day: ['mine', 'mine2'], gap: [4, 10] },
  winter: { day: ['winter', 'winter2'], gap: [8, 20] },
  race: { day: ['race', 'race2'], gap: [0.5, 1.5] },
  slots: { day: ['slots', 'slots2'], gap: [0.5, 1.5] },
  poker: { day: ['poker', 'poker2'], gap: [0.5, 1.5] },
  mafia: { day: ['mafia', 'mafia2'], gap: [0.5, 2] },
  club: { day: ['club1', 'club2', 'club3'], gap: [0.2, 0.6] },
};

// 한 맥락(실시간 또는 오프라인)에 소리를 그려 넣는 도구
export class Synth {
  private noiseBuf: AudioBuffer | null = null;
  constructor(readonly ac: BaseAudioContext) {}

  private env(g: GainNode, t: number, peak: number, dur: number, attack = 0.005): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, dur));
  }
  tone(out: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number, attack = 0.005): void {
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, vol, dur, attack);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(out: AudioNode, t: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1): void {
    const ac = this.ac;
    if (!this.noiseBuf) { this.noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = ac.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain(); this.env(g, t, vol, dur, 0.004);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  // 효과음 하나. k: 세기·등급 (낚은 물고기 등급 0~4 등)
  sfx(name: Sfx, out: AudioNode, t: number, k = 0): void {
    const T = (type: OscillatorType, f0: number, f1: number, at: number, dur: number, vol: number) => this.tone(out, type, f0, f1, t + at, dur, vol);
    const Nz = (at: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1) => this.noise(out, t + at, dur, vol, type, f0, f1, q);
    const arp = (notes: number[], at: number, gap: number, dur: number, vol: number, type: OscillatorType = 'triangle') => notes.forEach((n, i) => T(type, midi(n), midi(n), at + i * gap, dur, vol));
    switch (name) {
      case 'push': T('sine', 170, 55, 0, 0.18, 0.6); Nz(0, 0.07, 0.3, 'lowpass', 900); break;
      case 'wave': Nz(0, 0.45, 0.45, 'bandpass', 400, 2400, 0.8); T('sine', 110, 50, 0, 0.4, 0.4); break;
      case 'hook': T('triangle', 250, 1500, 0, 0.16, 0.4); T('square', 1200, 900, 0.16, 0.06, 0.14); break;
      case 'pull': T('triangle', 620, 260, 0, 0.22, 0.42); break;
      case 'toss': T('sine', 320, 760, 0, 0.16, 0.4); break;
      case 'hit': T('sine', 880, 440, 0, 0.12, 0.38); T('sine', 660, 990, 0.1, 0.1, 0.24); break;
      case 'block': T('triangle', 1400, 1400, 0, 0.3, 0.26); T('sine', 2100, 2100, 0, 0.25, 0.16); Nz(0, 0.03, 0.2, 'highpass', 5000); break;
      case 'bat': Nz(0, 0.1, 0.45, 'highpass', 2500); T('square', 220, 70, 0, 0.22, 0.22); break;
      case 'snow': Nz(0, 0.12, 0.9, 'lowpass', 1400, 500); break;
      case 'cast': Nz(0, 0.14, 0.22, 'bandpass', 3000, 900, 2); T('sine', 520, 170, 0.3, 0.13, 0.32); break;
      case 'bite': T('sine', 1320, 1320, 0, 0.07, 0.3); T('sine', 1320, 1320, 0.11, 0.07, 0.3); break;
      case 'catch': Nz(0, 0.22, 0.26, 'lowpass', 2200, 500); arp([72, 76, 79, 84, 88, 91].slice(0, 2 + Math.max(0, Math.min(4, k))), 0.08, 0.07, 0.24, 0.26); if (k >= 3) T('sine', midi(96), midi(96), 0.5, 0.6, 0.14); break;
      case 'junk': T('triangle', 300, 180, 0, 0.2, 0.35); break;
      case 'miss': T('triangle', 420, 210, 0, 0.28, 0.36); break;
      case 'swing': Nz(0, 0.16, 0.9, 'bandpass', 1200, 4500, 1.5); break;
      case 'bug': T('sine', 700, 1400, 0, 0.07, 0.34); T('triangle', midi(84 + 2 * Math.min(4, k)), midi(84 + 2 * Math.min(4, k)), 0.07, 0.2, 0.2); break;
      case 'chop': T('square', 190, 85, 0, 0.06, 0.3); Nz(0, 0.05, 0.6, 'bandpass', 1100, 1100, 2); break;
      case 'wood': arp([67, 72], 0, 0.09, 0.18, 0.28, 'sine'); break;
      case 'mine': T('triangle', 2300, 1700, 0, 0.07, 0.34); Nz(0, 0.03, 0.22, 'highpass', 6000); break;
      case 'gold': arp([88, 93], 0, 0.07, 0.22, 0.3, 'sine'); break;
      case 'coin': arp([83, 88], 0, 0.06, 0.18, 0.18, 'square'); break;
      case 'portal': T('sine', 280, 1100, 0, 0.55, 0.32); T('sine', 420, 1650, 0.05, 0.5, 0.1); Nz(0, 0.5, 0.1, 'bandpass', 800, 3000); break;
      case 'door': T('sine', 200, 160, 0, 0.1, 0.32); T('sine', 150, 120, 0.14, 0.14, 0.28); break;
      case 'ui': T('sine', 880, 880, 0, 0.05, 0.25); break;
      case 'on': arp([76, 83], 0, 0.1, 0.25, 0.24, 'sine'); break;
      case 'card': Nz(0, 0.05, 0.5, 'highpass', 4000); break;
      case 'chip': T('triangle', 1800, 1500, 0, 0.04, 0.3); T('triangle', 2100, 1700, 0.05, 0.04, 0.24); break;
      case 'spin': for (let i = 0; i < 8; i++) T('square', 900 + i * 40, 900 + i * 40, i * 0.07, 0.03, 0.16); break;
      case 'win': arp(k >= 2 ? [72, 76, 79, 84, 88, 91, 96] : [72, 76, 79, 84], 0, 0.09, 0.3, 0.24); break;
      case 'lose': T('triangle', 260, 130, 0, 0.4, 0.34); break;
      case 'horn': arp([67, 72, 76, 79], 0, 0.11, 0.16, 0.2, 'sawtooth'); T('sawtooth', midi(84), midi(84), 0.44, 0.45, 0.2); break;
      case 'alarm': for (let i = 0; i < 4; i++) T('square', i % 2 ? 880 : 660, i % 2 ? 880 : 660, i * 0.18, 0.16, 0.2); break;
      case 'stab': T('sawtooth', 140, 50, 0, 0.35, 0.4); Nz(0, 0.2, 0.5, 'lowpass', 600); break;
    }
  }

  // 악기 한 음 (곡용). vol 은 0~1, 실제 크기는 음색마다 맞춰 둔 값을 곱한다
  note(out: AudioNode, wave: Wave, t: number, n: number, dur: number, vol: number): void {
    const f = midi(n);
    switch (wave) {
      case 'pluck': this.tone(out, 'triangle', f, f, t, Math.max(1.2, dur * 1.6), vol * 0.2, 0.006); this.tone(out, 'sine', f * 2, f * 2, t, 0.5, vol * 0.05, 0.004); break;
      case 'bell': this.tone(out, 'sine', f, f, t, Math.max(1.4, dur * 2), vol * 0.17, 0.004); this.tone(out, 'sine', f * 2.76, f * 2.76, t, 0.7, vol * 0.03, 0.003); break;
      case 'marimba': this.tone(out, 'sine', f, f, t, 0.45, vol * 0.24, 0.004); this.tone(out, 'sine', f * 4, f * 4, t, 0.12, vol * 0.05, 0.003); break;
      case 'rhodes': this.tone(out, 'sine', f, f, t, Math.max(1.1, dur * 1.4), vol * 0.2, 0.012); this.tone(out, 'triangle', f * 2, f * 2, t, 0.35, vol * 0.04, 0.008); break;
      case 'square': this.tone(out, 'square', f, f, t, Math.min(0.3, dur), vol * 0.07, 0.004); break;
      case 'brass': this.tone(out, 'sawtooth', f, f, t, Math.min(0.5, dur * 0.95), vol * 0.07, 0.03); this.tone(out, 'triangle', f, f, t, Math.min(0.5, dur * 0.95), vol * 0.1, 0.03); break;
      case 'saw': this.filt(out, f, t, Math.min(0.28, dur), vol * 0.11, 2600, 500); break; // 짧게 끊는 톱니음 (클럽)
      case 'box': this.tone(out, 'sine', f, f, t, Math.max(0.55, dur * 1.25), vol * 0.2, 0.004); this.tone(out, 'triangle', f * 2, f * 2, t, 0.3, vol * 0.045, 0.003); this.tone(out, 'sine', f * 4, f * 4, t, 0.12, vol * 0.02, 0.002); break;
    }
  }
  // 걸러낸 톱니음: 열렸다 닫히는 저역 통과 필터를 지난다 (클럽의 아르페지오와 베이스)
  filt(out: AudioNode, f: number, t: number, dur: number, vol: number, open: number, close: number): void {
    const o = this.ac.createOscillator(), lp = this.ac.createBiquadFilter(), g = this.ac.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t);
    lp.type = 'lowpass'; lp.Q.value = 4; lp.frequency.setValueAtTime(open, t); lp.frequency.exponentialRampToValueAtTime(close, t + dur);
    this.env(g, t, vol, dur, 0.004);
    o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
  // 깔리는 화음: 천천히 올라왔다가 마디 끝에서 사라진다
  pad(out: AudioNode, t: number, notes: number[], dur: number, vol: number): void {
    for (const n of notes) for (const det of [-4, 4]) {
      const o = this.ac.createOscillator(), g = this.ac.createGain();
      o.type = 'triangle'; o.frequency.value = midi(n); o.detune.value = det;
      const peak = Math.max(0.0002, vol * 0.035);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.25);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur * 1.3);
    }
  }
  drum(out: AudioNode, kind: 'kick' | 'snare' | 'hat' | 'brush', t: number, vol: number): void {
    if (kind === 'kick') this.tone(out, 'sine', 120, 45, t, 0.14, vol * 0.5);
    else if (kind === 'snare') this.noise(out, t, 0.1, vol * 0.22, 'bandpass', 1800, 1800, 0.8);
    else if (kind === 'hat') this.noise(out, t, 0.04, vol * 0.1, 'highpass', 7000);
    else this.noise(out, t, 0.12, vol * 0.08, 'bandpass', 3200, 3200, 0.7);
  }

  // 곡의 한 마디를 그린다. t0: 마디가 시작하는 시각, bar: 몇 번째 마디, melody: 미리 지어 둔 가락 (마디 → 박 → 음 또는 null)
  bar(tu: Tune, dry: AudioNode, wet: AudioNode, t0: number, bar: number, melody: (number | null)[][]): void {
    if (tu.edm) { drawEdmBar(this.ac, tu.edm, dry, wet, t0, bar); return; }
    if (tu.song) { this.songBar(tu, tu.song, dry, wet, t0, bar); return; }
    const beat = 60 / tu.bpm, len = beat * tu.beats;
    const deg = tu.prog[bar % tu.prog.length];
    const at = (d: number): number => tu.root + tu.scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7); // 음계의 d 번째 음
    const chord = [at(deg), at(deg + 2), at(deg + 4), at(deg + 7)];
    const both = (fn: (out: AudioNode, k: number) => void) => { fn(dry, 1); if (tu.rev) fn(wet, tu.rev); };
    const fade = bar >= tu.bars - 2 ? (bar === tu.bars - 1 ? 0.45 : 0.75) : bar === 0 ? 0.7 : 1; // 처음과 끝은 조금 작게
    if (tu.pad) both((o, k) => this.pad(o, t0, chord.slice(0, 3).map((n) => n - 12), len, tu.pad! * k * fade));
    if (tu.drone) both((o, k) => this.pad(o, t0, [tu.root - 12, tu.root - 5], len, 0.9 * k * fade));
    if (tu.bass) {
      const b = tu.bass, low = (n: number) => { while (n > 52) n -= 12; return n; };
      if (b.off) { for (let i = 0; i < tu.beats; i++) this.filt(dry, midi(low(chord[0])), t0 + (i + 0.5) * beat, beat * 0.42, b.vol * 0.42 * fade, 900, 180); }
      else if (b.walk) { const steps = [chord[0], chord[1], chord[2], chord[1] + 1]; for (let i = 0; i < tu.beats; i++) this.tone(dry, 'triangle', midi(low(steps[i % 4])), midi(low(steps[i % 4])), t0 + i * beat, beat * 0.9, b.vol * 0.3 * fade, 0.01); }
      else this.tone(dry, 'sine', midi(low(chord[0])), midi(low(chord[0])), t0, len * 0.9, b.vol * 0.34 * fade, 0.02);
    }
    if (tu.arp) {
      const a = tu.arp, step = len / a.pat.length;
      a.pat.forEach((p, i) => {
        if (p < 0) return;
        const sw = tu.swing && i % 2 === 1 ? step * tu.swing : 0;
        both((o, k) => this.note(o, a.wave, t0 + i * step + sw, chord[p] + 12 * a.oct, step * 2, a.vol * k * fade));
      });
    }
    if (tu.lead) {
      const l = tu.lead, row = melody[bar % melody.length];
      row.forEach((d, i) => { if (d !== null) both((o, k) => this.note(o, l.wave, t0 + i * beat, at(d) + 12 * l.oct, beat * 1.5, l.vol * k * fade)); });
    }
    if (tu.drums) this.drums(tu.drums, dry, t0, beat, tu.beats, fade);
  }
  // 가락이 정해진 곡의 한 마디 (캐롤). 화음은 마디마다 적어 둔 것을 쓰고, 한 마디에 여럿이면 같은 길이로 나눈다. 두 번째로 도는 동안에는 가락에 한 옥타브 위의 종소리를 옅게 겹친다
  private songBar(tu: Tune, so: Song, dry: AudioNode, wet: AudioNode, t0: number, bar: number): void {
    const bars = parseSong(so), b = bars[bar % bars.length], pass = Math.floor(bar / bars.length);
    const len = (60 / tu.bpm) * tu.beats, u = len / so.unit, nc = b.chords.length;
    const both = (fn: (out: AudioNode, k: number) => void) => { fn(dry, 1); if (tu.rev) fn(wet, tu.rev); };
    const fade = bar === tu.bars - 1 ? 0.85 : 1;
    const chordAt = (f: number): number[] => b.chords[Math.min(nc - 1, Math.floor(f * nc + 1e-6))].map((x) => tu.root + x);
    if (tu.pad) { const slots = Math.min(nc, 2); for (let i = 0; i < slots; i++) both((o, k) => this.pad(o, t0 + (i * len) / slots, chordAt(i / slots).slice(0, 3).map((n) => n - 12), len / slots, tu.pad! * k * fade)); }
    if (tu.bass) for (let i = 0; i < nc; i++) { let n = chordAt(i / nc)[0]; while (n > 52) n -= 12; this.tone(dry, 'sine', midi(n), midi(n), t0 + (i * len) / nc, (len / nc) * 0.9, tu.bass.vol * 0.34 * fade, 0.02); }
    if (tu.arp) {
      const a = tu.arp, step = len / a.pat.length;
      a.pat.forEach((p, i) => { if (p >= 0) both((o, k) => this.note(o, a.wave, t0 + i * step, chordAt(i / a.pat.length)[p] + 12 * a.oct, step * 2, a.vol * k * fade)); });
    }
    if (tu.lead) {
      const l = tu.lead;
      for (const nt of b.notes) both((o, k) => {
        this.note(o, l.wave, t0 + nt.at * u, tu.root + nt.n + 12 * l.oct, nt.dur * u, l.vol * k * fade);
        if (pass % 2 === 1) this.note(o, 'bell', t0 + nt.at * u, tu.root + nt.n + 12 * (l.oct + 1), nt.dur * u, l.vol * 0.3 * k * fade);
      });
    }
    if (tu.drums) this.drums(tu.drums, dry, t0, 60 / tu.bpm, tu.beats, fade);
  }
  // 썰매 방울 한 번 (캐롤): 높은 쇳소리 셋을 짧게 겹친다. 잡음(hat)을 쓰지 않는다: 잡음은 시작하는 순간 한 표본이 크게 튈 때가 있다
  // (2026-11-21 에 오프라인으로 그려 재다가 알았다. 소리가 시작하는 표본에서는 env 가 아직 걸리지 않아 볼륨이 1 이다. 사인·삼각파는 0 에서 시작해 괜찮다)
  private jingle(out: AudioNode, t: number, vol: number): void { for (const [f, k] of [[4186, 1], [5274, 0.7], [6645, 0.5]] as const) this.tone(out, 'sine', f, f, t, 0.09, vol * 0.022 * k, 0.002); }
  private drums(kind: Drums, out: AudioNode, t0: number, beat: number, beats: number, v: number): void {
    for (let b = 0; b < beats; b++) {
      const t = t0 + b * beat;
      if (kind === 'gallop') { this.drum(out, 'kick', t, 0.8 * v); this.drum(out, 'hat', t + beat * 0.5, 0.7 * v); this.drum(out, 'hat', t + beat * 0.75, 0.9 * v); if (b % 2 === 1) this.drum(out, 'snare', t, 0.7 * v); }
      else if (kind === 'bounce') { if (b % 2 === 0) this.drum(out, 'kick', t, 0.8 * v); else this.drum(out, 'snare', t, 0.6 * v); this.drum(out, 'hat', t + beat * 0.5, 0.8 * v); }
      else if (kind === 'swing') { this.drum(out, 'brush', t, 0.9 * v); this.drum(out, 'brush', t + beat * (2 / 3), 0.6 * v); if (b === 0) this.drum(out, 'kick', t, 0.35 * v); }
      else if (kind === 'heart') { if (b % 2 === 0) { this.drum(out, 'kick', t, 0.7 * v); this.drum(out, 'kick', t + beat * 0.3, 0.5 * v); } }
      else if (kind === 'bells') { this.jingle(out, t, 0.5 * v); this.jingle(out, t + beat * 0.5, 0.28 * v); }
      else if (kind === 'four') { this.drum(out, 'kick', t, 1.15 * v); if (b % 2 === 1) this.drum(out, 'snare', t, 0.8 * v); this.drum(out, 'hat', t + beat * 0.5, 1 * v); this.drum(out, 'hat', t + beat * 0.25, 0.35 * v); this.drum(out, 'hat', t + beat * 0.75, 0.35 * v); }
      else { this.drum(out, 'hat', t, 0.5 * v); this.drum(out, 'hat', t + beat * 0.5, 0.3 * v); }
    }
  }
}

// 곡의 가락을 짓는다: 화음 진행 한 바퀴(마디 수 = prog 길이) 분량. 같은 씨앗이면 같은 가락이라 한 번 트는 동안 되풀이된다
export function composeMelody(tu: Tune, seed: number): (number | null)[][] {
  const r = mulberry32(seed);
  const rows: (number | null)[][] = [];
  let cur = 4;
  for (let b = 0; b < tu.prog.length; b++) {
    const deg = tu.prog[b], row: (number | null)[] = [];
    for (let i = 0; i < tu.beats; i++) {
      if (!tu.lead || r() > (i === 0 ? tu.lead.dens * 1.6 : tu.lead.dens)) { row.push(null); continue; }
      if (i === 0) { const tones = [deg, deg + 2, deg + 4, deg + 7]; cur = tones.reduce((best, x) => (Math.abs(x - cur) < Math.abs(best - cur) ? x : best), tones[0]); } // 첫 박은 화음 음으로
      else cur += [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)];
      cur = Math.max(0, Math.min(9, cur));
      row.push(cur);
    }
    rows.push(row);
  }
  return rows;
}

// ---------- 실시간 재생 ----------
let prefs: SoundPrefs | null = null;
function load(): SoundPrefs {
  if (prefs) return prefs;
  let p: Partial<SoundPrefs> = {};
  try { p = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<SoundPrefs>; } catch { /* 저장소를 못 쓰면 기본값 */ }
  const num = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
  prefs = { on: p.on === true, music: num(p.music, DEFAULTS.music), sfx: num(p.sfx, DEFAULTS.sfx) };
  return prefs;
}
function save(): void { try { localStorage.setItem(KEY, JSON.stringify(load())); } catch { /* ignore */ } }

interface Live { ac: AudioContext; synth: Synth; sfxBus: GainNode; musicBus: GainNode; clubBus: GainNode; wetIn: GainNode }
let live: Live | null = null;
let unlockArmed = false;
function impulse(ac: BaseAudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ac.sampleRate * seconds), buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2.6; }
  return buf;
}
// 소리가 나가는 길: (효과음 | 배경음악 + 울림) → 누르개(갑자기 큰 소리 방지) → 스피커
// 클럽 곡은 따로 나간다 (clubBus): 위의 누르개는 조용한 곡에 맞춰 낮게 걸려 있어서 킥이 뭉개진다. 클럽 길은 넘치는 것만 막는다
export function buildGraph(ac: BaseAudioContext, p: SoundPrefs): { sfxBus: GainNode; musicBus: GainNode; clubBus: GainNode; wetIn: GainNode } {
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.connect(ac.destination);
  const sfxBus = ac.createGain(); sfxBus.gain.value = p.sfx * SFX_GAIN; sfxBus.connect(comp);
  const musicBus = ac.createGain(); musicBus.gain.value = p.music * MUSIC_GAIN; musicBus.connect(comp);
  const rev = ac.createConvolver(); rev.buffer = impulse(ac, 2.6);
  const wetIn = ac.createGain(); wetIn.gain.value = 0.55; wetIn.connect(rev); rev.connect(musicBus);
  const lim = ac.createDynamicsCompressor(); lim.threshold.value = -4; lim.knee.value = 2; lim.ratio.value = 14; lim.attack.value = 0.002; lim.release.value = 0.12; lim.connect(ac.destination);
  const clubBus = ac.createGain(); clubBus.gain.value = p.music * CLUB_GAIN; clubBus.connect(lim);
  return { sfxBus, musicBus, clubBus, wetIn };
}
// ---- 아이폰 (2026-11-18 제보: 아이폰에서는 소리가 나지 않는다. 실제 기기로는 확인하지 못하고 넣었다) ----
// 아이폰은 옆의 무음 스위치가 켜져 있으면 Web Audio 소리를 내지 않는다(동영상·음악은 나는데 웹의 효과음 취급이라 꺼진다). 재생 종류를 playback 으로 바꾸면 무음 스위치와 상관없이 난다.
// iOS 16.4 부터는 navigator.audioSession 으로 바꾸고, 그 전 버전은 소리 없는 <audio> 를 틀어 두는 방법으로 같은 효과를 낸다. 소리를 끄면 되돌린다
interface AudioSessionLike { type: string }
const audioSession = (): AudioSessionLike | undefined => (typeof navigator === 'undefined' ? undefined : (navigator as unknown as { audioSession?: AudioSessionLike }).audioSession);
const isIos = (): boolean => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
let silentEl: HTMLAudioElement | null = null;
function silentWavUrl(): string {
  // 0.5초짜리 무음 WAV (8kHz·8비트·모노)
  const n = 4000, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
  b.fill(128, 44);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
function iosPlayback(on: boolean): void {
  try {
    const s = audioSession();
    if (s) { s.type = on ? 'playback' : 'auto'; return; }
    if (!isIos()) return;
    if (on) { if (!silentEl) { silentEl = document.createElement('audio'); silentEl.loop = true; silentEl.preload = 'auto'; silentEl.setAttribute('playsinline', ''); silentEl.src = silentWavUrl(); } void silentEl.play().catch(() => {}); }
    else silentEl?.pause();
  } catch { /* 지원하지 않는 브라우저: 그대로 둔다 */ }
}
// 사용자가 누른 그 순간에 부른다: 맥락을 깨우고, 옛 아이폰이 요구하는 "누른 순간에 시작한 소리"로 빈 소리 하나를 낸다
function wake(l: Live): void {
  iosPlayback(true);
  void l.ac.resume().catch(() => {});
  try { const s = l.ac.createBufferSource(); s.buffer = l.ac.createBuffer(1, 1, l.ac.sampleRate); s.connect(l.ac.destination); s.start(0); } catch { /* ignore */ }
}
const UNLOCK_EVENTS = ['touchend', 'click', 'pointerup', 'keydown'];
function ensure(): Live | null {
  if (!load().on || typeof window === 'undefined') return null;
  if (!live) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ac = new AC();
    live = { ac, synth: new Synth(ac), ...buildGraph(ac, load()) };
    iosPlayback(true);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') dropTune(0.4); });
  }
  // 멈춰 있으면 깨운다. 아이폰은 뒤로 갔다 오거나 전화가 오면 suspended 가 아니라 interrupted 가 되므로 "running 이 아니면"으로 본다
  if (live.ac.state !== 'running') {
    void live.ac.resume().catch(() => {});
    // 브라우저는 사용자가 한 번 누르기 전에는 소리를 내지 않는다: 켜 둔 채 새로 들어왔으면 첫 입력 때 푼다
    if (!unlockArmed) {
      unlockArmed = true;
      const go = () => {
        if (!live || !load().on) return;
        if (live.ac.state === 'running') { unlockArmed = false; for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, go, true); return; }
        wake(live);
      };
      for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, go, true);
    }
  }
  return live;
}
const audible = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'visible';

export function soundPrefs(): SoundPrefs { return { ...load() }; }
export function soundOn(): boolean { return load().on; }
// 소리 켜기·끄기 (버튼을 누른 그 순간에 불러야 브라우저가 소리를 허락한다)
export function setSoundOn(on: boolean): void {
  load().on = on; save();
  if (on) { const l = ensure(); if (l) { wake(l); void l.ac.resume().then(() => sfx('on')).catch(() => {}); } } // 다시 켤 때는 멈춰 둔 맥락이 풀린 뒤에 알림음
  else { dropTune(0.3); void live?.ac.suspend().catch(() => {}); iosPlayback(false); }
}
export function setVolume(kind: 'music' | 'sfx', v: number): void {
  const p = load(); p[kind] = Math.max(0, Math.min(1, v)); save();
  if (!live) return;
  const g = kind === 'music' ? live.musicBus : live.sfxBus;
  g.gain.setTargetAtTime(p[kind] * (kind === 'music' ? MUSIC_GAIN : SFX_GAIN), live.ac.currentTime, 0.05);
  if (kind === 'music') live.clubBus.gain.setTargetAtTime(p.music * CLUB_GAIN, live.ac.currentTime, 0.05);
}

// 효과음. vol: 0~1 (멀리서 난 남의 소리는 작게), k: 세기·등급. 같은 소리가 한순간(60ms)에 또 오면 한 번만 낸다 (장풍이 여러 명을 치는 경우 등)
const lastAt = new Map<Sfx, number>();
export function sfx(name: Sfx, opt: { vol?: number; k?: number } = {}): void {
  const vol = opt.vol ?? 1;
  if (vol <= 0.02 || !load().on || load().sfx <= 0 || !audible()) return;
  const l = ensure();
  if (!l || l.ac.state !== 'running') return;
  const at = performance.now();
  if (at - (lastAt.get(name) ?? -1e9) < 60) return;
  lastAt.set(name, at);
  let out: AudioNode = l.sfxBus;
  if (vol < 1) { const g = l.ac.createGain(); g.gain.value = vol; g.connect(l.sfxBus); out = g; }
  l.synth.sfx(name, out, l.ac.currentTime + 0.01, opt.k ?? 0);
}
// 남이 낸 소리: 나와의 거리(칸)로 크기를 줄인다. 열두 칸 밖은 안 들린다
export function sfxAt(name: Sfx, dist: number, k = 0): void { sfx(name, { vol: Math.max(0, 1 - dist / 12) * 0.5, k }); }

// ---------- 빗소리 (2026-11-18): 비가 오는 동안 잔잔한 잡음을 깔아 둔다. 세기(0~1)에 따라 커지고, 0 이면 멈춘다. 효과음 음량을 따른다 ----------
let rain: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
export function setRain(level: number): void {
  const on = level > 0.01 && load().on && load().sfx > 0 && audible();
  if (!on) {
    const r = rain; rain = null;
    if (r && live) { const t = live.ac.currentTime; r.gain.gain.setTargetAtTime(0.0001, t, 0.3); try { r.src.stop(t + 1.5); } catch { /* ignore */ } }
    return;
  }
  const l = ensure();
  if (!l || l.ac.state !== 'running') return;
  if (!rain) {
    const ac = l.ac, buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    const gain = ac.createGain(); gain.gain.value = 0.0001;
    src.connect(hp); hp.connect(lp); lp.connect(gain); gain.connect(l.sfxBus);
    src.start();
    rain = { src, gain };
  }
  rain.gain.gain.setTargetAtTime(0.05 * Math.min(1, level), l.ac.currentTime, 0.5);
}

// ---------- 배경음악 ----------
interface Playing { key: string; tune: Tune; dry: GainNode; wet: GainNode; next: number; bar: number; melody: (number | null)[][] }
let want: { scene: Scene; night: boolean; carol: boolean } | null = null;
let playing: Playing | null = null;
let playingGroup = '';
let lastKey = '';
let restUntil = 0;         // 이 시각(맥락 시각)까지는 다음 곡을 틀지 않는다
let pumpTimer = 0;
let plays = 0;

function dropTune(fade: number): void {
  const p = playing, l = live;
  playing = null; playingGroup = '';
  if (!p || !l) return;
  const t = l.ac.currentTime;
  for (const g of [p.dry, p.wet]) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0.0001, t + fade); }
  window.setTimeout(() => { p.dry.disconnect(); p.wet.disconnect(); }, (fade + 3) * 1000);
}
// 다른 음악(클럽 DJ 가 튼 유튜브)이 나오는 동안에는 직접 만든 곡을 멈춘다 (djui.ts 가 켜고 끈다)
let hold = false;
export function setMusicHold(on: boolean): void { hold = on; }
function pump(): void {
  if (!want || !load().on || load().music <= 0 || !audible() || hold) { if (playing) dropTune(0.4); return; }
  const l = ensure();
  if (!l || l.ac.state !== 'running') return;
  // 크리스마스 철에는 캐롤만 나온다 (어느 곳에 있든 같은 묶음이라, 광장에서 집으로 들어가도 하던 곡이 이어진다)
  const carols = want.carol && CAROL_SCENES.has(want.scene) && CAROL_LIST.length > 0;
  const set = SCENE_TUNES[want.scene], list = carols ? CAROL_LIST : want.night && set.night ? set.night : set.day, gap = carols ? CAROL_GAP : set.gap;
  const group = carols ? 'carol' : `${want.scene}|${list === set.night ? 'n' : 'd'}`;
  const now = l.ac.currentTime;
  if (playing && playingGroup !== group) { dropTune(1.2); restUntil = now + 1.5; }
  if (!playing) {
    if (now < restUntil) return;
    // 방금 튼 곡은 피한다 (곡이 하나뿐이면 그 곡)
    const pool = list.length > 1 ? list.filter((k) => k !== lastKey) : list;
    const key = pool[Math.floor(Math.random() * pool.length)];
    const tune = TUNES[key];
    const dry = l.ac.createGain(), wet = l.ac.createGain();
    dry.connect(tune.edm ? l.clubBus : l.musicBus); wet.connect(l.wetIn);
    playing = { key, tune, dry, wet, next: now + 0.25, bar: 0, melody: composeMelody(tune, cyrb53(`${key}|${plays++}|${Math.floor(Date.now() / 3600000)}`)) };
    playingGroup = group; lastKey = key;
  }
  const p = playing;
  const len = (60 / p.tune.bpm) * p.tune.beats;
  while (p.bar < p.tune.bars && p.next < now + 1.2) { l.synth.bar(p.tune, p.dry, p.wet, p.next, p.bar, p.melody); p.next += len; p.bar++; }
  if (p.bar >= p.tune.bars && now > p.next + 0.2) {
    // 곡이 끝났다: 울림이 사라질 때까지 두었다가 치우고, 잠깐 쉰 뒤 다음 곡
    playing = null; playingGroup = '';
    window.setTimeout(() => { p.dry.disconnect(); p.wet.disconnect(); }, 6000);
    restUntil = now + gap[0] + Math.random() * (gap[1] - gap[0]);
  }
}
// 지금 상황에 맞는 배경음악을 튼다 (자주 불러도 된다: 상황이 같으면 하던 곡을 잇는다). carol: 크리스마스 철인가 (그 철에는 캐롤만 나온다)
export function setScene(scene: Scene, night = false, carol = false): void {
  want = { scene, night, carol };
  if (!pumpTimer && typeof window !== 'undefined') pumpTimer = window.setInterval(pump, 250);
}
// 게임에서 나갈 때
export function stopSound(): void {
  want = null;
  if (pumpTimer) { clearInterval(pumpTimer); pumpTimer = 0; }
  dropTune(0.3);
  setRain(0);
}
