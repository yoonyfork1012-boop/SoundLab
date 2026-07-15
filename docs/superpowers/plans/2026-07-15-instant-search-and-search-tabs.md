# 즉각 검색 + 검색 결과 탭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 519k 트랙 라이브러리에서 검색 입력이 끊기지 않게 하고, 검색 시 검색어를 이름으로 한 전역 검색 탭을 새로 열어 원래 폴더 뷰를 보존한다.

**Architecture:** 순수 로직(검색 인덱스 문자열 빌더, 검색 탭 생성 판단, 탭 라벨)을 `src/renderer/src/lib/searchIndex.ts`로 추출해 vitest로 단위 테스트한다. 그 위에서 `App.tsx`가 `useDeferredValue`로 검색어를 지연 처리하고, 사전 계산한 소문자 인덱스로 필터를 트랙당 1회 `includes`로 축소하며, 검색어를 `WorkspaceTab`에 종속시켜 검색 시 새 탭을 생성한다.

**Tech Stack:** Electron + React 18 + TypeScript, electron-vite(Vite), vitest(신규 devDep, 순수 로직 단위 테스트용).

## Global Constraints

- 클라우드/계정/구독 기능 금지 (로컬 전용 앱).
- 항상 한국어로 응답/커밋 메시지 작성.
- 대용량(519k 트랙) 기준: 렌더 경로에서 전체 배열 전체순회를 새로 늘리지 말 것. 필터는 트랙당 1회 문자열 검사로 유지.
- DB 스키마 / IPC / 메인 프로세스 변경 없음. 변경은 `src/renderer/src/`에 한정.
- 검색 대상은 항상 전체 라이브러리(폴더/컬렉션 범위 무시).
- 커밋 메시지 말미:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

- `src/renderer/src/lib/searchIndex.ts` — **생성**. 순수 함수 3종:
  `buildSearchBlob(track)`, `trackMatchesQuery(blob, query)`,
  `searchTabLabel(tab, fallback)`, `shouldSpawnSearchTab(activeTab, value)`.
  App.tsx가 이 함수들을 소비한다.
- `src/renderer/src/lib/searchIndex.test.ts` — **생성**. 위 함수들의 vitest 테스트.
- `src/renderer/src/App.tsx` — **수정**. 지연 검색어, 사전 인덱스, 검색 탭 모델 배선.
- `package.json` — **수정**. vitest devDep + `test` 스크립트.
- `vitest.config.ts` — **생성**. jsdom 불필요(순수 로직), node 환경.

---

## Task 1: vitest 설치 + 순수 검색 로직 모듈 (TDD)

**Files:**

- Create: `src/renderer/src/lib/searchIndex.ts`
- Test: `src/renderer/src/lib/searchIndex.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts + devDependencies)

**Interfaces:**

- Consumes: `Track`, `WorkspaceTab` 타입. `Track`은 `@shared/types`에서 import
  (필드: `filename: string`, `category: string | null`,
  `subcategory: string | null`, `description: string | null`,
  `tags: string[]`). `WorkspaceTab`은 App.tsx 로컬 타입이므로, 이 모듈은
  구조적 타입 `{ folder: string | null; collection: number | null; search: string }`을
  받는 제네릭하지 않은 최소 인터페이스 `SearchTabLike`를 자체 정의해 결합도를 낮춘다.
- Produces:
  - `buildSearchBlob(t: { filename: string; category: string | null; subcategory: string | null; description: string | null; tags: string[] }): string`
  - `trackMatchesQuery(blob: string, loweredQuery: string): boolean`
  - `searchTabLabel(tab: SearchTabLike, fallback: string): string | null`
  - `shouldSpawnSearchTab(activeTab: SearchTabLike | null, nextValue: string): boolean`
  - `interface SearchTabLike { folder: string | null; collection: number | null; search: string }`

- [ ] **Step 1: vitest devDep + test 스크립트 추가**

`package.json`의 `scripts`에 `"test": "vitest run"`, `"test:watch": "vitest"`를
추가하고, `devDependencies`에 `"vitest": "^2.1.8"`를 추가한다. 그 뒤 설치:

Run: `npm install`
Expected: vitest가 devDependencies에 설치되고 lockfile 갱신.

- [ ] **Step 2: vitest 설정 파일 생성**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: 실패하는 테스트 작성**

`src/renderer/src/lib/searchIndex.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildSearchBlob,
  trackMatchesQuery,
  searchTabLabel,
  shouldSpawnSearchTab,
} from "./searchIndex";

const track = {
  filename: "Door_Slam_01.wav",
  category: "SFX",
  subcategory: "Impact",
  description: "heavy wooden door",
  tags: ["wood", "slam"],
};

describe("buildSearchBlob", () => {
  it("모든 검색 대상 필드를 소문자로 합친다", () => {
    const blob = buildSearchBlob(track);
    expect(blob).toContain("door_slam_01.wav");
    expect(blob).toContain("sfx");
    expect(blob).toContain("impact");
    expect(blob).toContain("heavy wooden door");
    expect(blob).toContain("wood");
    expect(blob).toContain("slam");
  });

  it("null 필드를 안전하게 건너뛴다", () => {
    const blob = buildSearchBlob({
      filename: "a.wav",
      category: null,
      subcategory: null,
      description: null,
      tags: [],
    });
    expect(blob).toContain("a.wav");
  });

  it("널 구분자로 인접 필드가 이어져 매칭되지 않게 한다", () => {
    // filename 끝 'x' + category 시작 'y'가 'xy'로 붙어 매칭되면 안 됨
    const blob = buildSearchBlob({
      filename: "x",
      category: "y",
      subcategory: null,
      description: null,
      tags: [],
    });
    expect(blob.includes("xy")).toBe(false);
  });
});

describe("trackMatchesQuery", () => {
  it("소문자 부분 문자열이 있으면 true", () => {
    const blob = buildSearchBlob(track);
    expect(trackMatchesQuery(blob, "door")).toBe(true);
    expect(trackMatchesQuery(blob, "slam")).toBe(true);
  });
  it("없으면 false", () => {
    const blob = buildSearchBlob(track);
    expect(trackMatchesQuery(blob, "cat")).toBe(false);
  });
});

describe("searchTabLabel", () => {
  it("검색어가 있으면 검색어를 라벨로", () => {
    expect(
      searchTabLabel(
        { folder: null, collection: null, search: "door" },
        "All Sounds",
      ),
    ).toBe("door");
  });
  it("검색어가 비면 null(호출부가 폴더명 fallback 사용)", () => {
    expect(
      searchTabLabel(
        { folder: "C:/S", collection: null, search: "" },
        "All Sounds",
      ),
    ).toBe(null);
  });
  it("공백만 있으면 검색 아님으로 처리", () => {
    expect(
      searchTabLabel(
        { folder: null, collection: null, search: "   " },
        "All Sounds",
      ),
    ).toBe(null);
  });
});

describe("shouldSpawnSearchTab", () => {
  it("검색 아닌 탭에서 값 입력 시작 → 새 탭", () => {
    expect(
      shouldSpawnSearchTab(
        { folder: "C:/S", collection: null, search: "" },
        "d",
      ),
    ).toBe(true);
  });
  it("이미 검색 탭이면 새 탭 만들지 않음", () => {
    expect(
      shouldSpawnSearchTab(
        { folder: null, collection: null, search: "do" },
        "doo",
      ),
    ).toBe(false);
  });
  it("빈 값으로 지우는 것은 새 탭 아님", () => {
    expect(
      shouldSpawnSearchTab(
        { folder: "C:/S", collection: null, search: "" },
        "",
      ),
    ).toBe(false);
  });
  it("활성 탭이 없으면(빈 워크스페이스) 새 탭", () => {
    expect(shouldSpawnSearchTab(null, "d")).toBe(true);
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `npm run test`
Expected: FAIL — `./searchIndex`에서 export를 찾을 수 없음(모듈 미생성).

- [ ] **Step 5: 최소 구현 작성**

`src/renderer/src/lib/searchIndex.ts`:

```ts
// 검색은 렌더러 안에서 전량 메모리 필터로 처리된다(519k 트랙). 트랙당 반복 비용을
// 줄이려고, 검색 대상 필드를 시작 시 한 번만 소문자 문자열로 합쳐 두고(blob) 필터
// 때는 그 문자열에 대해 includes 1회만 검사한다. 인접 필드가 우연히 이어져 매칭되지
// 않도록 널 문자(�)를 구분자로 쓴다.
export interface SearchTabLike {
  folder: string | null;
  collection: number | null;
  search: string;
}

const SEP = "�";

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
    t.tags.join(" "),
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
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm run test`
Expected: PASS (전체 테스트 통과).

- [ ] **Step 7: 커밋**

```bash
git add package.json package-lock.json vitest.config.ts src/renderer/src/lib/searchIndex.ts src/renderer/src/lib/searchIndex.test.ts
git commit -m "검색 순수 로직 모듈 + vitest 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: WorkspaceTab에 search 필드 추가 + 검색어를 탭 종속으로

**Files:**

- Modify: `src/renderer/src/App.tsx`

**Interfaces:**

- Consumes: `shouldSpawnSearchTab`, `searchTabLabel`, `SearchTabLike` (Task 1).
- Produces: `handleSearchChange(value: string): void`; `WorkspaceTab`에
  `search: string` 필드; `search` 파생 상수(`activeTab?.search ?? ""`).

- [ ] **Step 1: import 추가**

`App.tsx` 상단 import 블록(43번째 줄 `DEFAULT_PUBLISHER_RULE` import 부근)에 추가:

```ts
import {
  buildSearchBlob,
  trackMatchesQuery,
  searchTabLabel,
  shouldSpawnSearchTab,
} from "./lib/searchIndex";
```

- [ ] **Step 2: WorkspaceTab 인터페이스 + newTab 갱신**

App.tsx의 `interface WorkspaceTab`(71-75줄)을 아래로 교체:

```ts
interface WorkspaceTab {
  id: number;
  folder: string | null;
  collection: number | null;
  search: string; // 빈 문자열이면 검색 탭이 아님
}
```

`newTab()`(79-82줄)의 반환을 아래로 교체:

```ts
function newTab(): WorkspaceTab {
  tabIdSeq += 1;
  return {
    id: Date.now() * 1000 + tabIdSeq,
    folder: null,
    collection: null,
    search: "",
  };
}
```

- [ ] **Step 3: 전역 search state 제거 → 활성 탭 파생 + subSearch만 state 유지**

App.tsx 93-94줄:

```ts
const [search, setSearch] = useState("");
const [subSearch, setSubSearch] = useState("");
```

을 아래로 교체(전역 `search` 제거, `subSearch`는 전역 유지):

```ts
const [subSearch, setSubSearch] = useState("");
```

그리고 `selectedCollection` 파생(113줄) 바로 아래에 `search` 파생을 추가:

```ts
const search = activeTab?.search ?? "";
```

- [ ] **Step 4: handleSearchChange 함수 추가**

`setSelectedCollection` 함수 정의(170-172줄) 바로 아래에 추가:

```ts
// 상단 검색창 입력 핸들러. 검색 아닌 탭에서 검색을 시작하면 검색어를 이름으로 한
// 전역 검색 탭(folder/collection 없음)을 새로 열어 원래 폴더 뷰를 보존한다.
// 이미 검색 탭이거나 빈 워크스페이스면 그 자리에서 검색어만 갱신한다.
function handleSearchChange(value: string): void {
  if (shouldSpawnSearchTab(activeTab, value)) {
    const tab: WorkspaceTab = {
      ...newTab(),
      folder: null,
      collection: null,
      search: value,
    };
    pendingTabIdRef.current = tab.id;
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    return;
  }
  const targetId = activeTab?.id ?? pendingTabIdRef.current;
  if (targetId == null) return;
  setTabs((prev) =>
    prev.map((t) => (t.id === targetId ? { ...t, search: value } : t)),
  );
}
```

- [ ] **Step 5: 검색 input 배선 교체**

App.tsx 1456-1462줄의 `<input>`:

```tsx
<input
  ref={searchInputRef}
  className="topbar__search"
  placeholder="Search sounds"
  value={search}
  onChange={(e) => setSearch(e.target.value)}
/>
```

를 아래로 교체:

```tsx
<input
  ref={searchInputRef}
  className="topbar__search"
  placeholder="Search sounds"
  value={search}
  onChange={(e) => handleSearchChange(e.target.value)}
/>
```

- [ ] **Step 6: setSearch 잔여 호출 정리**

App.tsx 1645줄 `onSelectLocalRoot` 내 `setSearch("");`를 제거한다(해당 콜백은
`setSelectedFolder(null); setSelectedCollection(null); ...`로 검색 아닌 새 뷰를
만들므로 별도 검색 초기화가 불필요). `setSubSearch("");`는 그대로 둔다.

교체 전(1640-1648줄 부근):

```tsx
            onSelectLocalRoot={() => {
              // Local 클릭 = 최상위 진입. 모든 선택 해제 + 폴더 그리드 화면으로
              setSelectedFolder(null);
              setSelectedCollection(null);
              setShowStarredOnly(false);
              setSearch("");
              setSubSearch("");
              setView("grid");
            }}
```

교체 후:

```tsx
            onSelectLocalRoot={() => {
              // Local 클릭 = 최상위 진입. 모든 선택 해제 + 폴더 그리드 화면으로
              setSelectedFolder(null);
              setSelectedCollection(null);
              setShowStarredOnly(false);
              setSubSearch("");
              setView("grid");
            }}
```

- [ ] **Step 7: tabLabel에 검색어 우선 반영**

App.tsx `tabLabel` 함수(868-878줄)를 아래로 교체:

```tsx
// 탭에 표시할 이름: 검색 탭이면 검색어, 아니면 지금 보고 있는 폴더/컬렉션명.
function tabLabel(tab: WorkspaceTab): string {
  const searchLabel = searchTabLabel(tab, "");
  if (searchLabel) return searchLabel;
  if (tab.collection != null) {
    return (
      collections.find((c) => c.id === tab.collection)?.name ?? "Collection"
    );
  }
  if (tab.folder) {
    return norm(tab.folder).split("/").filter(Boolean).pop() ?? "Folder";
  }
  return "All Sounds";
}
```

- [ ] **Step 8: 타입 체크(빌드) 확인**

Run: `npm run build`
Expected: 타입 에러 없음. (이 시점엔 아직 `visibleTracks`가 전역 `search`를 참조하지
않도록 Task 3에서 정리하므로, 만약 `search` 미정의 에러가 나면 Task 3의 변경까지
함께 반영해야 한다 — 아래 Task 3와 연속 작업 권장.)

> **주의:** Task 2와 Task 3는 같은 `search` 심볼을 다루므로, 빌드가 깨지지 않는
> 온전한 상태는 Task 3까지 마쳐야 나온다. 커밋은 Task 3 끝에서 함께 한다.

---

## Task 3: 지연 검색어 + 사전 인덱스로 visibleTracks 필터 재작성

**Files:**

- Modify: `src/renderer/src/App.tsx`

**Interfaces:**

- Consumes: `buildSearchBlob`, `trackMatchesQuery` (Task 1); `search` 파생 상수,
  `WorkspaceTab.search` (Task 2).
- Produces: `deferredSearch`, `deferredSubSearch`, `searchBlobs` (트랙과 동일
  인덱스의 소문자 blob 배열), 검색 탭 여부에 따른 전역 검색 필터.

- [ ] **Step 1: deferredSearch/deferredSubSearch 추가**

App.tsx의 `deferredCollection` 선언(119줄) 바로 아래에 추가:

```ts
const deferredSearch = useDeferredValue(search);
const deferredSubSearch = useDeferredValue(subSearch);
```

- [ ] **Step 2: listPending에 검색 지연 반영**

App.tsx `listPending`(122-124줄)을 아래로 교체:

```ts
const listPending =
  selectedFolder !== deferredFolder ||
  selectedCollection !== deferredCollection ||
  search !== deferredSearch ||
  subSearch !== deferredSubSearch;
```

- [ ] **Step 3: searchBlobs 사전 인덱스 추가**

App.tsx `trackKeys` useMemo(1130-1133줄) 바로 아래에 추가:

```ts
// 검색 필터 비용을 트랙당 1회 includes로 줄이기 위한 사전 소문자 인덱스.
// tracks와 동일 인덱스로 정렬돼 있어(같은 배열 map) 전역 검색 시 인덱스로 바로 쓴다.
// "시작 시 전체 파일 미리 인덱싱"이 이 배열 생성에 해당한다.
const searchBlobs = useMemo(() => tracks.map(buildSearchBlob), [tracks]);
```

- [ ] **Step 4: visibleTracks 필터 재작성**

App.tsx `visibleTracks` useMemo(1135-1196줄)를 아래로 교체:

```ts
const visibleTracks = useMemo(() => {
  if (!activeTab) return [];
  // 검색 탭(검색어 있음)은 폴더/컬렉션 범위를 무시하고 전체 라이브러리에서 검색한다.
  const querying = deferredSearch.trim() !== "";
  let base: Track[];
  if (querying) {
    // 전역 검색: tracks와 searchBlobs가 같은 인덱스이므로 blob을 바로 쓴다.
    const q = deferredSearch.toLowerCase();
    base = [];
    for (let i = 0; i < tracks.length; i++) {
      if (trackMatchesQuery(searchBlobs[i], q)) base.push(tracks[i]);
    }
  } else if (deferredActiveCollection) {
    const byId = new Map(tracks.map((t) => [t.id, t]));
    base = deferredActiveCollection.trackIds
      .map((id) => byId.get(id))
      .filter((t): t is Track => !!t);
  } else if (deferredFolder) {
    const prefix = norm(deferredFolder) + "/";
    base = [];
    for (let i = 0; i < tracks.length; i++) {
      if (trackKeys[i].startsWith(prefix)) base.push(tracks[i]);
    }
  } else {
    base = tracks;
  }
  if (showStarredOnly) base = base.filter((t) => t.starred);
  if (deferredSubSearch.trim()) {
    // subSearch는 결과 부분집합에 적용 — blob 인덱스 정렬이 깨지므로 즉석 계산.
    const q = deferredSubSearch.toLowerCase();
    base = base.filter((t) => trackMatchesQuery(buildSearchBlob(t), q));
  }
  base = shuffled
    ? shuffleTracks(base, shuffleSeed)
    : sortTracks(base, sort.key, sort.dir, { libraries, publisherRule });
  return base;
}, [
  activeTab,
  tracks,
  trackKeys,
  searchBlobs,
  deferredFolder,
  deferredActiveCollection,
  deferredSearch,
  deferredSubSearch,
  showStarredOnly,
  sort,
  libraries,
  publisherRule,
  shuffled,
  shuffleSeed,
]);
```

- [ ] **Step 5: isFiltering을 지연 검색어 기준으로**

App.tsx `isFiltering`(1198-1200줄)을 아래로 교체(검색 탭이면 폴더 그리드 대신
결과 리스트가 보이도록):

```ts
const isFiltering = Boolean(
  deferredSearch.trim() || showStarredOnly || deferredActiveCollection,
);
```

- [ ] **Step 6: 키보드 단축키 effect 의존성 정리**

App.tsx 키보드 effect 의존성 배열(1385-1396줄)에 `search`가 직접 쓰이지 않으므로
변경 불필요하나, `visibleTracks`가 의존성에 이미 있어 검색 결과 변화가 반영된다.
확인만 하고 수정하지 않는다.

- [ ] **Step 7: 빌드/타입 체크**

Run: `npm run build`
Expected: 타입 에러 없음, 빌드 성공. (전역 `search` 심볼이 모두 활성 탭 파생 및
지연본으로 대체됨.)

- [ ] **Step 8: 순수 로직 회귀 테스트**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 9: 커밋 (Task 2 + Task 3 통합 커밋)**

```bash
git add src/renderer/src/App.tsx
git commit -m "검색어를 탭 종속으로 전환 + 지연 검색/사전 인덱스로 검색 렉 제거

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 실제 앱 구동 검증

**Files:** 없음(수동 검증).

**Interfaces:** 없음.

- [ ] **Step 1: 앱 실행**

Run: `npm run dev`
Expected: Electron 앱이 뜨고 기존 519k 라이브러리가 로드됨(사이드바 먼저, 트랙 백그라운드).

- [ ] **Step 2: 검색 반응성 확인**

상단 검색창에 빠르게 여러 글자 타이핑.
Expected: 입력 커서가 끊기지 않음. 결과 리스트는 살짝 뒤따라 갱신되고 그동안
`.list-loading-bar`(옅은 로딩 바)가 켜짐.

- [ ] **Step 3: 검색 탭 생성/보존 확인**

폴더 탭을 하나 연 상태에서 검색 시작.
Expected: 검색어 이름의 새 탭이 생기고 활성화됨. 원래 폴더 탭은 그대로 남아 있음.
계속 타이핑해도 탭이 더 늘지 않고 같은 탭의 라벨만 갱신됨.

- [ ] **Step 4: 전역 검색 범위 확인**

특정 폴더가 아닌, 라이브러리 전반에 존재하는 키워드로 검색.
Expected: 폴더 범위와 무관하게 전체 라이브러리에서 결과가 나옴.

- [ ] **Step 5: 검색어 지우기 + 탭 유지 확인**

검색 탭에서 검색어를 모두 지움.
Expected: 탭은 유지되고 라벨이 "All Sounds"(또는 해당 폴더명)로 복귀. 앱이 크래시
없이 폴더 그리드/전체 목록으로 돌아감.

- [ ] **Step 6: 회귀 확인**

사이드바 폴더 클릭 전환, 컬럼 정렬, 즐겨찾기 필터, 2차 필터(Filter sounds) 입력,
탭 전환 시 각 탭의 검색어 유지를 확인.
Expected: 모두 기존대로 동작. 폴더 클릭이 끊기지 않음(기존 성능 유지).

- [ ] **Step 7: 검증 결과 기록**

문제가 있으면 systematic-debugging으로 넘어가고, 모두 통과하면 완료.

---

## Self-Review

**Spec coverage:**

- 성능 1-A(검색어 지연): Task 3 Step 1-2, 4. ✓
- 성능 1-B(사전 인덱스): Task 1(빌더) + Task 3 Step 3. ✓
- 성능 1-C(필터 재작성): Task 3 Step 4. ✓
- 검색 탭 모델 변경(WorkspaceTab.search): Task 2 Step 2-3. ✓
- handleSearchChange(새 탭 생성/갱신): Task 2 Step 4, Task 1(shouldSpawnSearchTab). ✓
- tabLabel 검색어 우선: Task 2 Step 7, Task 1(searchTabLabel). ✓
- 전역 검색 범위: Task 3 Step 4(querying 분기). ✓
- 검색어 지우면 라벨 복귀 + 탭 유지: Task 2 Step 4(빈 값은 search만 갱신), Task 4 Step 5 검증. ✓
- 부수 정리(setSearch 잔여): Task 2 Step 6. ✓

**Placeholder scan:** 코드 스텝 모두 실제 코드 포함. TODO/TBD 없음. ✓

**Type consistency:** `buildSearchBlob`/`trackMatchesQuery`/`searchTabLabel`/
`shouldSpawnSearchTab` 시그니처가 Task 1 정의와 Task 2·3 사용처에서 일치. `search`는
Task 2에서 `activeTab?.search ?? ""` 파생 상수로 정의되고 Task 3에서 `deferredSearch`로
지연 래핑. `WorkspaceTab.search: string`이 Task 2에서 정의되고 `newTab`/`handleSearchChange`가
동일 필드 사용. ✓

**참고(스펙 대비 의도적 유지):** 컨텍스트 메뉴 "Search in library/collection/folder"는
폴더/컬렉션 선택 + 검색창 포커스만 하는 헬퍼로 남는다. 검색은 전역이므로 실제 검색은
사용자가 입력할 때 전역 검색 탭으로 생성된다. 이는 "검색 항상 전체" 결정과 일관되며
별도 작업이 필요 없다.
