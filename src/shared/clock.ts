// 서버 시각 어림 (2026-11-20, 제보: 갑옷을 다 입은 사람이 빠따를 맞아도 방어 깨짐 표시가 안 뜨고 1분이 유지되지 않는다).
// Firebase 는 연결할 때 한 번 "서버 시각 − 기기 시각"(offset)을 재 준다. 그 뒤에 기기 시계가 튀면(절전에서 깨어난 뒤 늦게 맞춰지는 PC·가상 PC, 손으로 바꾼 시계)
// 기기 시각 + offset 은 그만큼 틀린 채로 다음 연결까지 간다. 라이브 기록의 푸시 키(쓴 화면이 어림한 시각)와 서버가 찍은 시각을 견줘 보니
// 다른 사람은 0.3초 안인데 제보된 사람의 화면만 −455초 ~ +1450초 어긋나 있었다. 그러면:
//  - 뒤처져 있을 때: 빠따에 맞아 올리는 "방어 깨짐"(gb = 내 어림 + 60초)이 남에게는 이미 지난 시각이라 표시가 안 뜨고, 남들은 계속 막힌다고 본다 (칠 때마다 빠따가 또 든다)
//  - 앞서 있을 때: 날아온 밀치기·말랑이·끌기를 "4초 넘게 지난 것"으로 보고 전부 버린다 (보낸 사람의 빠따만 줄어든다). gb 도 규칙(지금 + 70초 이하)에 걸려 거부된다
// 그래서 서버가 방금 찍은 시각(남의 하트비트 hb, 나에게 온 밀치기·말랑이의 t)을 받을 때마다 내 어림과 견줘서 맞춘다. 따로 보내는 것이 없어 전송량은 그대로다.
//  - 서버가 찍은 시각은 실제 지금보다 앞설 수 없다. 내 어림보다 뒤(미래)면 내가 뒤처진 것이 확실하므로 바로 맞춘다
//  - 내 어림보다 앞(과거)이면 내가 앞서 있는 것일 수도, 그 소식이 늦게 온 것일 수도 있다(멈췄다 깨어난 화면에 밀린 소식이 한꺼번에 온다).
//    그래서 그런 값이 연달아 CLOCK_STREAK 번, CLOCK_SPAN_MS 넘게 이어질 때만 그중 가장 덜 어긋난 값으로 맞춘다 (늦게 온 것은 더 어긋나 보일 뿐이라 가장 덜 어긋난 값이 실제에 가깝다)
export const CLOCK_TOLERANCE_MS = 2000; // 이만큼은 그냥 둔다 (전달 지연)
export const CLOCK_STREAK = 3;
export const CLOCK_SPAN_MS = 5000;

export class ServerClock {
  private offset = 0;      // 연결할 때 잰 값
  private fix = 0;         // 그 뒤에 맞춘 값
  private late: { n: number; best: number; since: number } | null = null; // "내가 앞서 있다"로 보이는 값이 이어지는 중: 개수 · 가장 덜 어긋난 값 · 처음 본 때(mono)
  // wall: 기기 시계(Date.now), mono: 멈추지 않는 시계(performance.now)
  constructor(private wall: () => number, private mono: () => number) {}

  now(): number { return this.wall() + this.offset + this.fix; }
  // 지금 맞춰 둔 양 (0 이면 연결할 때 잰 값 그대로)
  fixed(): number { return this.fix; }
  // 연결할 때 새로 잰 값: 그때의 기기 시계가 다시 기준이 된다
  setOffset(offset: number): void { this.offset = offset; this.fix = 0; this.late = null; }
  // 서버가 방금 찍은 시각을 받았다. 맞췄으면 true
  sample(serverTs: number): boolean {
    if (typeof serverTs !== 'number' || !isFinite(serverTs)) return false;
    const err = serverTs - this.now();
    if (err > CLOCK_TOLERANCE_MS) { this.fix += err; this.late = null; return true; } // 내가 뒤처져 있다: 확실하므로 바로
    if (err >= -CLOCK_TOLERANCE_MS) { this.late = null; return false; }               // 맞는다
    const t = this.mono();
    const l = this.late;
    if (!l) { this.late = { n: 1, best: err, since: t }; return false; }
    l.n++; if (err > l.best) l.best = err;
    if (l.n < CLOCK_STREAK || t - l.since < CLOCK_SPAN_MS) return false;
    this.fix += l.best; this.late = null; // 내가 앞서 있다
    return true;
  }
}
