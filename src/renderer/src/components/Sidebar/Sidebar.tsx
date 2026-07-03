import type { Library } from '@shared/types'

interface SidebarProps {
  library: Library | null
  onOpenFolder: () => void
  trackCount: number
}

export default function Sidebar({ library, onOpenFolder, trackCount }: SidebarProps): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar__section">Sounds</div>
      <div className="sidebar__item" onClick={onOpenFolder}>
        + 폴더 추가
      </div>

      {library && (
        <>
          <div className="sidebar__section">Local</div>
          <div className="sidebar__item sidebar__item--active" title={library.rootPath}>
            {library.name} ({trackCount})
          </div>
        </>
      )}
    </aside>
  )
}
