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

function NavIcon({ d }: { d: string }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
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
      {/* 상단 앱 네비게이션 */}
      <div className="sidebar__nav">
        <div className="sidebar__nav-item sidebar__nav-item--active">
          <NavIcon d="M4 6h16M4 12h16M4 18h16" />
          <span>Sounds</span>
        </div>
        <div className="sidebar__nav-item sidebar__nav-item--muted">
          <NavIcon d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z" />
          <span>Voices</span>
        </div>
        <div className="sidebar__nav-item sidebar__nav-item--muted">
          <NavIcon d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z" />
          <span>Add-ons</span>
        </div>
        <div className="sidebar__nav-item sidebar__nav-item--muted">
          <NavIcon d="M4 5h16v14H4zM4 9h16" />
          <span>News</span>
        </div>
      </div>

      {/* LIBRARIES */}
      <div className="sidebar__section">
        <span>Libraries</span>
        <span className="sidebar__section-btn" onClick={onOpenFolder} title="폴더 추가">
          ＋
        </span>
      </div>
      <div className="sidebar__item sidebar__item--muted">
        <span className="ftree__toggle" />
        <span className="ftree__check" />
        <span className="ftree__name">Cloud</span>
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

      {/* ACTIVITY */}
      <div className="sidebar__section">
        <span>Activity</span>
      </div>
      <div className="sidebar__coll sidebar__coll--muted">
        <span className="sidebar__coll-label">Previewed</span>
      </div>
      <div className="sidebar__coll sidebar__coll--muted">
        <span className="sidebar__coll-label">Recently added</span>
      </div>
    </aside>
  )
}
