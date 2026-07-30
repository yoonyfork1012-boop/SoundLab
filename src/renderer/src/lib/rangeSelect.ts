// Shift+클릭 범위 선택의 순수 로직.
//
// 기준점(anchor)을 "인덱스"가 아니라 "트랙 id"로 들고 있는 게 핵심이다. 인덱스로 들고 있으면
// 검색어를 바꾸거나 컬럼 정렬을 바꿔 리스트가 재구성된 뒤 shift+클릭했을 때, 그 인덱스가
// 전혀 다른(혹은 존재하지 않는) 행을 가리켜 엉뚱한 범위가 선택된다. id로 두면 기준 트랙이
// 현재 리스트에서 사라진 경우를 "기준 없음"으로 안전하게 판정할 수 있다.

export interface HasId {
  id: number;
}

/**
 * 기준 트랙부터 targetIndex까지의 구간을 반환한다(양 끝 포함).
 * 기준이 없거나 현재 리스트에 없으면 null — 호출부는 단일 선택으로 처리하면 된다.
 * 위/아래 어느 방향으로 끌어도 동작한다.
 */
export function rangeBetween<T extends HasId>(
  list: T[],
  anchorId: number | null,
  targetIndex: number,
): T[] | null {
  if (anchorId === null) return null;
  if (targetIndex < 0 || targetIndex >= list.length) return null;
  const anchorIndex = list.findIndex((item) => item.id === anchorId);
  if (anchorIndex < 0) return null;
  const from = Math.min(anchorIndex, targetIndex);
  const to = Math.max(anchorIndex, targetIndex);
  return list.slice(from, to + 1);
}
