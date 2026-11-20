// 바깥 게임으로 가는 오락기 (2026-11-20, 사용자 요청). 맵의 zone kind 'link' 의 id 로 여는 곳을 찾는다.
// 주소는 코드에만 둔다: 맵 데이터(DB)에 주소를 두면 맵을 고칠 수 있는 사람이 아무 사이트로나 보낼 수 있게 된다.
// 여는 방식은 확인 창의 링크를 직접 누르는 것 하나다 (사용자 결정): F 에서 바로 새 탭을 열면 폰 브라우저가 팝업으로 보고 막을 때가 있다.
export interface GameLink { name: string; url: string; desc: string; hint: string }
export const GAME_LINKS: Record<string, GameLink> = {
  zoo: { name: '동물원 탈출 대소동', url: 'https://zooescape.web.app/', desc: '동물이 되어 장애물을 피해 결승선까지 달리는 레이스 게임이에요. 혼자서도, 친구들과도 할 수 있어요.', hint: 'F 동물원 탈출 대소동' },
};
export function gameLinkOf(zoneId: string | null | undefined): GameLink | null {
  const g = zoneId ? GAME_LINKS[zoneId] : undefined;
  return g && /^https:\/\//.test(g.url) ? g : null;
}
