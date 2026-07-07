import { useEffect, useState } from 'react'
import type { Track } from '@shared/types'
import { colorForCategory } from '@shared/ucsCategories'

interface MetadataPanelProps {
  track: Track | null
  onToggleStar: (track: Track) => void
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function MetadataPanel({ track, onToggleStar }: MetadataPanelProps): JSX.Element {
  // 커버 아트워크: 트랙 선택 시 임베디드 우선 → 폴더 커버 순으로 비동기 로드
  const [artwork, setArtwork] = useState<{ url: string; source: string } | null>(null)
  useEffect(() => {
    setArtwork(null)
    if (!track || !window.api?.getTrackArtwork) return
    let cancelled = false
    void window.api.getTrackArtwork(track.filePath, track.artworkPath).then((res) => {
      if (!cancelled) setArtwork(res)
    })
    return () => {
      cancelled = true
    }
  }, [track?.id, track?.filePath, track?.artworkPath])

  if (!track) {
    return (
      <aside className="meta">
        <div className="meta__empty">사운드를 선택하면
          <br />여기에 정보가 표시됩니다</div>
      </aside>
    )
  }

  const color = colorForCategory(track.category)

  return (
    <aside className="meta">
      <div
        className="meta__artwork"
        style={
          artwork
            ? undefined
            : { background: `linear-gradient(150deg, ${color}44, ${color}12)` }
        }
      >
        {artwork ? (
          <img className="meta__artwork-img" src={artwork.url} alt="" />
        ) : (
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.9">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        )}
        {artwork && <span className="meta__artwork-badge">{artwork.source}</span>}
      </div>

      <div className="meta__title-row">
        <div className="meta__title">{track.filename}</div>
        <span
          className={`meta__star${track.starred ? ' meta__star--on' : ''}`}
          onClick={() => onToggleStar(track)}
          title="즐겨찾기 (F)"
        >
          {track.starred ? '★' : '☆'}
        </span>
      </div>

      {track.description && <div className="meta__desc">{track.description}</div>}

      <div className="meta__grid">
        <span className="meta__key">Category</span>
        <span className="meta__val">{track.category ?? '—'}</span>
        <span className="meta__key">Subcategory</span>
        <span className="meta__val">{track.subcategory ?? '—'}</span>
        <span className="meta__key">Duration</span>
        <span className="meta__val">{formatDuration(track.durationMs)}</span>
        <span className="meta__key">Sample Rate</span>
        <span className="meta__val">
          {track.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)} kHz` : '—'}
        </span>
        <span className="meta__key">Bit Depth</span>
        <span className="meta__val">{track.bitDepth ? `${track.bitDepth} bit` : '—'}</span>
        <span className="meta__key">Channels</span>
        <span className="meta__val">
          {track.channels ? (track.channels === 1 ? 'Mono' : track.channels === 2 ? 'Stereo' : `${track.channels}ch`) : '—'}
        </span>
      </div>

      {track.tags.length > 0 && (
        <>
          <div className="meta__section-label">Tags</div>
          <div className="meta__tags">
            {track.tags.map((tag) => (
              <span className="meta__tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
