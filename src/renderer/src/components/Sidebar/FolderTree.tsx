import type { FolderNode } from "../../lib/folderTree";

interface FolderTreeProps {
  node: FolderNode;
  depth: number;
  selectedPath: string | null;
  onSelectFolder: (path: string) => void;
  expandedMap: Record<string, boolean>;
  onToggleExpand: (path: string, next: boolean) => void;
  onRemove?: () => void; // 라이브러리 루트에만 전달 (폴더 제거)
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

export default function FolderTree({
  node,
  depth,
  selectedPath,
  onSelectFolder,
  expandedMap,
  onToggleExpand,
  onRemove,
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
          depth === 1 ? (e) => onContextMenu?.(e, node) : undefined
        }
      >
        <span
          className="ftree__toggle"
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
        {onRemove && (
          <span
            className="ftree__remove"
            title="이 라이브러리 폴더 제거"
            onClick={(e) => {
              e.stopPropagation();
              if (
                confirm(
                  `"${node.name}" 폴더를 라이브러리에서 제거할까요? (실제 파일은 삭제되지 않습니다)`,
                )
              ) {
                onRemove();
              }
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
            onContextMenu={onContextMenu}
          />
        ))}
    </div>
  );
}
