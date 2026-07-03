import { useEffect, useMemo, useState } from 'react'
import MenuBar from './components/MenuBar/MenuBar'
import Sidebar from './components/Sidebar/Sidebar'
import ResultList from './components/ResultList/ResultList'
import FolderGrid from './components/FolderGrid/FolderGrid'
import PlayerBar from './components/PlayerBar/PlayerBar'
import MetadataPanel from './components/MetadataPanel/MetadataPanel'
import type { Library, Track } from '@shared/types'
import { isBrowserPreview, mockLibrary, mockTracks } from './mockData'
import { buildFolderTree, tracksUnder, type FolderNode } from './lib/folderTree'

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

function findNode(root: FolderNode, path: string): FolderNode | null {
  if (root.path === path) return root
  for (const child of root.children) {
    const found = findNode(child, path)
    if (found) return found
  }
  return null
}

export default function App(): JSX.Element {
  const [library, setLibrary] = useState<Library | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)
  const [search, setSearch] = useState('')
  const [scanning, setScanning] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showStarredOnly, setShowStarredOnly] = useState(false)
  const [showMeta, setShowMeta] = useState(true)
  const [view, setView] = useState<'grid' | 'list'>('grid')

  useEffect(() => {
    if (isBrowserPreview) {
      setLibrary(mockLibrary)
      setTracks(mockTracks)
    }
  }, [])

  const tree = useMemo(
    () => (library ? buildFolderTree(tracks, library.rootPath) : null),
    [tracks, library]
  )
  const currentNode = useMemo(() => {
    if (!tree) return null
    if (!selectedFolder) return tree
    return findNode(tree, selectedFolder) ?? tree
  }, [tree, selectedFolder])

  async function handleOpenFolder(): Promise<void> {
    if (!window.api) return
    const folder = await window.api.selectFolder()
    if (!folder) return
    setScanning(true)
    try {
      const { library: lib, tracks: scanned } = await window.api.scanLibrary(folder)
      setLibrary(lib)
      setTracks(scanned)
      setSelectedFolder(null)
    } finally {
      setScanning(false)
    }
  }

  async function handleToggleStar(track: Track): Promise<void> {
    const starred = window.api ? await window.api.toggleStar(track.id) : !track.starred
    setTracks((prev) => prev.map((t) => (t.id === track.id ? { ...t, starred } : t)))
    setSelectedTrack((prev) => (prev && prev.id === track.id ? { ...prev, starred } : prev))
  }

  async function handleSelectTrack(track: Track): Promise<void> {
    setSelectedTrack(track)
    // Soundly처럼 미리듣기한 사운드는 회색(previewed) 처리 — 로컬 상태 즉시 반영
    const now = Date.now()
    setTracks((prev) => prev.map((t) => (t.id === track.id ? { ...t, lastPlayedAt: now } : t)))
    if (window.api) await window.api.updateLastPlayed(track.id)
  }

  const visibleTracks = useMemo(() => {
    let base = selectedFolder ? tracksUnder(tracks, selectedFolder) : tracks
    if (showStarredOnly) base = base.filter((t) => t.starred)
    if (activeCategory) base = base.filter((t) => t.category === activeCategory)
    if (search.trim()) {
      const q = search.toLowerCase()
      base = base.filter(
        (t) =>
          t.filename.toLowerCase().includes(q) ||
          (t.category ?? '').toLowerCase().includes(q) ||
          (t.subcategory ?? '').toLowerCase().includes(q) ||
          (t.description ?? '').toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      )
    }
    return base
  }, [tracks, selectedFolder, showStarredOnly, activeCategory, search])

  const isFiltering = Boolean(search.trim() || showStarredOnly || activeCategory)
  const showGrid =
    view === 'grid' && !isFiltering && currentNode !== null && currentNode.children.length > 0

  function selectRelative(delta: number): void {
    if (visibleTracks.length === 0) return
    const idx = visibleTracks.findIndex((t) => t.id === selectedTrack?.id)
    let next = idx === -1 ? 0 : idx + delta
    next = Math.max(0, Math.min(visibleTracks.length - 1, next))
    void handleSelectTrack(visibleTracks[next])
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const isNext = e.key === 'ArrowDown' || e.key === 'ArrowRight'
      const isPrev = e.key === 'ArrowUp' || e.key === 'ArrowLeft'
      if (isNext || isPrev) {
        e.preventDefault()
        selectRelative(isNext ? 1 : -1)
      } else if (e.key === 'f' || e.key === 'F') {
        if (selectedTrack) void handleToggleStar(selectedTrack)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [visibleTracks, selectedTrack])

  // 브레드크럼: 루트(Home/라이브러리) + 선택 폴더 세그먼트
  const crumbs = useMemo(() => {
    if (!library) return []
    const root = norm(library.rootPath)
    const list: Array<{ label: string; path: string | null }> = [
      { label: library.name, path: null }
    ]
    if (selectedFolder) {
      const rel = norm(selectedFolder).slice(root.length).replace(/^\/+/, '')
      let acc = root
      rel.split('/').filter(Boolean).forEach((seg) => {
        acc = `${acc}/${seg}`
        list.push({ label: seg, path: acc })
      })
    }
    return list
  }, [library, selectedFolder])

  return (
    <div className="app">
      <MenuBar
        onAddFolder={handleOpenFolder}
        onToggleMeta={() => setShowMeta((v) => !v)}
        view={view}
        onSetView={setView}
      />

      <div className="topbar">
        <div className="topbar__search-wrap">
          <svg className="topbar__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            className="topbar__search"
            placeholder="Search sounds"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {scanning && <span className="topbar__scanning">스캔 중…</span>}
        <div className="topbar__viewtoggle">
          <button
            className={`icon-btn${view === 'list' ? ' icon-btn--active' : ''}`}
            title="리스트"
            onClick={() => setView('list')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
          </button>
          <button
            className={`icon-btn${view === 'grid' ? ' icon-btn--active' : ''}`}
            title="폴더 카드"
            onClick={() => setView('grid')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button
            className={`icon-btn${showMeta ? ' icon-btn--active' : ''}`}
            title="메타데이터 패널"
            onClick={() => setShowMeta((v) => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M15 4v16" />
            </svg>
          </button>
        </div>
      </div>

      <div className={`main${showMeta ? '' : ' main--no-meta'}`}>
        <Sidebar
          library={library}
          tracks={tracks}
          tree={tree}
          onOpenFolder={handleOpenFolder}
          selectedFolder={selectedFolder}
          onSelectFolder={(p) => {
            setSelectedFolder(p)
            setShowStarredOnly(false)
            setActiveCategory(null)
          }}
          showStarredOnly={showStarredOnly}
          onToggleStarredView={() => {
            setShowStarredOnly((v) => !v)
            setActiveCategory(null)
          }}
          activeCategory={activeCategory}
          onSelectCategory={(c) => {
            setActiveCategory(c)
            setShowStarredOnly(false)
          }}
        />

        <div className="content-wrap">
          <div className="breadcrumb">
            <span className="breadcrumb__home">Home</span>
            {crumbs.map((c, i) => (
              <span key={i} className="breadcrumb__seg">
                <span className="breadcrumb__sep">/</span>
                <span
                  className={`breadcrumb__link${i === crumbs.length - 1 ? ' breadcrumb__link--current' : ''}`}
                  onClick={() => setSelectedFolder(c.path)}
                >
                  {c.label}
                </span>
              </span>
            ))}
            <span className="breadcrumb__count">
              {showGrid ? `${currentNode?.children.length ?? 0} folders` : `${visibleTracks.length} sounds`}
            </span>
          </div>

          {showGrid && currentNode ? (
            <FolderGrid folders={currentNode.children} onOpenFolder={(p) => setSelectedFolder(p)} />
          ) : (
            <ResultList
              tracks={visibleTracks}
              library={library}
              selectedTrackId={selectedTrack?.id ?? null}
              onSelectTrack={handleSelectTrack}
            />
          )}
        </div>

        {showMeta && <MetadataPanel track={selectedTrack} onToggleStar={handleToggleStar} />}
      </div>

      <PlayerBar
        track={selectedTrack}
        onPrev={() => selectRelative(-1)}
        onNext={() => selectRelative(1)}
      />
    </div>
  )
}
