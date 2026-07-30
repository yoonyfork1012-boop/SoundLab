import { memo } from "react";
import type { FolderNode } from "../../lib/folderTree";

interface FolderTreeProps {
  node: FolderNode;
  depth: number;
  selectedPath: string | null;
  onSelectFolder: (path: string) => void;
  expandedMap: Record<string, boolean>;
  onToggleExpand: (path: string, next: boolean) => void;
  // 어느 폴더든(라이브러리 루트/하위 폴더) ✕로 제거 가능 — 실제 제거 의미/확인은 호출부가 결정.
  onRemoveNode?: (node: FolderNode) => void;
  onContextMenu?: (e: React.MouseEvent, node: FolderNode) => void;
  // 라이브러리 루트(depth===1)의 기본 펼침 여부 — 라이브러리가 하나뿐일 때만 기본 펼침
  // (여러 개면 사이드바가 과도하게 길어지지 않도록 기본 접힘). 하위 폴더는 항상 기본 접힘.
  defaultExpanded?: boolean;
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

// React.memo — App이 폴더와 무관한 상태(트랙 선택/미리듣기/재생 등)로 리렌더될 때
// Sidebar가 함께 리렌더되어도, props가 그대로면 펼쳐진 트리 전체를 다시 그리지 않는다.
// 재귀 자식도 이 메모 컴포넌트를 참조해 같은 이득을 받는다. props 안정화는 Sidebar 쪽에서 함.
const FolderTree = memo(function FolderTree({
  node,
  depth,
  selectedPath,
  onSelectFolder,
  expandedMap,
  onToggleExpand,
  onRemoveNode,
  onContextMenu,
  defaultExpanded = false,
}: FolderTreeProps): JSX.Element {
  // 저장된 펼침상태가 있으면 그걸 우선, 없으면 depth===1(라이브러리 루트)일 때만 defaultExpanded 적용
  const expanded =
    expandedMap[node.path] ?? (depth === 1 ? defaultExpanded : false);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedPath === node.path;

  return (
    <div className="ftree__node">
      <div
        className={`ftree__row${isSelected ? " ftree__row--active" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => onSelectFolder(node.path)}
        onContextMenu={
          onContextMenu ? (e) => onContextMenu(e, node) : undefined
        }
      >
        <span
          className={`ftree__toggle${hasChildren ? " ftree__toggle--clickable" : ""}`}
          onClick={(e) => {
            // 화살표를 클릭해도 폴더가 선택되어 리스트에 표시되도록 함(펼침/접힘은 별도로 함께 처리)
            e.stopPropagation();
            onSelectFolder(node.path);
            if (hasChildren) onToggleExpand(node.path, !expanded);
          }}
        >
          {hasChildren ? (
            <Chevron open={expanded} />
          ) : (
            <span style={{ width: 9, display: "inline-block" }} />
          )}
        </span>
        <span className="ftree__name">{node.name}</span>
        {onRemoveNode && (
          <span
            className="ftree__remove"
            title="이 폴더를 라이브러리에서 제거"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveNode(node);
            }}
          >
            ✕
          </span>
        )}
        <span className="ftree__count">{node.trackCount}</span>
      </div>

      {expanded &&
        node.children.map((child) => (
          <FolderTree
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelectFolder={onSelectFolder}
            expandedMap={expandedMap}
            onToggleExpand={onToggleExpand}
            onRemoveNode={onRemoveNode}
            onContextMenu={onContextMenu}
          />
        ))}
    </div>
  );
});

export default FolderTree;
