import { useState } from 'react'
import type { FolderNode } from '../../lib/folderTree'

interface FolderTreeProps {
  node: FolderNode
  depth: number
  selectedPath: string | null
  onSelectFolder: (path: string) => void
  defaultExpanded?: boolean
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      className={`ftree__chevron${open ? ' ftree__chevron--open' : ''}`}
      width="9"
      height="9"
      viewBox="0 0 10 10"
    >
      <path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function FolderTree({
  node,
  depth,
  selectedPath,
  onSelectFolder,
  defaultExpanded = false
}: FolderTreeProps): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded || depth === 0)
  const hasChildren = node.children.length > 0
  const isSelected = selectedPath === node.path

  return (
    <div className="ftree__node">
      <div
        className={`ftree__row${isSelected ? ' ftree__row--active' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => onSelectFolder(node.path)}
      >
        <span
          className="ftree__toggle"
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) setExpanded((v) => !v)
          }}
        >
          {hasChildren ? <Chevron open={expanded} /> : <span style={{ width: 9, display: 'inline-block' }} />}
        </span>
        <span className="ftree__name">{node.name}</span>
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
          />
        ))}
    </div>
  )
}
