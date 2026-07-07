import { useEffect, useMemo, useRef, useState } from 'react'
import MenuBar from './components/MenuBar/MenuBar'
import Sidebar from './components/Sidebar/Sidebar'
import ResultList from './components/ResultList/ResultList'
import FolderGrid from './components/FolderGrid/FolderGrid'
import PlayerBar, { type PlayerHandle } from './components/PlayerBar/PlayerBar'
import MetadataPanel from './components/MetadataPanel/MetadataPanel'
import AnalysisPanel from './components/AnalysisPanel/AnalysisPanel'
import AccentPicker from './components/AccentPicker/AccentPicker'
import NamePromptModal from './components/NamePromptModal/NamePromptModal'
import ContextMenu from './components/ContextMenu/ContextMenu'
import ColorPickerPopover from './components/ColorPickerPopover/ColorPickerPopover'
import Toast from './components/Toast/Toast'
import ShortcutsModal from './components/ShortcutsModal/ShortcutsModal'
import PublisherSettingsModal from './components/PublisherSettingsModal/PublisherSettingsModal'
import type { Collection, Library, PublisherRule, ScanProgress, Track } from '@shared/types'
import { isBrowserPreview, mockCollections, mockLibrary, mockTracks } from './mockData'
import { buildFolderTree, tracksUnder, type FolderNode } from './lib/folderTree'
import { applyAccent, loadAccent, saveAccent } from './lib/theme'
import { loadJSON, loadNumber, saveJSON, saveNumber } from './lib/uiState'
import { shuffleTracks, sortTracks } from './components/ResultList/columns'
import { DEFAULT_PUBLISHER_RULE } from '@shared/publisher'

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 440
const META_MIN = 220
const META_MAX = 480
const PLAYER_MIN = 96
const PLAYER_MAX = 380
const META_PANEL_HEIGHT_MIN = 160
const META_PANEL_HEIGHT_MAX = 640
// Analysis(Peak/Stereo Image)가 ?�무�?좁아??최소 ???�도 ?�이???�도�??�약 ??// ??그러�?Metadata�??�까지 ?�렸????Analysis가 ?�면 밖으�??�전??밀??"?�라�? 것처??보임
const ANALYSIS_MIN_RESERVED = 170

export default function App(): JSX.Element {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)
  const [search, setSearch] = useState('')
  const [subSearch, setSubSearch] = useState('')
  // Shuffle?� ?��????�니??"버튼 ?�릭 = 지�?즉시 ?�로 ?�기" ?�작. shuffled???�재 리스?��?
  // ?�플???�서�?보이??중인지�??��??�며(컬럼 ?�렬???�릭?�면 ?�시 false), ?�속 ?�?�하지 ?�는??
  const [shuffled, setShuffled] = useState(false)
  const [shuffleSeed, setShuffleSeed] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [selectedCollection, setSelectedCollection] = useState<number | null>(null)
  const [showStarredOnly, setShowStarredOnly] = useState(false)
  const [showMeta, setShowMeta] = useState(true)
  const [publisherRule, setPublisherRule] = useState<PublisherRule>(() =>
    loadJSON('soundlib.publisherRule', DEFAULT_PUBLISHER_RULE)
  )
  const [publisherSettingsOpen, setPublisherSettingsOpen] = useState(false)
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
  // ?�중 ?�택(Ctrl+A ??. ?�일 ?�릭/?�살???�동 ???�당 ?�랙 ?�나�?초기?�됨.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  // "미리듣기(previewed)" 표시를 tracks 배열과 분리된 별도 상태로 둔다 — 예전에는 선택할 때마다
  // setTracks(prev => prev.map(...))로 tracks 참조 자체를 바꿨는데, 이게 visibleTracks의
  // useMemo 의존성이라 클릭할 때마다 라이브러리 전체(수만~수십만 트랙)를 다시 정렬/필터링하는
  // 원인이었다(클릭 반응 저하의 주범). previewedIds는 이 세션에서 막 선택한 트랙만 담고,
  // 재시작 후 이력은 DB에서 로드된 track.lastPlayedAt으로 그대로 커버된다.
  const [previewedIds, setPreviewedIds] = useState<Set<number>>(new Set())
  const toastTimerRef = useRef<number | undefined>(undefined)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const subSearchRef = useRef<HTMLInputElement>(null)
  const playerRef = useRef<PlayerHandle>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)

  function showToast(message: string): void {
    setToast(message)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200)
  }
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [accent, setAccentState] = useState<string>(loadAccent())
  const [sidebarWidth, setSidebarWidth] = useState(() => loadNumber('soundlib.sidebarWidth', 246))
  const [metaWidth, setMetaWidth] = useState(() => loadNumber('soundlib.metaWidth', 272))
  const [metaPanelHeight, setMetaPanelHeight] = useState(() => loadNumber('soundlib.metaPanelHeight', 320))
  const [playerHeight, setPlayerHeight] = useState(() => loadNumber('soundlib.playerHeight', 140))
  const [sort, setSort] = useState<{ key: string | null; dir: 'asc' | 'desc' }>(() =>
    loadJSON('soundlib.sort', { key: null, dir: 'asc' })
  )
  function handleSort(key: string): void {
    // Shuffle mode is disabled when the user sorts the list
    if (shuffled) setShuffled(false)
    setSort((prev) => {
      const next: { key: string | null; dir: 'asc' | 'desc' } =
        prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
      saveJSON('soundlib.sort', next)
      return next
    })
  }
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)

  // 진행 ?�벤?��? ?�면(?�동 ?�캔?�든 백그?�운??감시 ?�스캔이?? ?�덱???�시�?켠다
  useEffect(() => {
    if (!window.api?.onScanProgress) return
    return window.api.onScanProgress((p) => {
      setScanProgress(p)
      setScanning(true)
    })
  }, [])

  // "Monitor for changes"�?백그?�운?�에???�스캔되�?최신 ?�이브러�??�랙??반영?�고
  // (?�동 ?�캔 ?�들?��? 거치지 ?�으므�? ?�기??직접 ?�덱???�시�??�다
  useEffect(() => {
    if (!window.api?.onLibraryUpdated) return
    return window.api.onLibraryUpdated(({ libraries, tracks }) => {
      setLibraries(libraries)
      setTracks(tracks)
      setScanning(false)
      setScanProgress(null)
    })
  }, [])

  useEffect(() => {
    applyAccent(accent)
  }, [accent])

  function setAccent(hex: string): void {
    setAccentState(hex)
    saveAccent(hex)
  }

  function handleSavePublisherRule(next: PublisherRule): void {
    setPublisherRule(next)
    saveJSON('soundlib.publisherRule', next)
    setPublisherSettingsOpen(false)
  }

  // ?�이?�바/메�??�널 ?�래�?리사?�즈 (최소·최�? ???�한, 종료 ?????�??
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
  // Bottom player height resize handle with min/max limits
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

  // ?�측 컬럼 ?�에??Metadata/Analysis ?�이 배분 조절 ???�래�??�면 Metadata가 커짐.
  // ?�래�??�작 ?�점???�측 컬럼 ?�제 ?�이�??�서, Metadata�??�무�??�려??Analysis가
  // ANALYSIS_MIN_RESERVED 밑으�??�려가(=?�면 밖으�?밀???�라?? 보이지 ?�게 ?�는 ?�이
  // ?�도�??�번 ?�래그의 최�?값을 ?�적?�로 ?�시 계산?�다.
  function startMetaPanelResize(e: React.MouseEvent): void {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = metaPanelHeight
    const rightPanelHeight = rightPanelRef.current?.getBoundingClientRect().height ?? META_PANEL_HEIGHT_MAX
    const dynamicMax = Math.max(META_PANEL_HEIGHT_MIN, Math.min(META_PANEL_HEIGHT_MAX, rightPanelHeight - ANALYSIS_MIN_RESERVED))
    let latest = startHeight
    function onMove(ev: MouseEvent): void {
      latest = Math.max(META_PANEL_HEIGHT_MIN, Math.min(dynamicMax, startHeight + (ev.clientY - startY)))
      setMetaPanelHeight(latest)
    }
    function onUp(): void {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      saveNumber('soundlib.metaPanelHeight', latest)
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ?�전???�?�된 metaPanelHeight가 지�?�??�기 기�??�로 ?�무 커서 Analysis가 ?�면
  // 밖으�?밀?�나 ?�으�??? ?�전??????창에???�?? ?�작 ??�??�기 변�???보정?�다.
  useEffect(() => {
    function clampToFit(): void {
      const rightPanelHeight = rightPanelRef.current?.getBoundingClientRect().height
      if (!rightPanelHeight) return
      const maxAllowed = Math.max(META_PANEL_HEIGHT_MIN, rightPanelHeight - ANALYSIS_MIN_RESERVED)
      setMetaPanelHeight((prev) => (prev > maxAllowed ? maxAllowed : prev))
    }
    clampToFit()
    window.addEventListener('resize', clampToFit)
    return () => window.removeEventListener('resize', clampToFit)
  }, [showMeta])

  // ?�작 ???�?�돼 ?�던 ?�체 ?�이브러�??�랙 로드 (?�적 ?��?)
  useEffect(() => {
    if (isBrowserPreview) {
      setLibraries([mockLibrary])
      setTracks(mockTracks)
      setCollections(mockCollections)
      return
    }
    const loadTracksP = window.api?.loadAll().then(({ libraries, tracks }) => {
      setLibraries(libraries)
      setTracks(tracks)
    })
    const loadCollectionsP = window.api?.getCollections().then(setCollections)
    // 메인 프로세스의 스플래시 창은 이 초기 로드가 끝날 때까지 유지된다 — 실패하더라도
    // 스플래시에 갇히지 않도록 finally에서 알린다.
    Promise.all([loadTracksP, loadCollectionsP]).finally(() => {
      window.api?.notifyReady()
    })
  }, [])

  function handleCreateCollection(): void {
    setNamePrompt({
      title: 'New collection name',
      onSubmit: async (name) => {
        if (window.api) setCollections(await window.api.createCollection(name))
        setNamePrompt(null)
      }
    })
  }

  async function handleDeleteCollection(id: number): Promise<void> {
    if (!window.api) return
    if (!window.confirm('Delete this collection? This does not delete sounds.')) return
    setCollections(await window.api.deleteCollection(id))
    if (selectedCollection === id) setSelectedCollection(null)
  }

  async function handleAddToCollection(collectionId: number, trackId: number): Promise<void> {
    if (!window.api) return
    setCollections(await window.api.addTrackToCollection(collectionId, trackId))
  }

  function handleRenameCollection(collection: Collection): void {
    setNamePrompt({
      title: 'Rename collection',
      defaultValue: collection.name,
      confirmLabel: 'Rename',
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
      showToast('No sounds found in the selected folder')
      return
    }
    setCollections(await window.api.addTracksToCollection(collectionId, matching.map((t) => t.id)))
    showToast(`Added ${matching.length} sounds to the collection`)
  }

  async function handleShareCollection(collection: Collection): Promise<void> {
    if (!window.api) return
    const byId = new Map(tracks.map((t) => [t.id, t]))
    const paths = collection.trackIds.map((id) => byId.get(id)?.filePath).filter((p): p is string => !!p)
    if (paths.length === 0) {
      showToast('No sounds to share')
      return
    }
    await window.api.writeClipboardText(paths.join('\n'))
    showToast(`Copied ${paths.length} file paths to clipboard`)
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
      showToast(addedCount > 0 ? `Added ${addedCount} new files` : 'No new files')
    } catch (err) {
      showToast(`Failed to scan for new files: ${(err as Error)?.message ?? 'unknown error'}`)
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
    showToast('Analyzing sounds...')
    const { libraries: allLibs, analyzedCount } = await window.api.analyzeLibrary(library.id)
    setLibraries(allLibs)
    showToast(`Analyzed ${analyzedCount} tracks`)
  }

  function handleRenameLibrary(library: Library): void {
    setNamePrompt({
      title: 'Rename library',
      defaultValue: library.name,
      confirmLabel: 'Rename',
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
    showToast(next ? 'Monitoring enabled' : 'Monitoring disabled')
  }

  // ?�이브러리별 ?�더 ?�리
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
  // 루트(진입) ?�면 그리?�에 보일 ?�더 = 모든 ?�이브러리의 최상???�더
  const rootFolders = useMemo(() => trees.flatMap((t) => t.node.children), [trees])
  // Current selected library for the breadcrumb and shortcuts
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
      // ?�더 추�? = ?�적. ?�캔 ???�체�??�시 받아 반영(기존 ?�이브러�??��?)
      const { libraries: allLibs, tracks: allTracks } = await window.api.scanLibrary(folder)
      setLibraries(allLibs)
      setTracks(allTracks)
      setSelectedFolder(null)
    } catch (err) {
      showToast(`Failed to scan folder: ${(err as Error)?.message ?? 'unknown error'}`)
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
    setSelectedIds(new Set([track.id])) // ?�일 ?�택?�로 초기??    // Soundly처럼 미리?�기???�운?�는 ?�색(previewed) 처리 ??tracks 배열은 건드리지 않고
    // previewedIds만 갱신(visibleTracks 재정렬을 유발하지 않음)
    setPreviewedIds((prev) => (prev.has(track.id) ? prev : new Set(prev).add(track.id)))
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
    // shuffled�?리스???�시 ?�서 ?�체�??�고, ?�니�??�렬 ?�태(?�는 기본 ?�서)�??�시
    base = shuffled ? shuffleTracks(base, shuffleSeed) : sortTracks(base, sort.key, sort.dir, { libraries, publisherRule })
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
  // ?�더�??�택?�면(=selectedFolder ?�음) ?�위 ?�더가 ?�어???�운?��? ?��?�?보여�?(Soundly 방식).
  // ?�더 카드 그리?�는 최상??진입 ?�면(?�무 ?�더???�택 ?????�서�??�시.
  const showGrid = view === 'grid' && !isFiltering && !selectedFolder && rootFolders.length > 0

  function selectRelative(delta: number): void {
    // Shuffle mode still moves through the visible track list
    if (visibleTracks.length === 0) return
    const idx = visibleTracks.findIndex((t) => t.id === selectedTrack?.id)
    let next = idx === -1 ? 0 : idx + delta
    next = Math.max(0, Math.min(visibleTracks.length - 1, next))
    void handleSelectTrack(visibleTracks[next])
  }

  // Shuffle 버튼 ?�릭 = ?��????�니??"지�?리스?��? ???�서�??�시 ?�기"
  function handleShuffleClick(): void {
    setShuffled(true)
    setShuffleSeed(Date.now())
  }
  // Shortcut navigation library lookup
  const shortcutLibrary = useMemo(() => {
    if (currentLibrary) return currentLibrary
    if (selectedTrack) return libraries.find((l) => l.id === selectedTrack.libraryId) ?? null
    return libraries[0] ?? null
  }, [currentLibrary, selectedTrack, libraries])

  function selectAllVisible(): void {
    if (visibleTracks.length === 0) return
    setSelectedIds(new Set(visibleTracks.map((t) => t.id)))
    showToast(`${visibleTracks.length.toLocaleString()} selected`)
  }

  async function removeTracksFromActiveCollection(ids: number[]): Promise<void> {
    if (!window.api || !activeCollection) return
    let cols = collections
    for (const id of ids) {
      cols = await window.api.removeTrackFromCollection(activeCollection.id, id)
    }
    setCollections(cols)
    showToast(`Removed ${ids.length} sounds from the collection`)
  }

  // Delete: 컬렉??보기?�서???�택 ?�랙??컬렉?�에???�거. (?�이브러�?보기?�서???�제 ?�일??  // ??��?��? ?�으므�??�전?�게 ?�무 ?�작???��? ?�음)
  function handleDeleteShortcut(): void {
    if (activeCollection) {
      const ids = selectedIds.size > 0 ? [...selectedIds] : selectedTrack ? [selectedTrack.id] : []
      if (ids.length > 0) void removeTracksFromActiveCollection(ids)
    } else if (selectedCollection == null && showStarredOnly) {
      // 즐겨찾기 보기?�서 Delete = ?�택 ?�랙 즐겨찾기 ?�제
      if (selectedTrack?.starred) void handleToggleStar(selectedTrack)
    }
  }
  // F2: rename the active collection or the current library
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

      // ?�?� ?�커???�치?� 무�??�게 ?�작 ?�?�
      // Ctrl+F: main search / Ctrl+Shift+F: sub search
      if (mod && (e.key === 'f' || e.key === 'F')) {
        const el = e.shiftKey ? subSearchRef.current : searchInputRef.current
        el?.focus()
        el?.select()
        return
      }
      // Esc: ?��? + 구간 ?�택 ?�제 (?�력 중이�?블러)
      if (e.key === 'Escape') {
        playerRef.current?.stopAndClear()
        setSelectedIds((prev) => (prev.size > 0 ? new Set() : prev))
        if (inEditable) target?.blur()
        return
      }

      if (mod && (e.key === 'a' || e.key === 'A')) {
        if (inEditable) return // ?�풋 ???�스???�체 ?�택?� 기본 ?�작 ?��?
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
      // �???Ctrl/Meta 조합?� 브라?��?/OS 기본 ?�작??맡�?
      if (mod) return
      // ?�력창에???�집 중이�?(Ctrl 조합???�닌) ?�머지 ?�축?�는 ?�스???�력??방해?��? ?�도�?무시
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

  // 브레?�크?? ?�이브러리명 + ?�택 ?�더 ?�그먼트 (Home = 루트 그리??
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
        gridTemplateRows: `var(--menubar-h) var(--topbar-h) 1fr`
      }}
    >
      <MenuBar
        onAddFolder={handleOpenFolder}
        onToggleMeta={() => setShowMeta((v) => !v)}
        view={view}
        onSetView={setView}
        onShowShortcuts={() => setShowShortcuts(true)}
        onOpenPublisherSettings={() => setPublisherSettingsOpen(true)}
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
        <div className="topbar__actions">
          <AccentPicker accent={accent} onChange={setAccent} />
          <button
            className="icon-btn"
            title="Shuffle"
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
          <div className="topbar__subsearch-wrap" title="Filter results as you type">
            <svg className="topbar__subsearch-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              ref={subSearchRef}
              className="topbar__subsearch"
              placeholder="Filter sounds"
              value={subSearch}
              onChange={(e) => setSubSearch(e.target.value)}
            />
          </div>
          <button
            className={`icon-btn${showMeta ? ' icon-btn--active' : ''}`}
            title="Metadata panel"
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
            : `${sidebarWidth}px 1fr`,
          gridTemplateRows: `1fr ${playerHeight}px`
        }}
      >
        {/* ?�이?�바 ??조절 ?�들 ???�레?�어 ?�까지 ?�려가�??�레?�어 컨트�??��??�데�?            가로�?르는 것처??보이므�? 콘텐�????�쪽)까�?�??�도�??�이�??�한?�다 */}
        <div
          className="resizer resizer--left"
          style={{ left: sidebarWidth, bottom: playerHeight }}
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
            // Local ?�릭 = 최상??진입?? 모든 ?�택 ?�제 + ?�더 그리???�면?�로
            setSelectedFolder(null)
            setSelectedCollection(null)
            setShowStarredOnly(false)
            setSearch('')
            setSubSearch('')
            setView('grid')
          }}
          onCollectionContextMenu={(e, collection) => setCollectionMenu({ x: e.clientX, y: e.clientY, collection })}
          onLibraryContextMenu={(e, library) => setLibraryMenu({ x: e.clientX, y: e.clientY, library })}
          scanning={scanning}
          scanProgress={scanProgress}
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
                  ??{activeCollection.name}
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
              publisherRule={publisherRule}
              previewedIds={previewedIds}
              onCreateCollectionWith={(trackId) => {
                setNamePrompt({
                  title: 'New collection name',
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

        {showMeta && (
          <div className="right-panel" ref={rightPanelRef}>
            <div className="right-panel__meta" style={{ height: metaPanelHeight }}>
              <MetadataPanel track={selectedTrack} libraries={libraries} publisherRule={publisherRule} onToggleStar={handleToggleStar} />
            </div>
            <div className="right-panel__resizer" onMouseDown={startMetaPanelResize} />
            <AnalysisPanel playerRef={playerRef} track={selectedTrack} />
          </div>
        )}

        {/* 리스???�레?�어 경계 ?�이 조절 ?�들 ???�이?�바+콘텐�???��지�?메�?/분석 ?�널
            컬럼?� ?�아?�로 ?�뉘지 ?�는 ?�나???�역?��?�?�?경계까�????�히지 ?�음) */}
        <div
          className="resizer-h"
          style={{ bottom: playerHeight, right: showMeta ? metaWidth : 0 }}
          onMouseDown={startPlayerResize}
        />

        <PlayerBar
          ref={playerRef}
          track={selectedTrack}
          accent={accent}
          panelHeight={playerHeight}
          onPrev={() => selectRelative(-1)}
          onNext={() => selectRelative(1)}
          queueTracks={visibleTracks}
        />
      </div>

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
      {publisherSettingsOpen && (
        <PublisherSettingsModal
          value={publisherRule}
          onSave={handleSavePublisherRule}
          onCancel={() => setPublisherSettingsOpen(false)}
        />
      )}

      {toast && <Toast message={toast} />}
    </div>
  )
}







