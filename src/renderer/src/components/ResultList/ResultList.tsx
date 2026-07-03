import { FixedSizeList, ListChildComponentProps } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import type { Track } from '@shared/types'
import { colorForCategory } from '@shared/ucsCategories'

interface ResultListProps {
  tracks: Track[]
  selectedTrackId: number | null
  onSelectTrack: (track: Track) => void
  onToggleStar: (track: Track) => void
}

const ROW_HEIGHT = 28

function formatDuration(ms: number | null): string {
  if (ms === null) return '--:--'
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatSpec(track: Track): string {
  if (!track.sampleRate) return '-'
  const khz = (track.sampleRate / 1000).toFixed(1)
  return track.bitDepth ? `${khz}kHz/${track.bitDepth}bit` : `${khz}kHz`
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

    return (
      <div
        style={style}
        className={`list-row${isSelected ? ' list-row--selected' : ''}`}
        onClick={() => onSelectTrack(track)}
        onDoubleClick={() => onSelectTrack(track)}
      >
        <div className="list-row__name">
          <span
            className="list-row__category-dot"
            style={{ background: colorForCategory(track.category) }}
          />
          <span
            className={`list-row__star${track.starred ? ' list-row__star--starred' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggleStar(track)
            }}
          >
            {track.starred ? '★' : '☆'}
          </span>
          <span title={track.filePath}>{track.filename}</span>
        </div>
        <div>{formatDuration(track.durationMs)}</div>
        <div>{track.category ?? '-'}</div>
        <div>{formatSpec(track)}</div>
      </div>
    )
  }

  return (
    <div className="content">
      <div className="list-header">
        <div>Name</div>
        <div>Dur</div>
        <div>Category</div>
        <div>SR/Bit</div>
      </div>
      {tracks.length === 0 ? (
        <div className="empty-state">
          <div>표시할 사운드가 없습니다.</div>
          <div>좌측에서 폴더를 추가해 라이브러리를 스캔하세요.</div>
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
