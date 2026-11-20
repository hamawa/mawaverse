// 글자가 캐릭터를 가리지 않게 자리를 정하는 판정 (2026-11-20 사용자 요청. 화면으로 확인한 것:
// 펫 이름이 바로 아래 칸에 선 주인의 얼굴을, 위 사람의 칭호+이름표가 아래 사람의 머리를, 남쪽을 볼 때의 "F 낚시" 안내가 내 캐릭터를 통째로 가렸다).
// 좌표는 타일 단위(걷는 중에는 보간된 값). 그리는 쪽(render.ts)이 쓴다:
//  - 펫 이름: 펫 바로 아래 칸에 누가 서 있으면 펫 아래가 아니라 위에 그린다
//  - 이름표(벌칙 칭호·칭호·이름): 바로 아래 칸에 누가 서 있으면 비치게 그린다 (LABEL_FADE: 바탕 상자는 거의 비우고 글자는 그림자를 넣어 읽히게. 이름도 얼굴도 보이게)
//  - 찌 위의 "자동 ★n": 찌가 바로 아래 칸이면(남쪽으로 던졌다) 찌 위(= 내 다리)가 아니라 내 이름표 아래에 붙인다
//  - 안내 글자("F 낚시" 등): 대상 칸이 내 아래 줄이면 대상 칸 위(= 내 몸)가 아니라 내 이름표 아래로 내린다
// box: 바탕 상자의 진하기, text: 글자의 진하기 (전부 0.4 로 흐리게 해 보니 얼굴은 보이는데 이름을 읽기 어려웠다)
export const LABEL_FADE = { box: 0.25, text: 0.85 } as const;

// (ax, ay)의 바로 아래 칸에 (bx, by)가 있나: 같은 세로줄(옆으로 0.7칸 안)이고 아래로 0.3~1.4칸
export function standsBelow(ax: number, ay: number, bx: number, by: number): boolean {
  const dy = by - ay;
  return Math.abs(bx - ax) < 0.7 && dy > 0.3 && dy < 1.4;
}
// (tx, ty)가 (mx, my)의 아래 줄에 있나: 바로 아래와 그 양옆 대각선 (안내 글자는 옆으로 길어서 대각선에 있어도 내 몸에 걸친다)
export function inRowBelow(mx: number, my: number, tx: number, ty: number): boolean {
  const dy = ty - my;
  return dy > 0.5 && dy < 1.5 && Math.abs(tx - mx) < 1.5;
}
