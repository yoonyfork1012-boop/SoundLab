import { useState } from 'react'
import type { Collection, Library, Track } from '@shared/types'
import type { FolderNode } from '../../lib/folderTree'
import { loadBool, loadJSON, saveBool, saveJSON } from '../../lib/uiState'
import FolderTree from './FolderTree'

export interface LibraryTree {
  library: Library
  node: FolderNode
}

const EXPANDED_KEY = 'soundlib.tree.expanded'
const LOCAL_OPEN_KEY = 'soundlib.localOpen'

interface SidebarProps {
  trees: LibraryTree[]
  tracks: Track[]
  onOpenFolder: () => void
  onRemoveLibrary: (id: number) => void
  selectedFolder: string | null
  onSelectFolder: (path: string | null) => void
  collections: Collection[]
  selectedCollection: number | null
  onSelectCollection: (id: number) => void
  onCreateCollection: () => void
  onDeleteCollection: (id: number) => void
  showStarredOnly: boolean
  onToggleStarredView: () => void
  onCollectionContextMenu?: (e: React.MouseEvent, collection: Collection) => void
  onLibraryContextMenu?: (e: React.MouseEvent, library: Library) => void
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg className={`ftree__chevron${open ? ' ftree__chevron--open' : ''}`} width="9" height="9" viewBox="0 0 10 10">
      <path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Sidebar({
  trees,
  tracks,
  onOpenFolder,
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
  onCollectionContextMenu,
  onLibraryContextMenu
}: SidebarProps): JSX.Element {
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() =>
    loadJSON(EXPANDED_KEY, {})
  )
  function toggleExpand(path: string, next: boolean): void {
    setExpandedMap((prev) => {
      const updated = { ...prev, [path]: next }
      saveJSON(EXPANDED_KEY, updated)
      return updated
    })
  }
  const [localOpen, setLocalOpen] = useState(() => loadBool(LOCAL_OPEN_KEY, true))
  function toggleLocal(): void {
    setLocalOpen((v) => {
      const next = !v
      saveBool(LOCAL_OPEN_KEY, next)
      return next
    })
  }
  const starredCount = tracks.filter((t) => t.starred).length

  return (
    <aside className="sidebar">
      {/* LIBRARIES */}
      <div className="sidebar__section sidebar__section--top">
        <span>Libraries</span>
        <span className="sidebar__section-btn" onClick={onOpenFolder} title="폴더 추가">
          ＋
        </span>
      </div>

      <div className="ftree__row" style={{ paddingLeft: 10 }} onClick={toggleLocal}>
        <span className="ftree__toggle">
          <Chevron open={localOpen} />
        </span>
        <span className="ftree__name">Local</span>
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
                  e.preventDefault()
                  onLibraryContextMenu?.(e, library)
                }}
              />
            </div>
          ))
        ) : (
          <div className="ftree__row" style={{ paddingLeft: 24 }} onClick={onOpenFolder}>
            <span className="ftree__toggle" />
            <span className="ftree__name" style={{ color: 'var(--accent)' }}>＋ 폴더 추가</span>
          </div>
        ))}

      {/* COLLECTIONS */}
      <div className="sidebar__section">
        <span>Collections</span>
        <span className="sidebar__section-btn" onClick={onCreateCollection} title="새 컬렉션">
          ＋
        </span>
      </div>
      <div
        className={`sidebar__coll${showStarredOnly ? ' sidebar__coll--active' : ''}`}
        onClick={onToggleStarredView}
      >
        <span className="sidebar__coll-icon">★</span>
        <span className="sidebar__coll-label">Starred</span>
        <span className="sidebar__coll-count">{starredCount}</span>
      </div>
      {collections.map((col) => (
        <div
          key={col.id}
          className={`sidebar__coll${selectedCollection === col.id ? ' sidebar__coll--active' : ''}`}
          onClick={() => onSelectCollection(col.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            onSelectCollection(col.id)
            onCollectionContextMenu?.(e, col)
          }}
        >
          <span className="sidebar__coll-icon" style={col.color ? { color: col.color } : undefined}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </span>
          <span className="sidebar__coll-label">{col.name}</span>
          <span
            className="ftree__remove"
            title="컬렉션 삭제"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteCollection(col.id)
            }}
          >
            ✕
          </span>
          <span className="sidebar__coll-count">{col.trackIds.length}</span>
        </div>
      ))}
    </aside>
  )
}
