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
  excluded: Set<string>
  onToggleExclude: (path: string) => void
  showStarredOnly: boolean
  onToggleStarredView: () => void
  activeCategory: string | null
  onSelectCategory: (c: string | null) => void
}

export default function Sidebar({
  library,
  tracks,
  tree,
  onOpenFolder,
  selectedFolder,
  onSelectFolder,
  excluded,
  onToggleExclude,
  showStarredOnly,
  onToggleStarredView,
  activeCategory,
  onSelectCategory
}: SidebarProps): JSX.Element {
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
      {tree && library ? (
        <FolderTree
          node={tree}
          depth={0}
          selectedPath={selectedFolder}
          onSelectFolder={(p) => onSelectFolder(p)}
          excluded={excluded}
          onToggleExclude={onToggleExclude}
          defaultExpanded
        />
      ) : (
        <div className="sidebar__item" onClick={onOpenFolder}>
          <span className="ftree__toggle" />
          <span className="ftree__check" />
          <span className="ftree__name" style={{ color: 'var(--accent)' }}>＋ 폴더 추가</span>
        </div>
      )}

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
