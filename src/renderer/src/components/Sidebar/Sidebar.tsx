import type { Library, Track } from '@shared/types'
import { colorForCategory } from '@shared/ucsCategories'

interface SidebarProps {
  library: Library | null
  tracks: Track[]
  onOpenFolder: () => void
  activeCategory: string | null
  onSelectCategory: (category: string | null) => void
  showStarredOnly: boolean
  onToggleStarredView: () => void
}

function IconSounds(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10v4h4l5 5V5l-5 5H3z" />
      <path d="M16 8a4 4 0 0 1 0 8" />
    </svg>
  )
}

function IconStar(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15 9 22 9.5 17 14 18.5 21 12 17 5.5 21 7 14 2 9.5 9 9 12 2" />
    </svg>
  )
}

function IconPlus(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export default function Sidebar({
  library,
  tracks,
  onOpenFolder,
  activeCategory,
  onSelectCategory,
  showStarredOnly,
  onToggleStarredView
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
      <div className="sidebar__section">Library</div>
      <div
        className={`sidebar__item${!showStarredOnly && !activeCategory ? ' sidebar__item--active' : ''}`}
        onClick={() => {
          onSelectCategory(null)
          if (showStarredOnly) onToggleStarredView()
        }}
      >
        <span className="sidebar__item-icon"><IconSounds /></span>
        <span className="sidebar__item-label">All Sounds</span>
        <span className="sidebar__item-count">{tracks.length}</span>
      </div>
      <div
        className={`sidebar__item${showStarredOnly ? ' sidebar__item--active' : ''}`}
        onClick={onToggleStarredView}
      >
        <span className="sidebar__item-icon"><IconStar /></span>
        <span className="sidebar__item-label">Starred</span>
        <span className="sidebar__item-count">{starredCount}</span>
      </div>

      {categories.length > 0 && (
        <>
          <div className="sidebar__section">Categories</div>
          {categories.map((cat) => (
            <div
              key={cat}
              className={`sidebar__item${activeCategory === cat && !showStarredOnly ? ' sidebar__item--active' : ''}`}
              onClick={() => {
                onSelectCategory(activeCategory === cat ? null : cat)
                if (showStarredOnly) onToggleStarredView()
              }}
            >
              <span className="sidebar__folder-dot" style={{ background: colorForCategory(cat) }} />
              <span className="sidebar__item-label">{cat}</span>
              <span className="sidebar__item-count">{categoryCounts[cat]}</span>
            </div>
          ))}
        </>
      )}

      <div className="sidebar__section">
        <span>Folders</span>
      </div>
      <div className="sidebar__item" onClick={onOpenFolder}>
        <span className="sidebar__item-icon"><IconPlus /></span>
        <span className="sidebar__item-label">폴더 추가</span>
      </div>
      {library && (
        <div className="sidebar__item sidebar__item--active" title={library.rootPath}>
          <span className="sidebar__folder-dot" style={{ background: 'var(--accent)' }} />
          <span className="sidebar__item-label">{library.name}</span>
        </div>
      )}
    </aside>
  )
}
