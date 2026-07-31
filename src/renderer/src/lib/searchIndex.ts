// 검색은 렌더러 안에서 전량 메모리 필터로 처리된다(519k 트랙). 트랙당 반복 비용을
// 줄이려고, 검색 대상 필드를 시작 시 한 번만 소문자 문자열로 합쳐 두고(blob) 필터
// 때는 그 문자열에 대해 includes 1회만 검사한다. 인접 필드가 우연히 이어져 매칭되지
// 않도록 널 문자를 구분자로 쓴다. 태그도 서로 이어붙지 않게 각각을 원소로 넣는다 —
// join(" ")으로 합치면 ["kick","drum"]이 "kick drum"이 되어 "ck dr" 같은 질의에 걸린다.
export interface SearchTabLike {
  folder: string | null;
  collection: number | null;
  search: string;
}

const SEP = "\u0000";

export function buildSearchBlob(t: {
  filename: string;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  tags: string[];
}): string {
  return [
    t.filename,
    t.category ?? "",
    t.subcategory ?? "",
    t.description ?? "",
    ...t.tags,
  ]
    .join(SEP)
    .toLowerCase();
}

export function trackMatchesQuery(blob: string, loweredQuery: string): boolean {
  return blob.includes(loweredQuery);
}

// 검색어가 있으면(공백 제외) 검색어를 탭 라벨로, 아니면 null(호출부가 폴더명 fallback).
export function searchTabLabel(
  tab: SearchTabLike,
  _fallback: string,
): string | null {
  const q = tab.search.trim();
  return q ? q : null;
}

// 검색 아닌 탭(search 공백)에서 비어있지 않은 값을 입력하기 시작하면 새 검색 탭을
// 생성한다. 활성 탭이 없어도(빈 워크스페이스) 비어있지 않은 값이면 새 탭.
export function shouldSpawnSearchTab(
  activeTab: SearchTabLike | null,
  nextValue: string,
): boolean {
  if (nextValue.trim() === "") return false;
  if (!activeTab) return true;
  return activeTab.search.trim() === "";
}
