// 볼륨 값을 두 갈래로 나눈다.
//
// <audio>.volume은 0~1을 넘지 못한다. 그래서 100%를 넘는 몫은 Web Audio 그래프의
// 게인으로 낸다. 둘로 나뉘는 만큼 "합쳐서 원래 값"이 깨지기 쉬운 자리다 —
// 양쪽에 같은 값을 다 주면 144%가 되고, 한쪽만 주면 증폭이 사라진다.
// 그래서 계산을 여기 한 곳에 모으고 곱이 원래 값과 같은지 테스트로 못을 박는다.

export const DEFAULT_VOLUME = 1;
export const MAX_VOLUME = 1.2;

/** <audio>에 줄 값. 1을 넘는 만큼은 여기 말고 게인이 담당한다. */
export function mediaVolumeOf(v: number): number {
  return Math.min(v, 1);
}

/** 게인에 줄 증폭 배율. 100% 이하면 1(증폭 없음). */
export function boostOf(v: number): number {
  return Math.max(1, v);
}
