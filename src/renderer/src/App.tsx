import { useMemo, useState } from 'react'
import Sidebar from './components/Sidebar/Sidebar'
import ResultList from './components/ResultList/ResultList'
import PlayerBar from './components/PlayerBar/PlayerBar'
import type { Library, Track } from '@shared/types'

export default function App(): JSX.Element {
  const [library, setLibrary] = useState<Library | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)
  const [search, setSearch] = useState('')
  const [scanning, setScanning] = useState(false)

  async function handleOpenFolder(): Promise<void> {
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
    const starred = await window.api.toggleStar(track.id)
    setTracks((prev) => prev.map((t) => (t.id === track.id ? { ...t, starred } : t)))
  }

  async function handleSelectTrack(track: Track): Promise<void> {
    setSelectedTrack(track)
    await window.api.updateLastPlayed(track.id)
  }

  const filteredTracks = useMemo(() => {
    if (!search.trim()) return tracks
    const q = search.toLowerCase()
    return tracks.filter(
      (t) =>
        t.filename.toLowerCase().includes(q) ||
        (t.category ?? '').toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
    )
  }, [tracks, search])

  return (
    <div className="app">
      <div className="topbar">
        <input
          className="topbar__search"
          placeholder="파일명, 태그, 카테고리 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn btn--accent" onClick={handleOpenFolder} disabled={scanning}>
          {scanning ? '스캔 중...' : '+ 폴더 추가'}
        </button>
      </div>

      <div className="main">
        <Sidebar library={library} onOpenFolder={handleOpenFolder} trackCount={tracks.length} />
        <ResultList
          tracks={filteredTracks}
          selectedTrackId={selectedTrack?.id ?? null}
          onSelectTrack={handleSelectTrack}
          onToggleStar={handleToggleStar}
        />
      </div>

      <PlayerBar track={selectedTrack} />
    </div>
  )
}
