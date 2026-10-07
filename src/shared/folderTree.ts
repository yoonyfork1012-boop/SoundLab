import type { Library } from "./types";

export interface FolderNode {
  name: string;
  path: string; // 라이브러리 루트 기준 전체 경로 접두사 (구분자 '/')
  children: FolderNode[];
  trackCount: number; // 하위 전체 트랙 수(재귀)
  directCount: number; // 이 폴더 바로 아래 트랙 수
}

// 사이드바 트리 한 라이브러리분 — 메인/렌더러 양쪽에서 공유한다.
export interface LibraryTree {
  library: Library;
  node: FolderNode;
}

export function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** filePath에서 라이브러리 루트를 제외한 폴더 세그먼트 목록 */
function relFolders(filePath: string, rootPath: string): string[] {
  const f = normPath(filePath);
  const r = normPath(rootPath);
  const rel = f.startsWith(r) ? f.slice(r.length).replace(/^\/+/, "") : f;
  const parts = rel.split("/");
  parts.pop(); // 파일명 제거
  return parts.filter(Boolean);
}

// filePath만 있으면 트리를 만들 수 있으므로, Track 전체가 아니라 { filePath } 형태만 받는다 —
// 메인 프로세스가 경량 쿼리(file_path 컬럼만)로 뽑은 결과로도 동일하게 트리를 만들 수 있다.
export function buildFolderTree(
  items: ReadonlyArray<{ filePath: string }>,
  rootPath: string,
): FolderNode {
  const root: FolderNode = {
    name: normPath(rootPath).split("/").pop() ?? rootPath,
    path: normPath(rootPath),
    children: [],
    trackCount: 0,
    directCount: 0,
  };

  for (const item of items) {
    const folders = relFolders(item.filePath, rootPath);
    let node = root;
    node.trackCount++;
    if (folders.length === 0) node.directCount++;

    let prefix = root.path;
    folders.forEach((seg, i) => {
      prefix = `${prefix}/${seg}`;
      let child = node.children.find((c) => c.name === seg);
      if (!child) {
        child = {
          name: seg,
          path: prefix,
          children: [],
          trackCount: 0,
          directCount: 0,
        };
        node.children.push(child);
      }
      child.trackCount++;
      if (i === folders.length - 1) child.directCount++;
      node = child;
    });
  }

  const sortRec = (n: FolderNode): void => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sortRec);
  };
  sortRec(root);

  return root;
}

export interface FolderSearchHit {
  node: FolderNode;
  // 라이브러리 루트부터 부모까지 — 같은 이름 폴더를 구분하도록 결과 줄에 흐리게 보여준다.
  parentLabel: string;
  // 결과를 고른 뒤 트리에서도 보이도록 펼쳐 줄 조상 경로들(라이브러리 루트 포함).
  ancestors: string[];
}

interface FlatFolder extends FolderSearchHit {
  nameLower: string;
  relLower: string;
  depth: number;
}

/** 트리를 검색용 평면 목록으로 편다 — 트리가 바뀔 때 한 번만 만든다. */
export function flattenFolders(
  trees: ReadonlyArray<{ node: FolderNode }>,
): FlatFolder[] {
  const out: FlatFolder[] = [];
  const walk = (n: FolderNode, names: string[], paths: string[]): void => {
    out.push({
      node: n,
      parentLabel: names.join(" / "),
      ancestors: paths,
      nameLower: n.name.toLowerCase(),
      relLower: [...names, n.name].join("/").toLowerCase(),
      depth: names.length,
    });
    const nextNames = [...names, n.name];
    const nextPaths = [...paths, n.path];
    for (const c of n.children) walk(c, nextNames, nextPaths);
  };
  for (const t of trees) walk(t.node, [], []);
  return out;
}

/**
 * 공백으로 나눈 단어가 모두 "라이브러리 기준 경로"에 들어 있고, 그중 하나 이상이 폴더 이름
 * 자체에 들어 있는 폴더를 찾는다 — "explosion metal"로 Explosion/Metal을 찾되, 이름이
 * 안 맞는 하위 폴더 전체가 줄줄이 딸려 나오지 않게 한다.
 * 정렬: 이름 정확 일치 → 이름 접두 일치 → 얕은 폴더 → 이름순.
 */
export function searchFolders(
  flat: ReadonlyArray<FlatFolder>,
  query: string,
  limit = 200,
): FolderSearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const q = terms.join(" ");
  const matched = flat.filter(
    (f) =>
      terms.every((t) => f.relLower.includes(t)) &&
      terms.some((t) => f.nameLower.includes(t)),
  );
  const rank = (f: FlatFolder): number =>
    f.nameLower === q ? 0 : f.nameLower.startsWith(terms[0]) ? 1 : 2;
  matched.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.depth - b.depth ||
      a.node.name.localeCompare(b.node.name),
  );
  return matched
    .slice(0, limit)
    .map(({ node, parentLabel, ancestors }) => ({
      node,
      parentLabel,
      ancestors,
    }));
}
