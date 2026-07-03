import { useState } from 'react'
import type { Library, Track } from '@shared/types'
import { colorForCategory } from '@shared/ucsCategories'
import type { FolderNode } from '../../lib/folderTree'
import FolderTree from './FolderTree'

interface SidebarProps {
  library: Library | null
  tracks: Track[]
  tree: FolderNode | null
  onOpenFolder: () => void
  selectedFolder: string | null
  onSelectFolder: (path: string | null) => void
  showStarredOnly: boolean
  onToggleStarredView: () => void
  activeCategory: string | null
  onSelectCategory: (c: string | null) => void
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg className={`ftree__chevron${open ? ' ftree__chevron--open' : ''}`} width="9" height="9" viewBox="0 0 10 10">
      <path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Sidebar({
  library,
  tracks,
  tree,
  onOpenFolder,
  selectedFolder,
  onSelectFolder,
  showStarredOnly,
  onToggleStarredView,
  activeCategory,
  onSelectCategory
}: SidebarProps): JSX.Element {
  const [localOpen, setLocalOpen] = useState(true)
  const starredCount = tracks.filter((t) => t.starred).length
  const categoryCounts = tracks.reduce<Record<string, number>>((acc, t) => {
    const key = t.category ?? 'OTHER'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  const categories = Object.keys(categoryCounts).sort()

  return (
    <aside className="sidebar">
      {/* LIBRARIES */}
      <div className="sidebar__section sidebar__section--top">
        <span>Libraries</span>
        <span className="sidebar__section-btn" onClick={onOpenFolder} title="폴더 추가">
          ＋
        </span>
      </div>

      {/* Soundly처럼 Local 상위 노드 (체크박스 없음) */}
      <div
        className="ftree__row"
        style={{ paddingLeft: 10 }}
        onClick={() => setLocalOpen((v) => !v)}
      >
        <span className="ftree__toggle">
          <Chevron open={localOpen} />
        </span>
        <span className="ftree__name">Local</span>
      </div>

      {localOpen &&
        (tree && library ? (
          <FolderTree
            node={tree}
            depth={1}
            selectedPath={selectedFolder}
            onSelectFolder={(p) => onSelectFolder(p)}
            defaultExpanded
          />
        ) : (
          <div className="ftree__row" style={{ paddingLeft: 24 }} onClick={onOpenFolder}>
            <span className="ftree__toggle" />
            <span className="ftree__name" style={{ color: 'var(--accent)' }}>＋ 폴더 추가</span>
          </div>
        ))}

      {/* COLLECTIONS */}
      <div className="sidebar__section">
        <span>Collections</span>
      </div>
      <div
        className={`sidebar__coll${showStarredOnly ? ' sidebar__coll--active' : ''}`}
        onClick={onToggleStarredView}
      >
        <span className="sidebar__coll-icon">★</span>
        <span className="sidebar__coll-label">Starred</span>
        <span className="sidebar__coll-count">{starredCount}</span>
      </div>
      {categories.map((cat) => (
        <div
          key={cat}
          className={`sidebar__coll${activeCategory === cat ? ' sidebar__coll--active' : ''}`}
          onClick={() => onSelectCategory(activeCategory === cat ? null : cat)}
        >
          <span className="sidebar__coll-dot" style={{ background: colorForCategory(cat) }} />
          <span className="sidebar__coll-label">{cat}</span>
          <span className="sidebar__coll-count">{categoryCounts[cat]}</span>
        </div>
      ))}
    </aside>
  )
}
