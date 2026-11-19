// 클럽 음악 (2026-11-19, 사용자 요청: "동요 같고 4마디만 되풀이돼 지루하다. 구성이 있는 신나는 EDM 으로: 다이나믹, 빌드업, 브레이크, 댐핑").
// 곡은 구간으로 짜여 있다 (EDM_FORM): 인트로 → 빌드업 → 드롭 → 브레이크 → 빌드업 → 드롭 → 아웃트로. 68마디, 한 곡에 2분 안팎.
//  - 킥: 높은 데서 뚝 떨어지는 사인파를 살짝 찌그러뜨려 단단하게. 킥이 칠 때마다 베이스·신스를 눌렀다 놓는다(사이드체인) → 펌핑
//  - 빌드업: 필터가 열리고, 스네어가 8분 → 16분 → 32분으로 빨라지고, 잡음이 올라가다가(라이저) 마지막 박에 전부 멈춘다. 낮은 음은 미리 뺀다
//  - 드롭: 쾅 하는 임팩트와 함께 킥·베이스·가락이 한꺼번에 들어온다. 두 번째 드롭은 가락을 한 옥타브 위로도 겹친다
//  - 브레이크: 드럼이 빠지고 깔리는 화음과 가락만 울림 속에 남는다
// 마디마다 악기 하나에 발진기 몇 개만 만들어 음높이·필터·크기를 예약한다 (음마다 노드를 만들면 폰에서 버겁다).
// 이 환경에서는 소리를 들어 볼 수 없다: 구간별 크기(빌드업에서 오르고, 브레이크에서 내려가고, 드롭이 가장 크다)와 낮은 음의 양을
// OfflineAudioContext 로 그려서 재어 맞췄다. 가락이 듣기에 어떤지는 사용자가 들어 봐야 안다.
const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);

export type EdmSect = 'intro' | 'build' | 'drop' | 'break' | 'outro';
export const EDM_FORM: readonly (readonly [EdmSect, number])[] = [['intro', 8], ['build', 8], ['drop', 16], ['break', 8], ['build', 8], ['drop', 16], ['outro', 4]];
export const EDM_BARS = EDM_FORM.reduce((s, [, n]) => s + n, 0);

export interface EdmSong {
  bpm: number;
  root: number;                         // 으뜸음 (MIDI. 가락의 기준 옥타브)
  scale: readonly number[];
  prog: readonly number[];              // 마디마다의 화음: 음계의 몇 번째 음 (8마디 한 바퀴)
  hook: readonly string[];              // 드롭의 가락 8마디. 한 마디 16칸: 0~9·a~z = 음계의 몇 번째 음, '-' = 앞 음을 잇는다, '.' = 쉼
  bass: 'offbeat' | 'bounce' | 'roll';  // offbeat: 박 사이마다 (빅룸) · bounce: 통통 튀는 무늬 (퓨처 하우스) · roll: 킥 자리만 비운 16분 (트랜스)
  bounce?: readonly (number | null)[];  // bass 'bounce' 의 한 마디 16칸: 화음 밑음에서 몇 반음 위 (null = 쉼)
  stabs?: string;                       // 화음을 끊어 치는 자리 16칸 ('x' = 친다)
  arp?: boolean;                        // 16분 아르페지오를 깐다 (트랜스)
  swing?: number;                       // 홀수 번째 16분을 늦추는 양 (16분의 몇 배)
  lead: 'saw' | 'pluck';                // 가락 음색: 두꺼운 톱니 겹침 · 짧게 튕기는 소리
  gain: number;                         // 곡 전체 크기 (오프라인으로 재서 맞춘다)
}

// 몇 번째 마디가 어느 구간의 몇 번째인가. rep: 같은 종류의 구간이 몇 번째로 나왔는가 (두 번째 드롭 = 1)
export function edmSection(bar: number): { kind: EdmSect; i: number; n: number; rep: number } {
  let b = bar;
  const seen: Partial<Record<EdmSect, number>> = {};
  for (const [kind, n] of EDM_FORM) {
    if (b < n) return { kind, i: b, n, rep: seen[kind] ?? 0 };
    b -= n; seen[kind] = (seen[kind] ?? 0) + 1;
  }
  return { kind: 'outro', i: 0, n: 1, rep: 0 };
}
export function hookNotes(row: string): { step: number; deg: number; len: number }[] {
  const out: { step: number; deg: number; len: number }[] = [];
  for (let s = 0; s < row.length; s++) {
    const c = row[s];
    if (c === '.') continue;
    if (c === '-') { if (out.length && out[out.length - 1].step + out[out.length - 1].len === s) out[out.length - 1].len++; continue; }
    out.push({ step: s, deg: parseInt(c, 36), len: 1 });
  }
  return out;
}

// 곡 하나가 쓰는 길 (나가는 노드마다 하나): 킥은 찌그러뜨려 바로 나가고, 베이스·신스는 duck(사이드체인)을 지나 나간다. 신스는 그 앞에 여닫는 필터(lp)를 거친다
interface Rig { ac: BaseAudioContext; out: AudioNode; wet: AudioNode; duck: GainNode; lp: BiquadFilterNode; kickIn: AudioNode; noise: AudioBuffer }
const rigs = new WeakMap<AudioNode, Rig>();
function rigOf(ac: BaseAudioContext, out: AudioNode, wet: AudioNode): Rig {
  let r = rigs.get(out);
  if (r) return r;
  const duck = ac.createGain(); duck.connect(out);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8; lp.frequency.value = 14000; lp.connect(duck);
  const shaper = ac.createWaveShaper();
  const curve = new Float32Array(1025);
  for (let k = 0; k < curve.length; k++) { const x = k / 512 - 1; curve[k] = Math.tanh(2.4 * x) / Math.tanh(2.4); }
  shaper.curve = curve;
  const kickOut = ac.createGain(); kickOut.gain.value = 0.62;
  shaper.connect(kickOut); kickOut.connect(out);
  const noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const d = noise.getChannelData(0);
  for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
  r = { ac, out, wet, duck, lp, kickIn: shaper, noise };
  rigs.set(out, r);
  return r;
}
function send(r: Rig, amount: number): GainNode { const g = r.ac.createGain(); g.gain.value = amount; g.connect(r.wet); return g; }

// 한 마디 동안 사는 단음 악기: 발진기 몇 개 → 저역 통과 필터 → 크기. 음마다 높이·필터·크기를 예약한다 (음은 서로 겹치지 않아야 한다)
class Voice {
  private readonly os: { o: OscillatorNode; semi: number }[] = [];
  private readonly f: BiquadFilterNode;
  private readonly g: GainNode;
  constructor(ac: BaseAudioContext, dests: readonly AudioNode[], spec: readonly (readonly [OscillatorType, number, number])[], t0: number, t1: number, q = 1) {
    this.f = ac.createBiquadFilter(); this.f.type = 'lowpass'; this.f.Q.value = q; this.f.frequency.value = 6000;
    this.g = ac.createGain(); this.g.gain.value = 0;
    this.f.connect(this.g);
    for (const d of dests) this.g.connect(d);
    for (const [type, cents, semi] of spec) {
      const o = ac.createOscillator(); o.type = type; o.detune.value = cents;
      o.connect(this.f); o.start(t0); o.stop(t1 + 0.4);
      this.os.push({ o, semi });
    }
  }
  // t 에 n 음을 dur 동안. 필터는 open 에서 close 로 닫힌다. hold: 크기를 유지하는 비율 (그 뒤로 줄어든다)
  hit(t: number, n: number, dur: number, vol: number, open: number, close: number, attack = 0.004, hold = 0.6): void {
    for (const { o, semi } of this.os) o.frequency.setValueAtTime(midi(n + semi), t);
    this.f.frequency.setValueAtTime(open, t); this.f.frequency.exponentialRampToValueAtTime(Math.max(60, close), t + dur);
    const g = this.g.gain, a = Math.min(attack, dur * 0.3);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(vol, t + a);
    g.setValueAtTime(vol, t + Math.max(a, dur * hold)); g.linearRampToValueAtTime(0, t + dur);
  }
}
// 잡음 한 줄기 (한 마디 동안): 걸러서 크기 0 으로 깔아 두고, 필요한 순간에만 크기를 연다
function noiseLine(r: Rig, dests: readonly AudioNode[], t0: number, t1: number, type: BiquadFilterType, freq: number, q = 0.7): { g: AudioParam; f: AudioParam } {
  const ac = r.ac, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = r.noise; s.loop = true;
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.value = 0;
  s.connect(f); f.connect(g);
  for (const d of dests) g.connect(d);
  s.start(t0, Math.random()); s.stop(t1 + 2.2);
  return { g: g.gain, f: f.frequency };
}
const burst = (g: AudioParam, t: number, vol: number, dur: number): void => {
  g.setValueAtTime(vol, t); g.exponentialRampToValueAtTime(Math.max(0.0004, vol * 0.01), t + dur); g.setValueAtTime(0, t + dur + 0.001);
};

function kick(r: Rig, t: number, vol: number): void {
  const ac = r.ac, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  // 딱 하는 머리(아주 짧게 높은 음) → 몸통(170 → 55Hz) → 꼬리
  o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(170, t + 0.008);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.085); o.frequency.exponentialRampToValueAtTime(46, t + 0.3);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.0015);
  g.gain.setValueAtTime(vol, t + 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + 0.24); g.gain.linearRampToValueAtTime(0, t + 0.26);
  o.connect(g); g.connect(r.kickIn); o.start(t); o.stop(t + 0.3);
}
// 사이드체인: 킥이 치는 순간 베이스·신스를 눌렀다가 다음 박 전에 놓는다
function duckAt(r: Rig, t: number, beat: number, depth: number): void {
  const g = r.duck.gain;
  g.setValueAtTime(1, t); g.linearRampToValueAtTime(1 - depth, t + 0.012); g.linearRampToValueAtTime(1, t + beat * 0.6);
}
function clap(line: { g: AudioParam }, t: number, vol: number): void {
  for (let k = 0; k < 3; k++) burst(line.g, t + k * 0.011, vol * 0.8, 0.009);
  burst(line.g, t + 0.034, vol, 0.15);
}
function crash(r: Rig, t: number, vol: number): void {
  const n = noiseLine(r, [r.out, send(r, 0.5)], t, t, 'highpass', 5200);
  n.g.setValueAtTime(vol, t); n.g.exponentialRampToValueAtTime(0.0005, t + 1.9); n.g.setValueAtTime(0, t + 1.95);
}
// 올라가는 잡음과 음 (빌드업). dur 동안 점점 커지고 높아지다가 끝에서 뚝 끊긴다
function riser(r: Rig, t: number, dur: number, vol: number, n: number): void {
  const ac = r.ac, nz = noiseLine(r, [r.out, send(r, 0.3)], t, t + dur, 'bandpass', 300, 1.4);
  nz.f.setValueAtTime(300, t); nz.f.exponentialRampToValueAtTime(9000, t + dur);
  nz.g.setValueAtTime(0.0008, t); nz.g.exponentialRampToValueAtTime(vol, t + dur); nz.g.linearRampToValueAtTime(0, t + dur + 0.03);
  const o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(midi(n - 12), t); o.frequency.exponentialRampToValueAtTime(midi(n + 12), t + dur);
  lp.type = 'lowpass'; lp.frequency.value = 2600;
  g.gain.setValueAtTime(0.0008, t); g.gain.exponentialRampToValueAtTime(vol * 0.3, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
  o.connect(lp); lp.connect(g); g.connect(r.duck); o.start(t); o.stop(t + dur + 0.1);
}
// 드롭의 첫 박: 낮게 꺼지는 쿵과 아래로 쓸려 내려가는 잡음
function impact(r: Rig, t: number, vol: number): void {
  const ac = r.ac, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.8);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.1); g.gain.linearRampToValueAtTime(0, t + 1.12);
  o.connect(g); g.connect(r.kickIn); o.start(t); o.stop(t + 1.15);
  const nz = noiseLine(r, [r.out, send(r, 0.4)], t, t + 1.2, 'bandpass', 7000, 0.9);
  nz.f.setValueAtTime(7000, t); nz.f.exponentialRampToValueAtTime(220, t + 1.2);
  nz.g.setValueAtTime(vol * 0.45, t); nz.g.exponentialRampToValueAtTime(0.0005, t + 1.2); nz.g.setValueAtTime(0, t + 1.21);
}

const SWEEP: Record<EdmSect, readonly [number, number]> = { intro: [380, 1700], build: [750, 13000], drop: [14000, 14000], break: [3400, 2000], outro: [5000, 320] };
const SAW3: readonly (readonly [OscillatorType, number, number])[] = [['sawtooth', -13, 0], ['sawtooth', 0, 0], ['sawtooth', 13, 0]];
const SAW3_UP: readonly (readonly [OscillatorType, number, number])[] = [...SAW3, ['sawtooth', 6, 12]];
const PLUCK: readonly (readonly [OscillatorType, number, number])[] = [['sawtooth', 0, 0], ['square', 4, 0]];

// 곡의 bar 번째 마디를 t0 부터 그려 넣는다. out: 마른 소리가 나가는 곳, wet: 울림으로 보내는 곳
export function drawEdmBar(ac: BaseAudioContext, song: EdmSong, out: AudioNode, wet: AudioNode, t0: number, bar: number): void {
  const r = rigOf(ac, out, wet);
  const beat = 60 / song.bpm, len = beat * 4, step = beat / 4, t1 = t0 + len;
  const { kind, i, n, rep } = edmSection(bar);
  const G = song.gain * (kind === 'drop' && rep ? 1.12 : 1); // 두 번째 드롭은 조금 더 크게
  const deg = song.prog[i % song.prog.length];
  const at = (d: number): number => song.root + song.scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const chord = [at(deg), at(deg + 2), at(deg + 4)];
  let low = at(deg); while (low > 47) low -= 12; while (low < 36) low += 12; // 베이스는 C2~B2 (작은 스피커에서도 들리는 높이)
  const ts = (s: number): number => t0 + s * step + (song.swing && s % 2 === 1 ? step * song.swing : 0);
  const p0 = i / n, p1 = (i + 1) / n;
  const last = i === n - 1;

  // 신스 전체에 걸린 필터: 구간에 따라 닫혀 있다가 열린다
  const [f0, f1] = SWEEP[kind];
  r.lp.frequency.setValueAtTime(f0 * (f1 / f0) ** p0, t0);
  r.lp.frequency.exponentialRampToValueAtTime(f0 * (f1 / f0) ** p1, t1 - 0.002);

  // ---- 킥과 사이드체인 ----
  const kickVol = kind === 'drop' ? 1 : kind === 'intro' ? 0.5 : kind === 'build' ? (i >= n - 2 ? 0 : 0.66) : kind === 'outro' ? 0.6 * (1 - p0 * 0.5) : 0;
  const depth = kind === 'drop' ? 0.82 : 0.6;
  if (kickVol > 0) for (let b = 0; b < 4; b++) {
    if (kind === 'drop' && last && b === 3) continue; // 드롭의 마지막 박은 비워 다음 구간으로 넘긴다
    kick(r, t0 + b * beat, kickVol * G);
    duckAt(r, t0 + b * beat, beat, depth);
  }

  // ---- 하이햇·클랩·스네어 ----
  const hatVol = (s: number): number => {
    const q = s % 4;
    if (kind === 'drop') return q === 1 ? 0.22 : q === 3 ? 0.3 : 0;
    if (kind === 'intro') return q === 2 ? 0.42 : i >= 4 && q === 3 ? 0.18 : 0;
    if (kind === 'build') return i < n - 4 && q === 2 ? 0.4 : 0;
    if (kind === 'break') return i >= n / 2 && q === 2 ? 0.22 : 0;
    return q === 2 ? 0.4 * (1 - p0 * 0.6) : 0;
  };
  let hat: { g: AudioParam } | null = null;
  for (let s = 0; s < 16; s++) { const v = hatVol(s); if (v > 0) { hat ||= noiseLine(r, [r.out], t0, t1, 'highpass', 8200); burst(hat.g, ts(s), v * 0.9 * G, 0.035); } }
  if (kind === 'drop') { const open = noiseLine(r, [r.out], t0, t1, 'highpass', 6800); for (let b = 0; b < 4; b++) burst(open.g, t0 + (b + 0.5) * beat, 0.5 * G, beat * 0.36); }
  const clapVol = kind === 'drop' ? 0.95 : (kind === 'intro' && i >= 4) || (kind === 'build' && i < n - 4) ? 0.55 : 0;
  if (clapVol > 0) { const c = noiseLine(r, [r.out, send(r, 0.25)], t0, t1, 'bandpass', 1500, 0.8); clap(c, t0 + beat, clapVol * G); if (!(kind === 'drop' && last)) clap(c, t0 + 3 * beat, clapVol * G); }
  // 스네어: 빌드업에서 점점 빨라지고, 드롭의 여덟째·마지막 마디에 짧게 메운다
  const rolls: [number, number][] = []; // [시각, 세기 0~1]
  if (kind === 'build' && i >= n - 4) {
    const k = i - (n - 4); // 0~3
    const grow = (x: number): number => 0.3 + 0.6 * ((k + x) / 4);
    if (k < 2) for (let s = 0; s < 16; s += 2) rolls.push([t0 + s * step, grow(s / 16)]);
    else if (k === 2) for (let s = 0; s < 16; s++) rolls.push([t0 + s * step, grow(s / 16)]);
    else { for (let s = 0; s < 8; s++) rolls.push([t0 + s * step, grow(s / 16)]); for (let s = 16; s < 24; s++) rolls.push([t0 + s * step / 2, grow(s / 32)]); } // 마지막 박은 비운다
  } else if (kind === 'drop' && (i === 7 || last)) { for (let s = last ? 8 : 12; s < 16; s++) rolls.push([t0 + s * step, 0.5 + 0.03 * s]); }
  else if (kind === 'intro' && last) { for (let s = 12; s < 16; s++) rolls.push([t0 + s * step, 0.5]); }
  if (rolls.length) {
    const sn = noiseLine(r, [r.out, send(r, 0.2)], t0, t1, 'bandpass', 2000, 0.7);
    if (kind === 'build') { sn.f.setValueAtTime(1700 + 500 * (i - (n - 4)), t0); sn.f.linearRampToValueAtTime(2200 + 500 * (i - (n - 4)), t1); }
    const body = new Voice(ac, [r.out], [['triangle', 0, 0]], t0, t1);
    rolls.forEach(([t, v], k) => {
      const gap = k + 1 < rolls.length ? rolls[k + 1][0] - t : 0.2; // 다음 타격과 겹치지 않게 (32분에서는 아주 짧다)
      burst(sn.g, t, v * 0.9 * G, Math.min(0.07, gap - 0.006));
      body.hit(t, 55, Math.min(0.05, gap - 0.004), v * 0.26 * G, 3000, 3000, 0.002, 0.2);
    });
  }
  // 라이저·임팩트·크래시
  if (kind === 'build' && i === n - 4) riser(r, t0, len * 4 - beat, 0.6 * G, song.root);
  if (kind === 'break' && i === n - 2) riser(r, t0, len * 2, 0.07 * G, song.root);
  if (kind === 'drop' && i === 0) { impact(r, t0, 0.9 * G); crash(r, t0, 0.45 * G); }
  if (kind === 'drop' && i === 8) crash(r, t0, 0.2 * G);
  if (kind === 'break' && i === 0) crash(r, t0, 0.16 * G);

  // ---- 베이스 ----
  const bassVol = kind === 'drop' ? 1 : kind === 'intro' ? (i >= 4 ? 0.5 : 0) : kind === 'build' ? (i < n - 4 ? 0.62 : 0) : kind === 'outro' ? 0.6 * (1 - p0 * 0.6) : 0;
  const bright = kind === 'drop' ? (rep ? 1 : 0.8) : 0.25;
  if (bassVol > 0) {
    const sub = new Voice(ac, [r.duck], [['sine', 0, 0]], t0, t1);
    const growl = new Voice(ac, [r.duck], [['sawtooth', 0, 0], ['square', 0, 12]], t0, t1, 5);
    const play = (t: number, note: number, dur: number): void => {
      sub.hit(t, note, dur, 0.34 * bassVol * G, 4000, 4000, 0.006, 0.7);
      growl.hit(t, note, dur, 0.1 * bassVol * G, 300 + 2000 * bright, 150, 0.004, 0.5);
    };
    if (song.bass === 'offbeat') for (let b = 0; b < 4; b++) play(t0 + (b + 0.5) * beat, low, beat * 0.46);
    else if (song.bass === 'roll') { for (let s = 0; s < 16; s++) if (s % 4) play(t0 + s * step, low, step * 0.86); }
    else {
      const pat = song.bounce ?? [];
      for (let s = 0; s < 16; s++) {
        const v = pat[s];
        if (v === null || v === undefined) continue;
        let nx = s + 1; while (nx < 16 && (pat[nx] === null || pat[nx] === undefined)) nx++;
        play(ts(s), low + v, Math.min(step * 1.7, ts(nx) - ts(s)) * 0.9);
      }
    }
  } else if (kind === 'break') {
    new Voice(ac, [r.duck], [['sine', 0, 0]], t0, t1).hit(t0, low, len * 0.98, 0.16 * G, 4000, 4000, 0.3, 0.8); // 브레이크: 낮게 깔리는 밑음만
  }

  // ---- 신스 (r.lp 를 지난다) ----
  const syn = r.lp;
  // 깔리는 화음: 브레이크와 아웃트로, 그리고 빌드업의 앞 절반
  if (kind === 'break' || kind === 'outro' || (kind === 'build' && i < n - 4)) {
    const v = (kind === 'break' ? 0.05 : 0.03) * G;
    for (const c of chord) new Voice(ac, [syn, send(r, 0.5)], [['sawtooth', -8, 0], ['sawtooth', 8, 0]], t0, t1, 0.7).hit(t0, c - 12, len * 1.0, v, 1500, 1100, len * 0.3, 0.85);
  }
  // 아르페지오 (트랜스): 16분으로 화음을 오르내린다. 인트로·빌드업·드롭·아웃트로
  if (song.arp && kind !== 'break' && !(kind === 'intro' && i < 2)) {
    const a = new Voice(ac, [syn, send(r, 0.18)], [['sawtooth', 0, 0]], t0, t1, 6);
    const tones = [chord[0], chord[1], chord[2], chord[0] + 12, chord[2], chord[1]];
    const v = (kind === 'drop' ? 0.09 : 0.06) * G, stop = kind === 'build' && last ? 12 : 16;
    for (let s = 0; s < stop; s++) a.hit(t0 + s * step, tones[s % tones.length], step * 0.9, v * (s % 4 === 0 ? 0.6 : 1), 1200 + 3600 * (kind === 'drop' ? 1 : p0), 420, 0.003, 0.3);
  }
  // 화음 끊어 치기: 빌드업(8분 → 마지막 마디는 16분으로 몰아친다)과 드롭
  const stabAt: number[] = [];
  if (kind === 'build') { if (last) for (let s = 0; s < 12; s++) stabAt.push(s); else for (let s = 0; s < 16; s += 2) stabAt.push(s); }
  else if (kind === 'drop' && song.stabs) { for (let s = 0; s < 16; s++) if (song.stabs[s] === 'x') stabAt.push(s); }
  else if (kind === 'intro' && i >= 2 && !song.arp) { for (const s of [2, 6, 10, 14]) stabAt.push(s); }
  if (stabAt.length) {
    const v = (kind === 'drop' ? 0.055 : kind === 'build' ? 0.04 + 0.09 * p0 : 0.04) * G;
    const durOf = (k: number): number => Math.min(step * 1.5, (ts(k + 1 < stabAt.length ? stabAt[k + 1] : 16) - ts(stabAt[k])) * 0.9); // 다음 타격과 겹치지 않게
    for (const c of chord) { const sv = new Voice(ac, [syn, send(r, 0.15)], [['sawtooth', -9, 0], ['sawtooth', 9, 0]], t0, t1, 1.5); stabAt.forEach((s, k) => sv.hit(ts(s), c, durOf(k), v, 7500, 1100, 0.004, 0.45)); }
  }
  // 가락: 드롭에서는 크게, 브레이크와 빌드업 앞 절반에서는 작게 미리 들려준다
  const leadVol = kind === 'drop' ? 1 : kind === 'break' ? 0.42 : kind === 'build' && i < n - 4 ? 0.4 : 0;
  if (leadVol > 0) {
    const soft = kind !== 'drop';
    const spec = soft || song.lead === 'pluck' ? PLUCK : rep || i >= 8 ? SAW3_UP : SAW3;
    const lv = new Voice(ac, [syn, send(r, soft ? 0.45 : 0.22)], spec, t0, t1, song.lead === 'pluck' || soft ? 4 : 1.2);
    const base = (song.lead === 'pluck' || soft ? 0.15 : 0.085) * leadVol * G;
    for (const h of hookNotes(song.hook[i % song.hook.length])) {
      const dur = (ts(h.step + h.len) - ts(h.step)) * 0.92;
      if (song.lead === 'pluck' || soft) lv.hit(ts(h.step), at(h.deg), Math.min(dur, step * 3), base, 4200, 600, 0.003, 0.25);
      else lv.hit(ts(h.step), at(h.deg), dur, base, 9000, 3800, 0.005, 0.8);
    }
  }
}
