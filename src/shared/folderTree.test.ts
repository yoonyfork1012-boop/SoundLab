import { describe, it, expect } from "vitest";
import { buildFolderTree, flattenFolders, searchFolders } from "./folderTree";

const root = "C:/Sounds";
const tree = buildFolderTree(
  [
    "C:/Sounds/Explosion/Metal/a.wav",
    "C:/Sounds/Explosion/Metal/Debris/b.wav",
    "C:/Sounds/Impact/Metal Hit/c.wav",
    "C:/Sounds/Ambience/Forest/d.wav",
  ].map((filePath) => ({ filePath })),
  root,
);
const flat = flattenFolders([{ node: tree }]);
const names = (q: string): string[] =>
  searchFolders(flat, q).map((h) => h.node.name);

describe("searchFolders (사이드바 폴더 검색)", () => {
  it("이름 일부로 대소문자 없이 찾고, 정확 일치 → 접두 일치 순으로 둔다", () => {
    expect(names("metal")).toEqual(["Metal", "Metal Hit"]);
  });

  it("여러 단어는 경로 전체에서 찾되 이름이 하나라도 맞아야 한다", () => {
    // Explosion/Metal은 나오고, 이름이 안 맞는 하위 Debris는 딸려 나오지 않는다.
    expect(names("explosion metal")).toEqual(["Metal"]);
  });

  it("빈 검색어는 결과가 없다", () => {
    expect(searchFolders(flat, "   ")).toEqual([]);
  });

  it("부모 경로 표시와 펼칠 조상 경로를 준다", () => {
    const [hit] = searchFolders(flat, "debris");
    expect(hit.node.path).toBe("C:/Sounds/Explosion/Metal/Debris");
    expect(hit.parentLabel).toBe("Sounds / Explosion / Metal");
    expect(hit.ancestors).toEqual([
      "C:/Sounds",
      "C:/Sounds/Explosion",
      "C:/Sounds/Explosion/Metal",
    ]);
  });
});
