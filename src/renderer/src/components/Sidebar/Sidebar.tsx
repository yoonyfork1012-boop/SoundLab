import { memo, useCallback, useMemo, useRef, useState } from "react";
import type {
  Collection,
  Library,
  ScanProgress,
  Track,
  WatchStatus,
} from "@shared/types";
import { saveBool, saveJSON } from "../../lib/uiState";
import FolderTree from "./FolderTree";
import IndexingIndicator from "../IndexingIndicator/IndexingIndicator";
import type { FolderNode, LibraryTree } from "../../lib/folderTree";

// 트리 타입은 메인/렌더러 공유 모듈에서 온다 — 기존 임포트 호환을 위해 재-export.
export type { LibraryTree };

const EXPANDED_KEY = "soundlib.tree.expanded";
const LOCAL_OPEN_KEY = "soundlib.localOpen";

interface SidebarProps {
  trees: LibraryTree[];
  tracks: Track[];
  onOpenFolder: () => void;
  onRefreshLocal: () => void;
  // 어느 폴더든(라이브러리 루트/하위) ✕ 제거 — 루트/하위 구분과 확인은 상위(App)가 처리.
  onRemoveNode: (node: FolderNode, library: Library) => void;
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
  // 어느 폴더든 우클릭 — 라이브러리 루트/하위 폴더에 따라 App이 알맞은 메뉴를 연다.
  onNodeContextMenu?: (
    e: React.MouseEvent,
    node: FolderNode,
    library: Library,
  ) => void;
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

// 라이브러리 한 개분 트리 래퍼 — memo로 감싸, Sidebar가 폴더와 무관한 이유로 리렌더돼도
// props(아래는 모두 Sidebar에서 참조 고정됨)가 그대로면 트리를 다시 그리지 않는다.
// 라이브러리별 onRemove/onContextMenu 클로저를 여기서 useCallback으로 만들어 안정화한다.
interface LibraryFolderTreeProps {
  library: Library;
  node: FolderNode;
  selectedFolder: string | null;
  expandedMap: Record<string, boolean>;
  onToggleExpand: (path: string, next: boolean) => void;
  defaultExpanded: boolean;
  onSelectFolder: (path: string) => void;
  onRemoveNode: (node: FolderNode, library: Library) => void;
  onNodeContextMenu?: (
    e: React.MouseEvent,
    node: FolderNode,
    library: Library,
  ) => void;
}

const LibraryFolderTree = memo(function LibraryFolderTree({
  library,
  node,
  selectedFolder,
  expandedMap,
  onToggleExpand,
  defaultExpanded,
  onSelectFolder,
  onRemoveNode,
  onNodeContextMenu,
}: LibraryFolderTreeProps): JSX.Element {
  const handleRemove = useCallback(
    (n: FolderNode) => onRemoveNode(n, library),
    [onRemoveNode, library],
  );
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, n: FolderNode) => {
      e.preventDefault();
      onNodeContextMenu?.(e, n, library);
    },
    [onNodeContextMenu, library],
  );
  return (
    <div className="ftree__lib">
      <FolderTree
        node={node}
        depth={1}
        selectedPath={selectedFolder}
        onSelectFolder={onSelectFolder}
        expandedMap={expandedMap}
        onToggleExpand={onToggleExpand}
        defaultExpanded={defaultExpanded}
        onRemoveNode={handleRemove}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
});

export default function Sidebar({
  trees,
  tracks,
  onOpenFolder,
  onRefreshLocal,
  onRemoveNode,
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
  onNodeContextMenu,
  scanning = false,
  scanProgress = null,
  watchStatus = null,
}: SidebarProps): JSX.Element {
  // 시작 시 모든 폴더는 닫힌 상태로 둔다 — 이전 세션의 펼침 상태를 복원하지 않는다.
  // (세션 중 펼침/접힘은 아래 toggleExpand가 저장하지만, 시작 시 그 값을 읽지 않는다.)
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  // App이 넘기는 콜백은 매 렌더 새 참조라, 그대로 트리에 내리면 memo가 매번 깨진다.
  // 최신 콜백을 ref에 담아두고, 트리에는 참조가 고정된(useCallback([])) 래퍼만 내려보낸다.
  const cbRef = useRef({ onSelectFolder, onRemoveNode, onNodeContextMenu });
  cbRef.current = { onSelectFolder, onRemoveNode, onNodeContextMenu };
  const toggleExpand = useCallback((path: string, next: boolean): void => {
    setExpandedMap((prev) => {
      const updated = { ...prev, [path]: next };
      saveJSON(EXPANDED_KEY, updated);
      return updated;
    });
  }, []);
  const stableSelectFolder = useCallback(
    (p: string) => cbRef.current.onSelectFolder(p),
    [],
  );
  const stableRemoveNode = useCallback(
    (node: FolderNode, library: Library) =>
      cbRef.current.onRemoveNode(node, library),
    [],
  );
  const stableNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: FolderNode, library: Library) =>
      cbRef.current.onNodeContextMenu?.(e, node, library),
    [],
  );
  // 시작 시 항상 Local을 펼쳐 보여준다(무조건 로컬로 시작).
  const [localOpen, setLocalOpen] = useState(true);
  function toggleLocal(): void {
    setLocalOpen((v) => {
      const next = !v;
      saveBool(LOCAL_OPEN_KEY, next);
      return next;
    });
  }
  // 수십만 트랙 전체를 매 렌더마다 훑지 않도록 메모이즈 — Sidebar는 트랙 선택 때마다
  // 리렌더되는데, 이 filter가 라이브러리 전체(수십만)를 돌아 선택 시 버벅임의 주원인이었다.
  const starredCount = useMemo(
    () => tracks.filter((t) => t.starred).length,
    [tracks],
  );
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
            onClick={() => onOpenFolder()}
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
              <LibraryFolderTree
                key={library.id}
                library={library}
                node={node}
                selectedFolder={selectedFolder}
                expandedMap={expandedMap}
                onToggleExpand={toggleExpand}
                defaultExpanded={trees.length === 1}
                onSelectFolder={stableSelectFolder}
                onRemoveNode={stableRemoveNode}
                onNodeContextMenu={stableNodeContextMenu}
              />
            ))
          ) : (
            <div
              className="ftree__row"
              style={{ paddingLeft: 24 }}
              onClick={() => onOpenFolder()}
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
