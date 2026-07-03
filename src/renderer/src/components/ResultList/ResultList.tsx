import { memo, useEffect, useRef } from 'react'
import { FixedSizeList, ListChildComponentProps, areEqual } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import type { Track } from '@shared/types'
import { colorForCategory } from '@shared/ucsCategories'

interface ResultListProps {
  tracks: Track[]
  selectedTrackId: number | null
  onSelectTrack: (track: Track) => void
  onToggleStar: (track: Track) => void
}

const ROW_HEIGHT = 30

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
  return track.bitDepth ? `${khz}k · ${track.bitDepth}bit` : `${khz}k`
}

interface RowData {
  tracks: Track[]
  selectedTrackId: number | null
  onSelectTrack: (track: Track) => void
  onToggleStar: (track: Track) => void
}

// itemData로 데이터를 주입 + memo(areEqual)로 안정적인 Row 컴포넌트.
// (Row를 부모 렌더 함수 안에 정의하면 선택 변경마다 리스트 전체가 리마운트되어
//  클릭이 씹히던 문제가 있었음 → 밖으로 분리)
const Row = memo(({ index, style, data }: ListChildComponentProps<RowData>): JSX.Element => {
  const { tracks, selectedTrackId, onSelectTrack, onToggleStar } = data
  const track = tracks[index]
  const isSelected = track.id === selectedTrackId
  const color = colorForCategory(track.category)

  return (
    <div
      style={style}
      className={`list-row${isSelected ? ' list-row--selected' : ''}`}
      onMouseDown={() => onSelectTrack(track)}
    >
      <div
        className={`list-row__star${track.starred ? ' list-row__star--on' : ''}`}
        onMouseDown={(e) => {
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
      <div className="list-row__cell">
        {track.category && (
          <span className="list-row__cat-pill" style={{ color, borderColor: color }}>
            {track.category}
          </span>
        )}
      </div>
      <div className="list-row__cell list-row__cell--sub">{track.subcategory ?? '—'}</div>
      <div className="list-row__cell" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {formatDuration(track.durationMs)}
      </div>
      <div className="list-row__cell list-row__cell--sub" style={{ textAlign: 'right' }}>
        {formatSpec(track)}
      </div>
    </div>
  )
}, areEqual)
Row.displayName = 'Row'

export default function ResultList({
  tracks,
  selectedTrackId,
  onSelectTrack,
  onToggleStar
}: ResultListProps): JSX.Element {
  const listRef = useRef<FixedSizeList>(null)

  useEffect(() => {
    if (selectedTrackId == null) return
    const idx = tracks.findIndex((t) => t.id === selectedTrackId)
    if (idx >= 0) listRef.current?.scrollToItem(idx, 'smart')
  }, [selectedTrackId, tracks])

  const itemData: RowData = { tracks, selectedTrackId, onSelectTrack, onToggleStar }

  return (
    <div className="content">
      <div className="list-header">
        <div />
        <div>Name</div>
        <div>Category</div>
        <div>Subcategory</div>
        <div style={{ textAlign: 'right' }}>Dur</div>
        <div style={{ textAlign: 'right' }}>SR/Bit</div>
      </div>
      {tracks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__big">표시할 사운드가 없습니다</div>
          <div>좌측에서 폴더를 추가하거나 다른 폴더를 선택하세요</div>
        </div>
      ) : (
        <div style={{ flex: 1 }}>
          <AutoSizer>
            {({ height, width }: { height: number; width: number }) => (
              <FixedSizeList
                ref={listRef}
                height={height}
                width={width}
                itemCount={tracks.length}
                itemSize={ROW_HEIGHT}
                itemData={itemData}
                itemKey={(index, data) => data.tracks[index].id}
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
