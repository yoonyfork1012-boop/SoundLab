import { useEffect, useMemo, useRef, useState } from 'react'
import MenuBar from './components/MenuBar/MenuBar'
import Sidebar from './components/Sidebar/Sidebar'
import ResultList from './components/ResultList/ResultList'
import FolderGrid from './components/FolderGrid/FolderGrid'
import PlayerBar, { type PlayerHandle } from './components/PlayerBar/PlayerBar'
import MetadataPanel from './components/MetadataPanel/MetadataPanel'
import AccentPicker from './components/AccentPicker/AccentPicker'
import NamePromptModal from './components/NamePromptModal/NamePromptModal'
import ContextMenu from './components/ContextMenu/ContextMenu'
import ColorPickerPopover from './components/ColorPickerPopover/ColorPickerPopover'
import Toast from './components/Toast/Toast'
import ShortcutsModal from './components/ShortcutsModal/ShortcutsModal'
import type { Collection, Library, ScanProgress, Track } from '@shared/types'
import { isBrowserPreview, mockCollections, mockLibrary, mockTracks } from './mockData'
import { buildFolderTree, tracksUnder, type FolderNode } from './lib/folderTree'
import { applyAccent, loadAccent, saveAccent } from './lib/theme'
import { loadJSON, loadNumber, saveJSON, saveNumber } from './lib/uiState'
import { shuffleTracks, sortTracks } from './components/ResultList/columns'

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 440
const META_MIN = 220
const META_MAX = 480
const PLAYER_MIN = 96
const PLAYER_MAX = 380

export default function App(): JSX.Element {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)
  const [search, setSearch] = useState('')
  const [subSearch, setSubSearch] = useState('')
  // Shuffle은 토글이 아니라 "버튼 클릭 = 지금 즉시 새로 섞기" 동작. shuffled는 현재 리스트가
  // 셔플된 순서로 보이는 중인지만 나타내며(컬럼 정렬을 클릭하면 다시 false), 영속 저장하지 않는다.
  const [shuffled, setShuffled] = useState(false)
  const [shuffleSeed, setShuffleSeed] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [selectedCollection, setSelectedCollection] = useState<number | null>(null)
  const [showStarredOnly, setShowStarredOnly] = useState(false)
  const [showMeta, setShowMeta] = useState(true)
  const [namePrompt, setNamePrompt] = useState<{
    title: string
    defaultValue?: string
    confirmLabel?: string
    onSubmit: (name: string) => void
  } | null>(null)
  const [collectionMenu, setCollectionMenu] = useState<{ x: number; y: number; collection: Collection } | null>(
    null
  )
  const [libraryMenu, setLibraryMenu] = useState<{ x: number; y: number; library: Library } | null>(null)
  const [colorPicker, setColorPicker] = useState<{ x: number; y: number; collectionId: number; color: string | null } | null>(
    null
  )
  const [toast, setToast] = useState<string | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  // 다중 선택(Ctrl+A 등). 단일 클릭/화살표 이동 시 해당 트랙 하나로 초기화됨.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const toastTimerRef = useRef<number | undefined>(undefined)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const subSearchRef = useRef<HTMLInputElement>(null)
  const playerRef = useRef<PlayerHandle>(null)

  function showToast(message: string): void {
    setToast(message)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200)
  }
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [accent, setAccentState] = useState<string>(loadAccent())
  const [sidebarWidth, setSidebarWidth] = useState(() => loadNumber('soundlib.sidebarWidth', 246))
  const [metaWidth, setMetaWidth] = useState(() => loadNumber('soundlib.metaWidth', 272))
  const [playerHeight, setPlayerHeight] = useState(() => loadNumber('soundlib.playerHeight', 140))
  const [sort, setSort] = useState<{ key: string | null; dir: 'asc' | 'desc' }>(() =>
    loadJSON('soundlib.sort', { key: null, dir: 'asc' })
  )

  function handleSort(key: string): void {
    // 셔플된 상태에서 컬럼 정렬을 클릭하면 셔플은 해제되고 정렬이 적용됨
    if (shuffled) setShuffled(false)
    setSort((prev) => {
      const next: { key: string | null; dir: 'asc' | 'desc' } =
        prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
      saveJSON('soundlib.sort', next)
      return next
    })
  }
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)

  useEffect(() => {
    if (!window.api?.onScanProgress) return
    return window.api.onScanProgress((p) => setScanProgress(p))
  }, [])

  // "Monitor for changes"로 백그라운드에서 재스캔되면 최신 라이브러리/트랙을 반영
  useEffect(() => {
    if (!window.api?.onLibraryUpdated) return
    return window.api.onLibraryUpdated(({ libraries, tracks }) => {
      setLibraries(libraries)
      setTracks(tracks)
    })
  }, [])

  useEffect(() => {
    applyAccent(accent)
  }, [accent])

  function setAccent(hex: string): void {
    setAccentState(hex)
    saveAccent(hex)
  }

  // 사이드바/메타패널 드래그 리사이즈 (최소·최대 폭 제한, 종료 시 폭 저장)
  function startPanelResize(e: React.MouseEvent, which: 'sidebar' | 'meta'): void {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = which === 'sidebar' ? sidebarWidth : metaWidth
    const min = which === 'sidebar' ? SIDEBAR_MIN : META_MIN
    const max = which === 'sidebar' ? SIDEBAR_MAX : META_MAX
    let latest = startWidth

    function onMove(ev: MouseEvent): void {
      const delta = which === 'sidebar' ? ev.clientX - startX : startX - ev.clientX
      latest = Math.max(min, Math.min(max, startWidth + delta))
      if (which === 'sidebar') setSidebarWidth(latest)
      else setMetaWidth(latest)
    }
    function onUp(): void {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      saveNumber(which === 'sidebar' ? 'soundlib.sidebarWidth' : 'soundlib.metaWidth', latest)
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // 하단 플레이어(웨이브폼) 높이 드래그 조절 — 위로 끌면 커지고, 최소/최대 제한 + 종료 시 저장
  function startPlayerResize(e: React.MouseEvent): void {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = playerHeight
    let latest = startHeight
    function onMove(ev: MouseEvent): void {
      latest = Math.max(PLAYER_MIN, Math.min(PLAYER_MAX, startHeight + (startY - ev.clientY)))
      setPlayerHeight(latest)
    }
    function onUp(): void {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      saveNumber('soundlib.playerHeight', latest)
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
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

  function handleCreateCollection(): void {
    setNamePrompt({
      title: '새 컬렉션 이름',
      onSubmit: async (name) => {
        if (window.api) setCollections(await window.api.createCollection(name))
        setNamePrompt(null)
      }
    })
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

  function handleRenameCollection(collection: Collection): void {
    setNamePrompt({
      title: '컬렉션 이름 변경',
      defaultValue: collection.name,
      confirmLabel: '변경',
      onSubmit: async (name) => {
        if (window.api) setCollections(await window.api.renameCollection(collection.id, name))
        setNamePrompt(null)
      }
    })
  }

  async function handleSetCollectionColor(collectionId: number, color: string | null): Promise<void> {
    if (!window.api) return
    setCollections(await window.api.setCollectionColor(collectionId, color))
  }

  async function handleAddFolderToCollection(collectionId: number): Promise<void> {
    if (!window.api) return
    const folder = await window.api.selectFolder()
    if (!folder) return
    const matching = tracksUnder(tracks, folder)
    if (matching.length === 0) {
      showToast('선택한 폴더에 해당하는 사운드가 없습니다')
      return
    }
    setCollections(await window.api.addTracksToCollection(collectionId, matching.map((t) => t.id)))
    showToast(`${matching.length}개 사운드를 컬렉션에 추가했습니다`)
  }

  async function handleShareCollection(collection: Collection): Promise<void> {
    if (!window.api) return
    const byId = new Map(tracks.map((t) => [t.id, t]))
    const paths = collection.trackIds.map((id) => byId.get(id)?.filePath).filter((p): p is string => !!p)
    if (paths.length === 0) {
      showToast('공유할 사운드가 없습니다')
      return
    }
    await window.api.writeClipboardText(paths.join('\n'))
    showToast(`${paths.length}개 파일 경로를 클립보드에 복사했습니다`)
  }

  function handleSearchInCollection(collection: Collection): void {
    setSelectedCollection(collection.id)
    setSelectedFolder(null)
    setShowStarredOnly(false)
    searchInputRef.current?.focus()
  }

  function handleSearchInLibrary(library: Library): void {
    setSelectedFolder(library.rootPath)
    setSelectedCollection(null)
    setShowStarredOnly(false)
    searchInputRef.current?.focus()
  }

  function handleCheckOnlyLibrary(library: Library): void {
    setSelectedFolder(library.rootPath)
    setSelectedCollection(null)
    setShowStarredOnly(false)
  }

  async function handleScanNewFiles(library: Library): Promise<void> {
    if (!window.api) return
    setScanning(true)
    try {
      const { libraries: allLibs, tracks: allTracks, addedCount } = await window.api.scanNewFiles(
        library.id,
        library.rootPath
      )
      setLibraries(allLibs)
      setTracks(allTracks)
      showToast(addedCount > 0 ? `새 파일 ${addedCount}개를 추가했습니다` : '새 파일이 없습니다')
    } finally {
      setScanning(false)
      setScanProgress(null)
    }
  }

  async function handleShowInExplorer(library: Library): Promise<void> {
    await window.api?.showInExplorer(library.rootPath)
  }

  async function handleAnalyzeLibrary(library: Library): Promise<void> {
    if (!window.api) return
    showToast('유사 사운드 분석 중…')
    const { libraries: allLibs, analyzedCount } = await window.api.analyzeLibrary(library.id)
    setLibraries(allLibs)
    showToast(`${analyzedCount}개 트랙 분석 완료`)
  }

  function handleRenameLibrary(library: Library): void {
    setNamePrompt({
      title: '라이브러리 이름 변경',
      defaultValue: library.name,
      confirmLabel: '변경',
      onSubmit: async (name) => {
        if (window.api) setLibraries(await window.api.renameLibrary(library.id, name))
        setNamePrompt(null)
      }
    })
  }

  async function handleToggleMonitor(library: Library): Promise<void> {
    if (!window.api) return
    const next = !library.monitor
    setLibraries(await window.api.setLibraryMonitor(library.id, library.rootPath, next))
    showToast(next ? '변경 감시를 켰습니다' : '변경 감시를 껐습니다')
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
    setSelectedIds(new Set([track.id])) // 단일 선택으로 초기화
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
    if (subSearch.trim()) {
      const q = subSearch.toLowerCase()
      base = base.filter(
        (t) =>
          t.filename.toLowerCase().includes(q) ||
          (t.category ?? '').toLowerCase().includes(q) ||
          (t.subcategory ?? '').toLowerCase().includes(q) ||
          (t.description ?? '').toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      )
    }
    // shuffled면 리스트 표시 순서 자체를 섞고, 아니면 정렬 상태(또는 기본 순서)로 표시
    base = shuffled ? shuffleTracks(base, shuffleSeed) : sortTracks(base, sort.key, sort.dir, { libraries })
    return base
  }, [
    tracks,
    selectedFolder,
    activeCollection,
    showStarredOnly,
    search,
    subSearch,
    sort,
    libraries,
    shuffled,
    shuffleSeed
  ])

  const isFiltering = Boolean(search.trim() || showStarredOnly || activeCollection)
  // 폴더를 선택하면(=selectedFolder 있음) 하위 폴더가 있어도 사운드를 재귀로 보여줌 (Soundly 방식).
  // 폴더 카드 그리드는 최상위 진입 화면(아무 폴더도 선택 안 함)에서만 표시.
  const showGrid = view === 'grid' && !isFiltering && !selectedFolder && rootFolders.length > 0

  function selectRelative(delta: number): void {
    // Shuffle Mode에서는 visibleTracks 자체가 이미 섞인 순서이므로, 그 순서를 그대로 순차 탐색하면 됨
    if (visibleTracks.length === 0) return
    const idx = visibleTracks.findIndex((t) => t.id === selectedTrack?.id)
    let next = idx === -1 ? 0 : idx + delta
    next = Math.max(0, Math.min(visibleTracks.length - 1, next))
    void handleSelectTrack(visibleTracks[next])
  }

  // Shuffle 버튼 클릭 = 토글이 아니라 "지금 리스트를 새 순서로 다시 섞기"
  function handleShuffleClick(): void {
    setShuffled(true)
    setShuffleSeed(Date.now())
  }

  // 단축키 대상 라이브러리: 현재 폴더의 라이브러리 → 선택 트랙의 라이브러리 → 첫 라이브러리
  const shortcutLibrary = useMemo(() => {
    if (currentLibrary) return currentLibrary
    if (selectedTrack) return libraries.find((l) => l.id === selectedTrack.libraryId) ?? null
    return libraries[0] ?? null
  }, [currentLibrary, selectedTrack, libraries])

  function selectAllVisible(): void {
    if (visibleTracks.length === 0) return
    setSelectedIds(new Set(visibleTracks.map((t) => t.id)))
    showToast(`${visibleTracks.length.toLocaleString()}개 선택됨`)
  }

  async function removeTracksFromActiveCollection(ids: number[]): Promise<void> {
    if (!window.api || !activeCollection) return
    let cols = collections
    for (const id of ids) {
      cols = await window.api.removeTrackFromCollection(activeCollection.id, id)
    }
    setCollections(cols)
    showToast(`${ids.length}개 사운드를 컬렉션에서 제거했습니다`)
  }

  // Delete: 컬렉션 보기에서는 선택 트랙을 컬렉션에서 제거. (라이브러리 보기에서는 실제 파일을
  // 삭제하지 않으므로 안전하게 아무 동작도 하지 않음)
  function handleDeleteShortcut(): void {
    if (activeCollection) {
      const ids = selectedIds.size > 0 ? [...selectedIds] : selectedTrack ? [selectedTrack.id] : []
      if (ids.length > 0) void removeTracksFromActiveCollection(ids)
    } else if (selectedCollection == null && showStarredOnly) {
      // 즐겨찾기 보기에서 Delete = 선택 트랙 즐겨찾기 해제
      if (selectedTrack?.starred) void handleToggleStar(selectedTrack)
    }
  }

  // F2: 컬렉션 보기면 컬렉션 이름 변경, 아니면 현재 라이브러리 이름 변경
  function handleRenameShortcut(): void {
    if (activeCollection) handleRenameCollection(activeCollection)
    else if (currentLibrary) handleRenameLibrary(currentLibrary)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (target?.isContentEditable ?? false)
      const mod = e.ctrlKey || e.metaKey

      // ── 포커스 위치와 무관하게 동작 ──
      // Ctrl+F: 메인 검색 / Ctrl+Shift+F: 서브 검색
      if (mod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        const el = e.shiftKey ? subSearchRef.current : searchInputRef.current
        el?.focus()
        el?.select()
        return
      }
      // Esc: 정지 + 구간 선택 해제 (입력 중이면 블러)
      if (e.key === 'Escape') {
        playerRef.current?.stopAndClear()
        setSelectedIds((prev) => (prev.size > 0 ? new Set() : prev))
        if (inEditable) target?.blur()
        return
      }

      if (mod && (e.key === 'a' || e.key === 'A')) {
        if (inEditable) return // 인풋 내 텍스트 전체 선택은 기본 동작 유지
        e.preventDefault()
        selectAllVisible()
        return
      }
      if (mod && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        if (shortcutLibrary) void handleScanNewFiles(shortcutLibrary)
        return
      }
      if (mod && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault()
        const path = selectedFolder ?? shortcutLibrary?.rootPath
        if (path) void window.api?.showInExplorer(path)
        return
      }
      // 그 외 Ctrl/Meta 조합은 브라우저/OS 기본 동작에 맡김
      if (mod) return
      // 입력창에서 편집 중이면 (Ctrl 조합이 아닌) 나머지 단축키는 텍스트 입력을 방해하지 않도록 무시
      if (inEditable) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          playerRef.current?.playPause()
          break
        case 'Enter':
          e.preventDefault()
          playerRef.current?.play()
          break
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault()
          selectRelative(1)
          break
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault()
          selectRelative(-1)
          break
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          handleDeleteShortcut()
          break
        case 'F2':
          e.preventDefault()
          handleRenameShortcut()
          break
        case 's':
        case 'S':
          handleShuffleClick()
          break
        case 'f':
        case 'F':
          if (selectedTrack) void handleToggleStar(selectedTrack)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    visibleTracks,
    selectedTrack,
    activeCollection,
    selectedCollection,
    showStarredOnly,
    currentLibrary,
    shortcutLibrary,
    selectedFolder,
    selectedIds,
    collections
  ])

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
    <div
      className="app"
      style={{
        gridTemplateRows: `var(--menubar-h) var(--topbar-h) 1fr ${playerHeight}px`
      }}
    >
      <MenuBar
        onAddFolder={handleOpenFolder}
        onToggleMeta={() => setShowMeta((v) => !v)}
        view={view}
        onSetView={setView}
        onShowShortcuts={() => setShowShortcuts(true)}
      />

      <div className="topbar">
        <div className="topbar__search-wrap">
          <svg className="topbar__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={searchInputRef}
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
              <span className="scanbar__phase">
                {!scanProgress || scanProgress.phase === 'discovering'
                  ? '1/2  파일 검색 중'
                  : '2/2  메타데이터 분석 중'}
              </span>
              <span className="scanbar__count">
                {!scanProgress
                  ? '준비 중…'
                  : scanProgress.phase === 'discovering'
                    ? `${scanProgress.scanned.toLocaleString()}개 발견`
                    : `${scanProgress.scanned.toLocaleString()} / ${scanProgress.total.toLocaleString()}`}
              </span>
              <span className="scanbar__file">{scanProgress?.currentFile ?? ''}</span>
            </div>
            <div className="scanbar__track">
              <div
                className={`scanbar__fill${!scanProgress || scanProgress.phase === 'discovering' ? ' scanbar__fill--indeterminate' : ''}`}
                style={
                  scanProgress && scanProgress.phase === 'parsing' && scanProgress.total > 0
                    ? { width: `${(scanProgress.scanned / scanProgress.total) * 100}%` }
                    : undefined
                }
              />
            </div>
          </div>
        )}
        <div className="topbar__actions">
          <AccentPicker accent={accent} onChange={setAccent} />
          <button
            className={`icon-btn${shuffled ? ' icon-btn--active' : ''}`}
            title="Shuffle — 클릭할 때마다 리스트를 새 순서로 섞습니다"
            onClick={handleShuffleClick}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 3h5v5" />
              <path d="M4 20L21 3" />
              <path d="M21 16v5h-5" />
              <path d="M15 15l6 6" />
              <path d="M4 4l5 5" />
            </svg>
          </button>
          <div className="topbar__subsearch-wrap" title="검색 결과 내에서 다시 필터링">
            <svg className="topbar__subsearch-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              ref={subSearchRef}
              className="topbar__subsearch"
              placeholder="Filter…"
              value={subSearch}
              onChange={(e) => setSubSearch(e.target.value)}
            />
          </div>
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

      <div
        className="main"
        style={{
          gridTemplateColumns: showMeta
            ? `${sidebarWidth}px 1fr ${metaWidth}px`
            : `${sidebarWidth}px 1fr`
        }}
      >
        <div
          className="resizer resizer--left"
          style={{ left: sidebarWidth }}
          onMouseDown={(e) => startPanelResize(e, 'sidebar')}
        />
        {showMeta && (
          <div
            className="resizer resizer--right"
            style={{ right: metaWidth }}
            onMouseDown={(e) => startPanelResize(e, 'meta')}
          />
        )}
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
          }}
          collections={collections}
          selectedCollection={selectedCollection}
          onSelectCollection={(id) => {
            setSelectedCollection(id)
            setSelectedFolder(null)
            setShowStarredOnly(false)
          }}
          onCreateCollection={handleCreateCollection}
          onDeleteCollection={handleDeleteCollection}
          showStarredOnly={showStarredOnly}
          onToggleStarredView={() => {
            setShowStarredOnly((v) => !v)
            setSelectedCollection(null)
          }}
          onSelectLocalRoot={() => {
            // Local 클릭 = 최상위 진입점: 모든 선택 해제 + 폴더 그리드 화면으로
            setSelectedFolder(null)
            setSelectedCollection(null)
            setShowStarredOnly(false)
            setSearch('')
            setSubSearch('')
            setView('grid')
          }}
          onCollectionContextMenu={(e, collection) => setCollectionMenu({ x: e.clientX, y: e.clientY, collection })}
          onLibraryContextMenu={(e, library) => setLibraryMenu({ x: e.clientX, y: e.clientY, library })}
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
              selectedIds={selectedIds}
              onSelectTrack={handleSelectTrack}
              onToggleStar={handleToggleStar}
              onAddToCollection={handleAddToCollection}
              sortKey={sort.key}
              sortDir={sort.dir}
              onSort={handleSort}
              onCreateCollectionWith={(trackId) => {
                setNamePrompt({
                  title: '새 컬렉션 이름',
                  onSubmit: async (name) => {
                    if (window.api) {
                      const cols = await window.api.createCollection(name)
                      setCollections(cols)
                      const created = cols[cols.length - 1]
                      if (created) await handleAddToCollection(created.id, trackId)
                    }
                    setNamePrompt(null)
                  }
                })
              }}
            />
          )}
        </div>

        {showMeta && <MetadataPanel track={selectedTrack} onToggleStar={handleToggleStar} />}
      </div>

      {/* 리스트/플레이어 경계 높이 조절 핸들 (플레이어 상단 경계에 겹쳐 배치) */}
      <div
        className="resizer-h"
        style={{ bottom: playerHeight }}
        onMouseDown={startPlayerResize}
      />

      <PlayerBar
        ref={playerRef}
        track={selectedTrack}
        accent={accent}
        panelHeight={playerHeight}
        onPrev={() => selectRelative(-1)}
        onNext={() => selectRelative(1)}
      />

      {namePrompt && (
        <NamePromptModal
          title={namePrompt.title}
          defaultValue={namePrompt.defaultValue}
          confirmLabel={namePrompt.confirmLabel}
          onSubmit={namePrompt.onSubmit}
          onCancel={() => setNamePrompt(null)}
        />
      )}

      {collectionMenu && (
        <ContextMenu
          x={collectionMenu.x}
          y={collectionMenu.y}
          onClose={() => setCollectionMenu(null)}
          items={[
            {
              key: 'search',
              label: 'Search in collection',
              onClick: () => handleSearchInCollection(collectionMenu.collection)
            },
            {
              key: 'addfolder',
              label: 'Add folder',
              onClick: () => void handleAddFolderToCollection(collectionMenu.collection.id)
            },
            { key: 'rename', label: 'Rename', onClick: () => handleRenameCollection(collectionMenu.collection) },
            { key: 'share', label: 'Share', onClick: () => void handleShareCollection(collectionMenu.collection) },
            {
              key: 'setcolor',
              label: 'Set color',
              onClick: () =>
                setColorPicker({
                  x: collectionMenu.x,
                  y: collectionMenu.y,
                  collectionId: collectionMenu.collection.id,
                  color: collectionMenu.collection.color
                })
            },
            { key: 'sep1', separator: true },
            {
              key: 'delete',
              label: 'Delete',
              danger: true,
              onClick: () => void handleDeleteCollection(collectionMenu.collection.id)
            }
          ]}
        />
      )}

      {colorPicker && (
        <ColorPickerPopover
          x={colorPicker.x}
          y={colorPicker.y}
          color={colorPicker.color}
          onPick={(color) => void handleSetCollectionColor(colorPicker.collectionId, color)}
          onClose={() => setColorPicker(null)}
        />
      )}

      {libraryMenu && (
        <ContextMenu
          x={libraryMenu.x}
          y={libraryMenu.y}
          onClose={() => setLibraryMenu(null)}
          width={240}
          items={[
            { key: 'search', label: 'Search in library', onClick: () => handleSearchInLibrary(libraryMenu.library) },
            {
              key: 'checkonly',
              label: 'Check only this library',
              onClick: () => handleCheckOnlyLibrary(libraryMenu.library)
            },
            {
              key: 'scannew',
              label: 'Scan for new files',
              onClick: () => void handleScanNewFiles(libraryMenu.library)
            },
            {
              key: 'explorer',
              label: 'Show in Explorer',
              onClick: () => void handleShowInExplorer(libraryMenu.library)
            },
            {
              key: 'analyze',
              label: 'Analyze for Find Similar',
              onClick: () => void handleAnalyzeLibrary(libraryMenu.library)
            },
            { key: 'rename', label: 'Rename', onClick: () => handleRenameLibrary(libraryMenu.library) },
            {
              key: 'monitor',
              label: `Monitor for changes: ${libraryMenu.library.monitor ? 'On' : 'Off'}`,
              checked: libraryMenu.library.monitor,
              onClick: () => void handleToggleMonitor(libraryMenu.library)
            },
            { key: 'sep1', separator: true },
            {
              key: 'remove',
              label: 'Remove',
              danger: true,
              onClick: () => void handleRemoveLibrary(libraryMenu.library.id)
            }
          ]}
        />
      )}

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {toast && <Toast message={toast} />}
    </div>
  )
}
