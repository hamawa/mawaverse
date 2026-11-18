// 소리 (2026-11-18, 사용자 요청): 효과음과 배경음악. 소리 파일 없이 Web Audio 로 그 자리에서 합성한다 (저작권·용량·호스팅 전송량 걱정이 없다. 곡은 전부 이 파일의 숫자로 적은 것이다).
// 처음에는 꺼져 있고(사용자 결정: 회사·공공장소에서 갑자기 소리가 나지 않게) 화면 위 🔇 버튼으로 켠다. 설정은 이 브라우저에만 적는다 (mv-sound).
// 어디서든 sfx('catch') 처럼 부른다: 꺼져 있거나 화면이 뒤에 있으면 아무 일도 하지 않는다. 테스트(Node)에서도 불러올 수 있게 모듈을 읽을 때는 아무것도 만들지 않는다.
import { mulberry32, cyrb53 } from '../shared/hash';

export type Sfx =
  | 'push' | 'wave' | 'hook' | 'pull' | 'toss' | 'hit' | 'block' | 'bat' | 'snow'
  | 'cast' | 'bite' | 'catch' | 'junk' | 'miss' | 'swing' | 'bug'
  | 'chop' | 'wood' | 'mine' | 'gold' | 'coin' | 'portal' | 'door' | 'ui' | 'on'
  | 'card' | 'chip' | 'spin' | 'win' | 'lose' | 'horn' | 'alarm' | 'stab';
// 배경음악이 달라지는 상황. main 은 여러 곡이 돌아가며 나오고 밤에는 밤 곡이 나온다
export type Scene = 'main' | 'home' | 'mine' | 'winter' | 'race' | 'slots' | 'poker' | 'mafia';

export interface SoundPrefs { on: boolean; music: number; sfx: number }
const KEY = 'mv-sound';
const DEFAULTS: SoundPrefs = { on: false, music: 0.6, sfx: 0.7 };
const MUSIC_GAIN = 1.5, SFX_GAIN = 1; // 음량 설정에 곱하는 값 (오프라인으로 그려 잰 크기에 맞췄다: 기본 설정에서 배경음악은 작게 깔리고 효과음은 그보다 또렷하게)

const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);

// ---------- 소리 만들기 (실시간·오프라인 공용: 음량 점검은 OfflineAudioContext 로 한다) ----------
type Wave = 'pluck' | 'bell' | 'marimba' | 'rhodes' | 'square' | 'brass';
type Drums = 'gallop' | 'bounce' | 'swing' | 'heart' | 'sleigh';
export interface Tune {
  name: string; bpm: number; beats: number; root: number; scale: readonly number[]; prog: readonly number[]; bars: number;
  pad?: number;                                              // 깔리는 화음의 크기
  arp?: { vol: number; oct: number; pat: readonly number[]; wave: Wave }; // 한 마디를 pat 길이로 나눠 화음 음을 친다 (-1 = 쉼)
  lead?: { vol: number; oct: number; dens: number; wave: Wave };          // 가락: 박마다 dens 확률로 한 음
  bass?: { vol: number; walk?: boolean };
  drums?: Drums; swing?: number; drone?: boolean; rev?: number;           // rev: 울림(잔향)으로 보내는 양
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
  mafia: { name: '마피아', bpm: 60, beats: 4, root: 45, scale: PHRYG, prog: [0, 1, 0, 5], bars: 24, pad: 0.5, lead: { vol: 0.3, oct: 3, dens: 0.2, wave: 'bell' }, bass: { vol: 0.35 }, drums: 'heart', drone: true, rev: 0.8 },
};
const SCENE_TUNES: Record<Scene, { day: string[]; night?: string[]; gap: [number, number] }> = {
  main: { day: ['morning', 'noon', 'meadow', 'dusk'], night: ['stars', 'lake'], gap: [15, 40] },
  home: { day: ['home'], gap: [8, 20] },
  mine: { day: ['mine'], gap: [4, 10] },
  winter: { day: ['winter'], gap: [8, 20] },
  race: { day: ['race'], gap: [0.5, 1.5] },
  slots: { day: ['slots'], gap: [0.5, 1.5] },
  poker: { day: ['poker'], gap: [0.5, 1.5] },
  mafia: { day: ['mafia'], gap: [0.5, 2] },
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
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(out: AudioNode, t: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1): void {
    const ac = this.ac;
    if (!this.noiseBuf) { this.noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = ac.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain(); this.env(g, t, vol, dur, 0.004);
    s.connect(f).connect(g).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
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
    }
  }
  // 깔리는 화음: 천천히 올라왔다가 마디 끝에서 사라진다
  pad(out: AudioNode, t: number, notes: number[], dur: number, vol: number): void {
    for (const n of notes) for (const det of [-4, 4]) {
      const o = this.ac.createOscillator(), g = this.ac.createGain();
      o.type = 'triangle'; o.frequency.value = midi(n); o.detune.value = det;
      const peak = Math.max(0.0002, vol * 0.035);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.25);
      o.connect(g).connect(out); o.start(t); o.stop(t + dur * 1.3);
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
      if (b.walk) { const steps = [chord[0], chord[1], chord[2], chord[1] + 1]; for (let i = 0; i < tu.beats; i++) this.tone(dry, 'triangle', midi(low(steps[i % 4])), midi(low(steps[i % 4])), t0 + i * beat, beat * 0.9, b.vol * 0.3 * fade, 0.01); }
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
  private drums(kind: Drums, out: AudioNode, t0: number, beat: number, beats: number, v: number): void {
    for (let b = 0; b < beats; b++) {
      const t = t0 + b * beat;
      if (kind === 'gallop') { this.drum(out, 'kick', t, 0.8 * v); this.drum(out, 'hat', t + beat * 0.5, 0.7 * v); this.drum(out, 'hat', t + beat * 0.75, 0.9 * v); if (b % 2 === 1) this.drum(out, 'snare', t, 0.7 * v); }
      else if (kind === 'bounce') { if (b % 2 === 0) this.drum(out, 'kick', t, 0.8 * v); else this.drum(out, 'snare', t, 0.6 * v); this.drum(out, 'hat', t + beat * 0.5, 0.8 * v); }
      else if (kind === 'swing') { this.drum(out, 'brush', t, 0.9 * v); this.drum(out, 'brush', t + beat * (2 / 3), 0.6 * v); if (b === 0) this.drum(out, 'kick', t, 0.35 * v); }
      else if (kind === 'heart') { if (b % 2 === 0) { this.drum(out, 'kick', t, 0.7 * v); this.drum(out, 'kick', t + beat * 0.3, 0.5 * v); } }
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

interface Live { ac: AudioContext; synth: Synth; sfxBus: GainNode; musicBus: GainNode; wetIn: GainNode }
let live: Live | null = null;
let unlockArmed = false;
function impulse(ac: BaseAudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ac.sampleRate * seconds), buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2.6; }
  return buf;
}
// 소리가 나가는 길: (효과음 | 배경음악 + 울림) → 누르개(갑자기 큰 소리 방지) → 스피커
export function buildGraph(ac: BaseAudioContext, p: SoundPrefs): { sfxBus: GainNode; musicBus: GainNode; wetIn: GainNode } {
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.connect(ac.destination);
  const sfxBus = ac.createGain(); sfxBus.gain.value = p.sfx * SFX_GAIN; sfxBus.connect(comp);
  const musicBus = ac.createGain(); musicBus.gain.value = p.music * MUSIC_GAIN; musicBus.connect(comp);
  const rev = ac.createConvolver(); rev.buffer = impulse(ac, 2.6);
  const wetIn = ac.createGain(); wetIn.gain.value = 0.55; wetIn.connect(rev); rev.connect(musicBus);
  return { sfxBus, musicBus, wetIn };
}
function ensure(): Live | null {
  if (!load().on || typeof window === 'undefined') return null;
  if (!live) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ac = new AC();
    live = { ac, synth: new Synth(ac), ...buildGraph(ac, load()) };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') dropTune(0.4); });
  }
  if (live.ac.state === 'suspended') {
    void live.ac.resume().catch(() => {});
    // 브라우저는 사용자가 한 번 누르기 전에는 소리를 내지 않는다: 켜 둔 채 새로 들어왔으면 첫 입력 때 푼다
    if (!unlockArmed) {
      unlockArmed = true;
      const go = () => { void live?.ac.resume().catch(() => {}); if (live?.ac.state === 'running') { unlockArmed = false; for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, go, true); } };
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, go, true);
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
  if (on) { const l = ensure(); if (l) void l.ac.resume().then(() => sfx('on')).catch(() => {}); } // 다시 켤 때는 멈춰 둔 맥락이 풀린 뒤에 알림음
  else { dropTune(0.3); void live?.ac.suspend().catch(() => {}); }
}
export function setVolume(kind: 'music' | 'sfx', v: number): void {
  const p = load(); p[kind] = Math.max(0, Math.min(1, v)); save();
  if (!live) return;
  const g = kind === 'music' ? live.musicBus : live.sfxBus;
  g.gain.setTargetAtTime(p[kind] * (kind === 'music' ? MUSIC_GAIN : SFX_GAIN), live.ac.currentTime, 0.05);
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

// ---------- 배경음악 ----------
interface Playing { key: string; tune: Tune; dry: GainNode; wet: GainNode; next: number; bar: number; melody: (number | null)[][] }
let want: { scene: Scene; night: boolean } | null = null;
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
function pump(): void {
  if (!want || !load().on || load().music <= 0 || !audible()) { if (playing) dropTune(0.4); return; }
  const l = ensure();
  if (!l || l.ac.state !== 'running') return;
  const set = SCENE_TUNES[want.scene], list = want.night && set.night ? set.night : set.day;
  const group = `${want.scene}|${list === set.night ? 'n' : 'd'}`;
  const now = l.ac.currentTime;
  if (playing && playingGroup !== group) { dropTune(1.2); restUntil = now + 1.5; }
  if (!playing) {
    if (now < restUntil) return;
    // 방금 튼 곡은 피한다 (곡이 하나뿐이면 그 곡)
    const pool = list.length > 1 ? list.filter((k) => k !== lastKey) : list;
    const key = pool[Math.floor(Math.random() * pool.length)];
    const tune = TUNES[key];
    const dry = l.ac.createGain(), wet = l.ac.createGain();
    dry.connect(l.musicBus); wet.connect(l.wetIn);
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
    restUntil = now + set.gap[0] + Math.random() * (set.gap[1] - set.gap[0]);
  }
}
// 지금 상황에 맞는 배경음악을 튼다 (자주 불러도 된다: 상황이 같으면 하던 곡을 잇는다)
export function setScene(scene: Scene, night = false): void {
  want = { scene, night };
  if (!pumpTimer && typeof window !== 'undefined') pumpTimer = window.setInterval(pump, 250);
}
// 게임에서 나갈 때
export function stopSound(): void {
  want = null;
  if (pumpTimer) { clearInterval(pumpTimer); pumpTimer = 0; }
  dropTune(0.3);
}
