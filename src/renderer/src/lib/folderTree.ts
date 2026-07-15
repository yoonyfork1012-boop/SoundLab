import type { Track } from "@shared/types";
import { normPath } from "@shared/folderTree";

// 트리 빌드 로직은 메인/렌더러가 공유한다 (@shared/folderTree). 렌더러 코드가 기존처럼
// "./lib/folderTree"에서 가져다 쓸 수 있도록 여기서 재-export 한다.
export {
  buildFolderTree,
  type FolderNode,
  type LibraryTree,
} from "@shared/folderTree";

/** 특정 폴더 경로(및 그 하위)에 속한 트랙들 */
export function tracksUnder(tracks: Track[], folderPath: string): Track[] {
  const prefix = normPath(folderPath) + "/";
  return tracks.filter((t) => (normPath(t.filePath) + "/").startsWith(prefix));
}
