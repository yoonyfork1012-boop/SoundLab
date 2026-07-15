# 즉각 검색(Instant Search) + 검색 결과 탭 설계

날짜: 2026-07-15
대상 파일(주): `src/renderer/src/App.tsx`

## 배경 / 문제

519k 트랙 규모 라이브러리에서 두 가지 문제가 있다.

1. **검색이 뚝뚝 끊긴다.** `App.tsx`의 `visibleTracks` 계산에서 폴더/컬렉션
   전환은 `useDeferredValue`로 지연 처리돼 부드럽지만, **검색어(`search`,
   `subSearch`)는 지연 처리가 없다**. 따라서 한 글자 입력할 때마다 최대 519k개
   트랙을 동기적으로 훑으며(트랙당 `toLowerCase().includes()` 5회 + 태그 순회)
   그 결과를 다시 정렬한다. 이 동기 작업이 메인 스레드를 막아 입력이 끊긴다.
   트랙은 이미 전부 메모리에 로드돼 있으므로 근본 원인은 "인덱싱 부재"가 아니라
   **비지연 처리 + 트랙당 반복 비용**이다.

2. **검색 결과가 별도로 보관되지 않는다.** 검색은 현재 활성 탭의 뷰에 전역
   필터로 얹힌다. 사용자는 검색을 하면 검색어를 이름으로 한 **별도 탭**에 결과가
   담기길 원한다("Everything"처럼 전역 검색).

## 목표

- 타이핑 중 입력창이 끊기지 않고, 검색 결과가 순차적으로 갱신된다.
- 검색은 **항상 전체 라이브러리(519k 트랙)** 대상 — 폴더 범위 무시.
- 검색을 시작하면 검색어를 이름으로 한 **새 검색 탭**이 생기고, 원래 보던
  폴더/컬렉션 탭은 그대로 보존된다.

## 비목표 (YAGNI)

- DB 스키마 변경, FTS5 도입, 웹 워커 도입은 하지 않는다. 렌더러 내에서 해결한다.
- 검색 랭킹/하이라이트/퍼지 매칭은 범위 밖.
- `subSearch`(2차 필터)의 동작 자체는 바꾸지 않는다(성능 지연만 적용).

## 설계

### 1. 검색 성능 — 지연 + 사전 소문자 인덱스

모두 `App.tsx` 렌더러 내 변경. DB/IPC/메인 프로세스 변경 없음.

**1-A. 검색어 지연 처리**

`search`, `subSearch`를 `useDeferredValue`로 감싼 값(`deferredSearch`,
`deferredSubSearch`)을 만들고, `visibleTracks` 계산과 그 의존성 배열에서
원본 대신 지연본을 쓴다. 입력창(`value={search}`)은 그대로 원본에 바인딩되어
즉시 반영되고, 무거운 필터+정렬은 지연본 기준으로 중단 가능한 렌더에서 계산된다.

- `listPending`(옅은 로딩 바) 조건에 `search !== deferredSearch ||
subSearch !== deferredSubSearch`를 추가해, 검색 결과가 따라잡는 동안에도
  로딩 연출이 켜지게 한다.

**1-B. 사전 소문자 인덱스 (`searchBlobs`)**

기존 `trackKeys`(경로 배열, `tracks`와 동일 인덱스)와 같은 패턴으로,
`tracks`가 바뀔 때만 재계산되는 소문자 문자열 배열을 만든다:

```ts
const searchBlobs = useMemo(
  () =>
    tracks.map((t) =>
      (
        t.filename +
        "�" +
        (t.category ?? "") +
        "�" +
        (t.subcategory ?? "") +
        "�" +
        (t.description ?? "") +
        "�" +
        t.tags.join("�")
      ).toLowerCase(),
    ),
  [tracks],
);
```

`�`(널 문자)를 필드 구분자로 써서 인접 필드가 우연히 이어져 매칭되는 것을
막는다. 검색 필터는 트랙당 `searchBlobs[i].includes(q)` 1회로 축소된다.

이 배열 생성이 "시작 시 전체 파일 미리 인덱싱"에 해당한다(현재 `trackKeys`가
이미 유사 비용을 치르므로 추가 부담은 크지 않다).

**1-C. `visibleTracks` 필터 재작성**

- 검색 탭(아래 2절)에서는 폴더/컬렉션 범위를 무시하고 `base = tracks` 전체로
  시작한다.
- 메인 검색어 필터: 인덱스로 순회하며 `searchBlobs[i].includes(q)`만 검사
  (기존 5개 필드 개별 검사 제거). `base`가 `tracks` 전체일 때는 인덱스 정렬이
  일치하므로 `searchBlobs`를 그대로 쓸 수 있고, `base`가 부분집합일 때
  (`subSearch` 경로 등)는 트랙 객체 기준으로 blob을 즉석 계산하거나 id→blob
  맵을 참조한다. 구현은 "메인 검색은 항상 전체(tracks) 대상"이라는 2절 결정
  덕분에 `searchBlobs`를 인덱스로 직접 쓰는 단순 경로가 된다.
- `subSearch`는 결과 부분집합에 적용되므로 트랙 객체에서 즉석 소문자 비교를
  유지한다(부분집합 크기가 작아 비용이 작다).

### 2. 검색 결과용 새 탭

**모델 변경**: `WorkspaceTab`에 `search: string` 필드를 추가한다.

```ts
interface WorkspaceTab {
  id: number;
  folder: string | null;
  collection: number | null;
  search: string; // 빈 문자열이면 검색 아님
}
```

`newTab()`은 `search: ""`로 초기화한다.

**전역 `search` state 제거 → 활성 탭 파생**: 상단 검색창은 활성 탭의 `search`를
읽고 쓴다.

- `const search = activeTab?.search ?? "";`
- 입력 `onChange`는 `handleSearchChange(value)`를 호출.

**`handleSearchChange(value)` 동작**:

- 활성 탭이 없거나(빈 워크스페이스) 활성 탭이 이미 검색 탭이면 → 그 탭의
  `search`를 갱신(추가 탭 생성 X).
- 활성 탭이 검색 탭이 아니고(`activeTab.search === ""`), `value`가 비어 있지
  않으면 → **새 검색 탭 생성**: `{ ...newTab(), folder: null, collection:
null, search: value }`. 이 탭을 활성화. 원래 탭은 보존.
- 검색 탭에서 `value`가 빈 문자열이 되면 → 탭의 `search`만 `""`로 갱신(탭은
  유지). 탭 라벨은 `tabLabel` 규칙에 따라 자동으로 폴더명/‘All Sounds’로 복귀.

**`tabLabel(tab)` 규칙 변경**: `tab.search`가 비어 있지 않으면 검색어를
라벨로 반환(폴더/컬렉션명보다 우선). 예: `door`.

**`visibleTracks` 연동**: 활성(및 지연본) 탭이 검색 탭이면(`search` 비어 있지
않음) 폴더/컬렉션 필터를 건너뛰고 전체 `tracks`에서 검색. `deferredSearch`는
활성 탭의 `search`에서 파생.

**부수 정리**:

- `setSearch("")`를 직접 호출하던 곳(예: `onSelectLocalRoot`의 검색
  초기화)은 활성 탭 검색 초기화 헬퍼로 대체하거나, Local 진입은 검색 탭이
  아닌 탭으로 전환하는 기존 로직에 맡긴다.
- `Ctrl+F`는 검색창 포커스(기존 유지). 포커스 후 입력 시 위 로직으로 새 탭
  생성이 트리거된다.
- `handleSearchInLibrary`/`handleSearchInCollection`은 폴더/컬렉션 선택 +
  검색창 포커스만 하므로 그대로 동작(검색어는 사용자가 입력 시 새 검색 탭 생성).

## 영향 범위 / 파일

- `src/renderer/src/App.tsx`
  - `WorkspaceTab` 인터페이스 + `newTab()`
  - 전역 `search` state 제거 → `activeTab.search` 파생 + `handleSearchChange`
  - `useDeferredValue`로 `deferredSearch`/`deferredSubSearch`
  - `searchBlobs` useMemo
  - `visibleTracks` 필터 재작성 + 의존성 배열
  - `tabLabel`, `listPending`
  - 상단 검색 `<input>`의 `value`/`onChange` 배선
- 다른 파일 변경 없음(메인/preload/DB 무변경).

## 테스트 / 검증

- 빌드 + 앱 실행(`/run`)으로 실제 519k 라이브러리에서 확인:
  1. 검색창에 빠르게 타이핑 시 입력이 끊기지 않는다.
  2. 검색 시작 시 검색어 이름의 새 탭이 뜨고, 원래 폴더 탭이 보존된다.
  3. 검색어를 지우면 탭 라벨이 원래대로 돌아온다.
  4. 검색 결과가 폴더 범위와 무관하게 전체 라이브러리에서 나온다.
  5. 탭 전환 시 각 탭의 검색어가 유지된다.
- 회귀: 폴더/컬렉션 클릭 전환, 정렬, 즐겨찾기 필터, `subSearch`가 그대로 동작.
