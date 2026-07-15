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
