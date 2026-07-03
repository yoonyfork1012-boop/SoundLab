import { FixedSizeList, ListChildComponentProps } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import type { Track } from '@shared/types'
import { colorForCategory } from '@shared/ucsCategories'
import MiniWaveform from '../MiniWaveform/MiniWaveform'

interface ResultListProps {
  tracks: Track[]
  selectedTrackId: number | null
  onSelectTrack: (track: Track) => void
  onToggleStar: (track: Track) => void
}

const ROW_HEIGHT = 34

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatSpec(track: Track): string {
  if (!track.sampleRate) return '—'
  const khz = (track.sampleRate / 1000).toFixed(1)
  return track.bitDepth ? `${khz}k · ${track.bitDepth}b` : `${khz}k`
}

export default function ResultList({
  tracks,
  selectedTrackId,
  onSelectTrack,
  onToggleStar
}: ResultListProps): JSX.Element {
  function Row({ index, style }: ListChildComponentProps): JSX.Element {
    const track = tracks[index]
    const isSelected = track.id === selectedTrackId
    const color = colorForCategory(track.category)

    return (
      <div
        style={style}
        className={`list-row${isSelected ? ' list-row--selected' : ''}`}
        onClick={() => onSelectTrack(track)}
      >
        <div
          className={`list-row__star${track.starred ? ' list-row__star--on' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleStar(track)
          }}
        >
          {track.starred ? '★' : '☆'}
        </div>
        <div className="list-row__name">
          <span className="list-row__cat-dot" style={{ background: color }} />
          <span className="list-row__filename" title={track.filePath}>
            {track.filename}
          </span>
        </div>
        <div className="list-row__wave">
          <MiniWaveform
            seed={track.filename}
            color={isSelected ? color : '#5a616b'}
            bars={38}
            width={128}
            height={20}
          />
        </div>
        <div className="list-row__cell" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {formatDuration(track.durationMs)}
        </div>
        <div className="list-row__cell">
          {track.category && (
            <span className="list-row__cat-pill" style={{ background: color }}>
              {track.category}
            </span>
          )}
        </div>
        <div className="list-row__cell" style={{ color: 'var(--text-faint)' }}>
          {formatSpec(track)}
        </div>
      </div>
    )
  }

  return (
    <div className="content">
      <div className="list-toolbar">
        <span>{tracks.length.toLocaleString()} sounds</span>
      </div>
      <div className="list-header">
        <div />
        <div>Name</div>
        <div>Waveform</div>
        <div style={{ textAlign: 'right' }}>Dur</div>
        <div>Category</div>
        <div>SR/Bit</div>
      </div>
      {tracks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__big">표시할 사운드가 없습니다</div>
          <div>좌측에서 폴더를 추가해 라이브러리를 스캔하세요</div>
        </div>
      ) : (
        <div style={{ flex: 1 }}>
          <AutoSizer>
            {({ height, width }: { height: number; width: number }) => (
              <FixedSizeList
                height={height}
                width={width}
                itemCount={tracks.length}
                itemSize={ROW_HEIGHT}
              >
                {Row}
              </FixedSizeList>
            )}
          </AutoSizer>
        </div>
      )}
    </div>
  )
}
