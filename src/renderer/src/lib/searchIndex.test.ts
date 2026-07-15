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
