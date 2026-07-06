import { useEffect, useMemo, useState } from 'react'
import MenuBar from './components/MenuBar/MenuBar'
import Sidebar from './components/Sidebar/Sidebar'
import ResultList from './components/ResultList/ResultList'
import FolderGrid from './components/FolderGrid/FolderGrid'
import PlayerBar from './components/PlayerBar/PlayerBar'
import MetadataPanel from './components/MetadataPanel/MetadataPanel'
import AccentPicker from './components/AccentPicker/AccentPicker'
import type { Collection, Library, Track } from '@shared/types'
import { isBrowserPreview, mockCollections, mockLibrary, mockTracks } from './mockData'
import { buildFolderTree, tracksUnder, type FolderNode } from './lib/folderTree'
import { applyAccent, loadAccent, saveAccent } from './lib/theme'

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

export default function App(): JSX.Element {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)
  const [search, setSearch] = useState('')
  const [scanning, setScanning] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [selectedCollection, setSelectedCollection] = useState<number | null>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showStarredOnly, setShowStarredOnly] = useState(false)
  const [showMeta, setShowMeta] = useState(true)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [accent, setAccentState] = useState<string>(loadAccent())
  const [scanProgress, setScanProgress] = useState<{
    scanned: number
    total: number
    currentFile: string
  } | null>(null)

  useEffect(() => {
    if (!window.api?.onScanProgress) return
    return window.api.onScanProgress((p) => setScanProgress(p))
  }, [])

  useEffect(() => {
    applyAccent(accent)
  }, [accent])

  function setAccent(hex: string): void {
    setAccentState(hex)
    saveAccent(hex)
  }

  // 시작 시 저장돼 있던 전체 라이브러리/트랙 로드 (누적 유지)
  useEffect(() => {
    if (isBrowserPreview) {
      setLibraries([mockLibrary])
      setTracks(mockTracks)
      setCollections(mockCollections)
      return
    }
    window.api?.loadAll().then(({ libraries, tracks }) => {
      setLibraries(libraries)
      setTracks(tracks)
    })
    window.api?.getCollections().then(setCollections)
  }, [])

  async function handleCreateCollection(): Promise<void> {
    const name = window.prompt('새 컬렉션 이름')
    if (!name?.trim() || !window.api) return
    setCollections(await window.api.createCollection(name.trim()))
  }

  async function handleDeleteCollection(id: number): Promise<void> {
    if (!window.api) return
    if (!window.confirm('이 컬렉션을 삭제할까요? (사운드 파일은 삭제되지 않습니다)')) return
    setCollections(await window.api.deleteCollection(id))
    if (selectedCollection === id) setSelectedCollection(null)
  }

  async function handleAddToCollection(collectionId: number, trackId: number): Promise<void> {
    if (!window.api) return
    setCollections(await window.api.addTrackToCollection(collectionId, trackId))
  }

  // 라이브러리별 폴더 트리
  const trees = useMemo(
    () =>
      libraries.map((lib) => ({
        library: lib,
        node: buildFolderTree(
          tracks.filter((t) => t.libraryId === lib.id),
          lib.rootPath
        )
      })),
    [libraries, tracks]
  )
  // 루트(진입) 화면 그리드에 보일 폴더 = 모든 라이브러리의 최상위 폴더
  const rootFolders = useMemo(() => trees.flatMap((t) => t.node.children), [trees])
  // 현재 선택 폴더가 속한 라이브러리
  const currentLibrary = useMemo(() => {
    if (!selectedFolder) return null
    return libraries.find((l) => norm(selectedFolder).startsWith(norm(l.rootPath))) ?? null
  }, [selectedFolder, libraries])

  async function handleOpenFolder(): Promise<void> {
    if (!window.api) return
    const folder = await window.api.selectFolder()
    if (!folder) return
    setScanning(true)
    try {
      // 폴더 추가 = 누적. 스캔 후 전체를 다시 받아 반영(기존 라이브러리 유지)
      const { libraries: allLibs, tracks: allTracks } = await window.api.scanLibrary(folder)
      setLibraries(allLibs)
      setTracks(allTracks)
      setSelectedFolder(null)
    } finally {
      setScanning(false)
      setScanProgress(null)
    }
  }

  async function handleRemoveLibrary(id: number): Promise<void> {
    if (!window.api) return
    const { libraries: allLibs, tracks: allTracks } = await window.api.removeLibrary(id)
    setLibraries(allLibs)
    setTracks(allTracks)
    setSelectedFolder(null)
    setSelectedTrack((prev) => (prev && prev.libraryId === id ? null : prev))
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

  const activeCollection = collections.find((c) => c.id === selectedCollection) ?? null

  const visibleTracks = useMemo(() => {
    let base: Track[]
    if (activeCollection) {
      const byId = new Map(tracks.map((t) => [t.id, t]))
      base = activeCollection.trackIds.map((id) => byId.get(id)).filter((t): t is Track => !!t)
    } else {
      base = selectedFolder ? tracksUnder(tracks, selectedFolder) : tracks
    }
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
  }, [tracks, selectedFolder, activeCollection, showStarredOnly, activeCategory, search])

  const isFiltering = Boolean(search.trim() || showStarredOnly || activeCategory || activeCollection)
  // 폴더를 선택하면(=selectedFolder 있음) 하위 폴더가 있어도 사운드를 재귀로 보여줌 (Soundly 방식).
  // 폴더 카드 그리드는 최상위 진입 화면(아무 폴더도 선택 안 함)에서만 표시.
  const showGrid = view === 'grid' && !isFiltering && !selectedFolder && rootFolders.length > 0

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

  // 브레드크럼: 라이브러리명 + 선택 폴더 세그먼트 (Home = 루트 그리드)
  const crumbs = useMemo(() => {
    if (!currentLibrary || !selectedFolder) return []
    const root = norm(currentLibrary.rootPath)
    const list: Array<{ label: string; path: string }> = [
      { label: currentLibrary.name, path: currentLibrary.rootPath }
    ]
    const rel = norm(selectedFolder).slice(root.length).replace(/^\/+/, '')
    let acc = root
    rel
      .split('/')
      .filter(Boolean)
      .forEach((seg) => {
        acc = `${acc}/${seg}`
        list.push({ label: seg, path: acc })
      })
    return list
  }, [currentLibrary, selectedFolder])

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
        {scanning && (
          <div className="scanbar">
            <div className="scanbar__spinner" />
            <div className="scanbar__text">
              <span className="scanbar__count">
                {scanProgress ? `${scanProgress.scanned.toLocaleString()} / ${scanProgress.total.toLocaleString()}` : '스캔 준비 중…'}
              </span>
              <span className="scanbar__file">{scanProgress?.currentFile ?? ''}</span>
            </div>
            <div className="scanbar__track">
              <div
                className="scanbar__fill"
                style={{
                  width: scanProgress && scanProgress.total > 0
                    ? `${(scanProgress.scanned / scanProgress.total) * 100}%`
                    : '0%'
                }}
              />
            </div>
          </div>
        )}
        <div className="topbar__actions">
          <AccentPicker accent={accent} onChange={setAccent} />
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
          trees={trees}
          tracks={tracks}
          onOpenFolder={handleOpenFolder}
          onRemoveLibrary={handleRemoveLibrary}
          selectedFolder={selectedFolder}
          onSelectFolder={(p) => {
            setSelectedFolder(p)
            setSelectedCollection(null)
            setShowStarredOnly(false)
            setActiveCategory(null)
          }}
          collections={collections}
          selectedCollection={selectedCollection}
          onSelectCollection={(id) => {
            setSelectedCollection(id)
            setSelectedFolder(null)
            setShowStarredOnly(false)
            setActiveCategory(null)
          }}
          onCreateCollection={handleCreateCollection}
          onDeleteCollection={handleDeleteCollection}
          showStarredOnly={showStarredOnly}
          onToggleStarredView={() => {
            setShowStarredOnly((v) => !v)
            setSelectedCollection(null)
            setActiveCategory(null)
          }}
          activeCategory={activeCategory}
          onSelectCategory={(c) => {
            setActiveCategory(c)
            setSelectedCollection(null)
            setShowStarredOnly(false)
          }}
        />

        <div className="content-wrap">
          <div className="breadcrumb">
            <span
              className={`breadcrumb__link${!selectedFolder && !activeCollection ? ' breadcrumb__link--current' : ''}`}
              onClick={() => {
                setSelectedFolder(null)
                setSelectedCollection(null)
              }}
            >
              Home
            </span>
            {activeCollection && (
              <span className="breadcrumb__seg">
                <span className="breadcrumb__sep">/</span>
                <span className="breadcrumb__link breadcrumb__link--current">
                  ★ {activeCollection.name}
                </span>
              </span>
            )}
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
              {showGrid ? `${rootFolders.length} folders` : `${visibleTracks.length} sounds`}
            </span>
          </div>

          {showGrid ? (
            <FolderGrid folders={rootFolders} onOpenFolder={(p) => setSelectedFolder(p)} />
          ) : (
            <ResultList
              tracks={visibleTracks}
              libraries={libraries}
              collections={collections}
              selectedTrackId={selectedTrack?.id ?? null}
              onSelectTrack={handleSelectTrack}
              onToggleStar={handleToggleStar}
              onAddToCollection={handleAddToCollection}
              onCreateCollectionWith={async (trackId) => {
                const name = window.prompt('새 컬렉션 이름')
                if (!name?.trim() || !window.api) return
                const cols = await window.api.createCollection(name.trim())
                setCollections(cols)
                const created = cols[cols.length - 1]
                if (created) await handleAddToCollection(created.id, trackId)
              }}
            />
          )}
        </div>

        {showMeta && <MetadataPanel track={selectedTrack} onToggleStar={handleToggleStar} />}
      </div>

      <PlayerBar
        track={selectedTrack}
        accent={accent}
        onPrev={() => selectRelative(-1)}
        onNext={() => selectRelative(1)}
      />
    </div>
  )
}
