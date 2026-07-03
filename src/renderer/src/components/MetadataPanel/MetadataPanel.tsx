import type { Track } from '@shared/types'
import { colorForCategory } from '@shared/ucsCategories'
import MiniWaveform from '../MiniWaveform/MiniWaveform'

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
        style={{ background: `linear-gradient(150deg, ${color}33, ${color}14)` }}
      >
        <div className="meta__artwork-wave">
          <MiniWaveform seed={track.filename} color={color} bars={44} width={200} height={120} />
        </div>
        {track.artworkSource && (
          <span className="meta__artwork-badge">{track.artworkSource}</span>
        )}
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
