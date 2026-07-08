import type { Track } from "@shared/types";

export interface FolderNode {
  name: string;
  path: string; // 라이브러리 루트 기준 전체 경로 접두사 (구분자 '/')
  children: FolderNode[];
  trackCount: number; // 하위 전체 트랙 수(재귀)
  directCount: number; // 이 폴더 바로 아래 트랙 수
}

function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** filePath에서 라이브러리 루트를 제외한 폴더 세그먼트 목록 */
function relFolders(filePath: string, rootPath: string): string[] {
  const f = norm(filePath);
  const r = norm(rootPath);
  const rel = f.startsWith(r) ? f.slice(r.length).replace(/^\/+/, "") : f;
  const parts = rel.split("/");
  parts.pop(); // 파일명 제거
  return parts.filter(Boolean);
}

export function buildFolderTree(tracks: Track[], rootPath: string): FolderNode {
  const root: FolderNode = {
    name: norm(rootPath).split("/").pop() ?? rootPath,
    path: norm(rootPath),
    children: [],
    trackCount: 0,
    directCount: 0,
  };

  for (const track of tracks) {
    const folders = relFolders(track.filePath, rootPath);
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

/** 특정 폴더 경로(및 그 하위)에 속한 트랙들 */
export function tracksUnder(tracks: Track[], folderPath: string): Track[] {
  const prefix = norm(folderPath) + "/";
  return tracks.filter((t) => (norm(t.filePath) + "/").startsWith(prefix));
}
