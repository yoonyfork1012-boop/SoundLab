import { useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar/Sidebar'
import ResultList from './components/ResultList/ResultList'
import PlayerBar from './components/PlayerBar/PlayerBar'
import MetadataPanel from './components/MetadataPanel/MetadataPanel'
import type { Library, Track } from '@shared/types'
import { isBrowserPreview, mockLibrary, mockTracks } from './mockData'

export default function App(): JSX.Element {
  const [library, setLibrary] = useState<Library | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)
  const [search, setSearch] = useState('')
  const [scanning, setScanning] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showStarredOnly, setShowStarredOnly] = useState(false)
  const [showMeta, setShowMeta] = useState(true)

  // 브라우저 프리뷰에서는 목업 데이터로 채워 UI를 확인할 수 있게 함
  useEffect(() => {
    if (isBrowserPreview) {
      setLibrary(mockLibrary)
      setTracks(mockTracks)
      setSelectedTrack(mockTracks[0] ?? null)
    }
  }, [])

  async function handleOpenFolder(): Promise<void> {
    if (!window.api) return
    const folder = await window.api.selectFolder()
    if (!folder) return

    setScanning(true)
    try {
      const { library: scannedLibrary, tracks: scannedTracks } =
        await window.api.scanLibrary(folder)
      setLibrary(scannedLibrary)
      setTracks(scannedTracks)
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
    if (window.api) await window.api.updateLastPlayed(track.id)
  }

  const filteredTracks = useMemo(() => {
    let result = tracks
    if (showStarredOnly) result = result.filter((t) => t.starred)
    if (activeCategory) result = result.filter((t) => t.category === activeCategory)
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (t) =>
          t.filename.toLowerCase().includes(q) ||
          (t.category ?? '').toLowerCase().includes(q) ||
          (t.description ?? '').toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      )
    }
    return result
  }, [tracks, search, activeCategory, showStarredOnly])

  // 방향키로 이전/다음 사운드 선택·재생 (↑/← 이전, ↓/→ 다음)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const isNext = e.key === 'ArrowDown' || e.key === 'ArrowRight'
      const isPrev = e.key === 'ArrowUp' || e.key === 'ArrowLeft'
      if (!isNext && !isPrev) return
      if (filteredTracks.length === 0) return

      e.preventDefault()
      const currentIdx = filteredTracks.findIndex((t) => t.id === selectedTrack?.id)
      let nextIdx: number
      if (currentIdx === -1) {
        nextIdx = 0
      } else {
        nextIdx = currentIdx + (isNext ? 1 : -1)
        nextIdx = Math.max(0, Math.min(filteredTracks.length - 1, nextIdx))
      }
      if (nextIdx !== currentIdx || currentIdx === -1) {
        void handleSelectTrack(filteredTracks[nextIdx])
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [filteredTracks, selectedTrack])

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar__brand">
          <span className="topbar__brand-dot" />
          SoundLib
        </div>
        <div className="topbar__search-wrap">
          <svg className="topbar__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            className="topbar__search"
            placeholder="사운드 검색 — 파일명, 카테고리, 태그"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="topbar__actions">
          <button className="btn btn--accent" onClick={handleOpenFolder} disabled={scanning}>
            {scanning ? '스캔 중…' : '폴더 추가'}
          </button>
          <button
            className={`icon-btn${showMeta ? ' icon-btn--active' : ''}`}
            title="메타데이터 패널"
            onClick={() => setShowMeta((v) => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          onOpenFolder={handleOpenFolder}
          activeCategory={activeCategory}
          onSelectCategory={setActiveCategory}
          showStarredOnly={showStarredOnly}
          onToggleStarredView={() => setShowStarredOnly((v) => !v)}
        />
        <ResultList
          tracks={filteredTracks}
          selectedTrackId={selectedTrack?.id ?? null}
          onSelectTrack={handleSelectTrack}
          onToggleStar={handleToggleStar}
        />
        {showMeta && <MetadataPanel track={selectedTrack} onToggleStar={handleToggleStar} />}
      </div>

      <PlayerBar track={selectedTrack} />
    </div>
  )
}
