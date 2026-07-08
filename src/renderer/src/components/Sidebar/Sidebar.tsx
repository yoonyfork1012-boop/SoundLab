import { useState } from "react";
import type {
  Collection,
  Library,
  ScanProgress,
  Track,
  WatchStatus,
} from "@shared/types";
import type { FolderNode } from "../../lib/folderTree";
import { loadBool, loadJSON, saveBool, saveJSON } from "../../lib/uiState";
import FolderTree from "./FolderTree";
import IndexingIndicator from "../IndexingIndicator/IndexingIndicator";

export interface LibraryTree {
  library: Library;
  node: FolderNode;
}

const EXPANDED_KEY = "soundlib.tree.expanded";
const LOCAL_OPEN_KEY = "soundlib.localOpen";

interface SidebarProps {
  trees: LibraryTree[];
  tracks: Track[];
  onOpenFolder: () => void;
  onRefreshLocal: () => void;
  onRemoveLibrary: (id: number) => void;
  selectedFolder: string | null;
  onSelectFolder: (path: string | null) => void;
  collections: Collection[];
  selectedCollection: number | null;
  onSelectCollection: (id: number) => void;
  onCreateCollection: () => void;
  onDeleteCollection: (id: number) => void;
  showStarredOnly: boolean;
  onToggleStarredView: () => void;
  onSelectLocalRoot: () => void;
  onCollectionContextMenu?: (
    e: React.MouseEvent,
    collection: Collection,
  ) => void;
  onLibraryContextMenu?: (e: React.MouseEvent, library: Library) => void;
  scanning?: boolean;
  scanProgress?: ScanProgress | null;
  watchStatus?: WatchStatus | null;
}

// "Watching" / "Updating N files…" / "Indexed 3 new files" 같은 실시간 감시 상태를 sentence로 변환.
// indexed/removed는 배치 완료 직후 잠깐 보여주는 상태이므로 몇 초 뒤 자동으로 다시 Watching으로 표시된다
// (main 프로세스가 그 시점에 kind:'watching' 이벤트를 다시 보내준다).
function watchStatusText(status: WatchStatus): string {
  switch (status.kind) {
    case "watching":
      return "Watching";
    case "updating":
      return `Updating ${status.count ?? 0} file${(status.count ?? 0) > 1 ? "s" : ""}…`;
    case "indexed":
    case "removed":
      return status.message ?? "Updated";
    case "error":
      return status.message ?? "Watch error";
    default:
      return "";
  }
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      className={`ftree__chevron${open ? " ftree__chevron--open" : ""}`}
      width="9"
      height="9"
      viewBox="0 0 10 10"
    >
      <path
        d="M3 1.5L7 5L3 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Sidebar({
  trees,
  tracks,
  onOpenFolder,
  onRefreshLocal,
  onRemoveLibrary,
  selectedFolder,
  onSelectFolder,
  collections,
  selectedCollection,
  onSelectCollection,
  onCreateCollection,
  onDeleteCollection,
  showStarredOnly,
  onToggleStarredView,
  onSelectLocalRoot,
  onCollectionContextMenu,
  onLibraryContextMenu,
  scanning = false,
  scanProgress = null,
  watchStatus = null,
}: SidebarProps): JSX.Element {
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() =>
    loadJSON(EXPANDED_KEY, {}),
  );
  function toggleExpand(path: string, next: boolean): void {
    setExpandedMap((prev) => {
      const updated = { ...prev, [path]: next };
      saveJSON(EXPANDED_KEY, updated);
      return updated;
    });
  }
  const [localOpen, setLocalOpen] = useState(() =>
    loadBool(LOCAL_OPEN_KEY, true),
  );
  function toggleLocal(): void {
    setLocalOpen((v) => {
      const next = !v;
      saveBool(LOCAL_OPEN_KEY, next);
      return next;
    });
  }
  const starredCount = tracks.filter((t) => t.starred).length;
  // Local 자체를 클릭하면(=최상위 진입점) 폴더/컬렉션/즐겨찾기 선택이 모두 해제된 Home 상태
  const atLocalRoot =
    !selectedFolder && selectedCollection == null && !showStarredOnly;

  return (
    <aside className="sidebar">
      <div className="sidebar__scroll">
        {/* LIBRARIES */}
        <div className="sidebar__section sidebar__section--top">
          <span>Libraries</span>
          <span
            className="sidebar__section-btn"
            onClick={onOpenFolder}
            title="폴더 추가"
          >
            ＋
          </span>
        </div>

        {/* Local = 전체 로컬 라이브러리 최상위 진입점. 행 클릭 시 루트 폴더 그리드로 이동하고,
          화살표(chevron)로만 하위 트리를 펼치거나 접는다. */}
        <div
          className={`ftree__row${atLocalRoot ? " ftree__row--active" : ""}`}
          style={{ paddingLeft: 10 }}
          onClick={onSelectLocalRoot}
        >
          <span
            className="ftree__toggle"
            onClick={(e) => {
              e.stopPropagation();
              toggleLocal();
            }}
          >
            <Chevron open={localOpen} />
          </span>
          <span className="ftree__name">Local</span>
          <button
            type="button"
            className="ftree__refresh"
            title="Refresh local libraries"
            onClick={(e) => {
              e.stopPropagation();
              onRefreshLocal();
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
              <path d="M3 21v-5h5" />
              <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>

        {localOpen &&
          (trees.length > 0 ? (
            trees.map(({ library, node }) => (
              <div key={library.id} className="ftree__lib">
                <FolderTree
                  node={node}
                  depth={1}
                  selectedPath={selectedFolder}
                  onSelectFolder={(p) => onSelectFolder(p)}
                  expandedMap={expandedMap}
                  onToggleExpand={toggleExpand}
                  defaultExpanded={trees.length === 1}
                  onRemove={() => onRemoveLibrary(library.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onLibraryContextMenu?.(e, library);
                  }}
                />
              </div>
            ))
          ) : (
            <div
              className="ftree__row"
              style={{ paddingLeft: 24 }}
              onClick={onOpenFolder}
            >
              <span className="ftree__toggle" />
              <span className="ftree__name" style={{ color: "var(--accent)" }}>
                ＋ 폴더 추가
              </span>
            </div>
          ))}

        {/* COLLECTIONS */}
        <div className="sidebar__section">
          <span>Collections</span>
          <span
            className="sidebar__section-btn"
            onClick={onCreateCollection}
            title="새 컬렉션"
          >
            ＋
          </span>
        </div>
        <div
          className={`sidebar__coll${showStarredOnly ? " sidebar__coll--active" : ""}`}
          onClick={onToggleStarredView}
        >
          <span className="sidebar__coll-icon">★</span>
          <span className="sidebar__coll-label">Starred</span>
          <span className="sidebar__coll-count">{starredCount}</span>
        </div>
        {collections.map((col) => (
          <div
            key={col.id}
            className={`sidebar__coll${selectedCollection === col.id ? " sidebar__coll--active" : ""}`}
            onClick={() => onSelectCollection(col.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              onSelectCollection(col.id);
              onCollectionContextMenu?.(e, col);
            }}
          >
            <span
              className="sidebar__coll-icon"
              style={col.color ? { color: col.color } : undefined}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </span>
            <span className="sidebar__coll-label">{col.name}</span>
            <span
              className="ftree__remove"
              title="컬렉션 삭제"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteCollection(col.id);
              }}
            >
              ✕
            </span>
            <span className="sidebar__coll-count">{col.trackIds.length}</span>
          </div>
        ))}
      </div>
      {scanning && <IndexingIndicator progress={scanProgress} />}
      {!scanning && watchStatus && (
        <div className={`watch-status watch-status--${watchStatus.kind}`}>
          <span className="watch-status__dot" />
          <span>{watchStatusText(watchStatus)}</span>
        </div>
      )}
    </aside>
  );
}
