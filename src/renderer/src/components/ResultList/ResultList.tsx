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
const SCROLLBAR_GUARD = 14 // 우측 스크롤바 클릭 오차 방지 px

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
  onToggleStar: (track: Track) => void
}

// 선택/hover는 좌표 기반(래퍼에서 처리)이라 Row 자체는 표시만 담당.
// memo(areEqual)로 스크롤 중 불필요한 리렌더 방지.
const Row = memo(({ index, style, data }: ListChildComponentProps<RowData>): JSX.Element => {
  const { tracks, selectedTrackId, onToggleStar } = data
  const track = tracks[index]
  const isSelected = track.id === selectedTrackId
  const isPreviewed = track.lastPlayedAt != null
  const color = colorForCategory(track.category)

  return (
    <div
      style={style}
      className={`list-row${isSelected ? ' list-row--selected' : ''}${isPreviewed ? ' list-row--previewed' : ''}`}
      draggable
      onDragStart={(e) => {
        // 선택 여부와 무관하게 어떤 행이든 즉시 OS 네이티브 드래그 (Soundly 방식)
        e.preventDefault()
        window.api?.startDrag(track.filePath)
      }}
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
  const wrapRef = useRef<HTMLDivElement>(null)
  const hoverBoxRef = useRef<HTMLDivElement>(null)
  const scrollOffsetRef = useRef(0)
  const mouseYRef = useRef<number | null>(null)
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks

  useEffect(() => {
    if (selectedTrackId == null) return
    const idx = tracks.findIndex((t) => t.id === selectedTrackId)
    if (idx >= 0) listRef.current?.scrollToItem(idx, 'smart')
  }, [selectedTrackId, tracks])

  /** 현재 마우스 Y좌표 + 스크롤 오프셋 → 트랙 인덱스 */
  function indexAtY(clientY: number): number {
    const wrap = wrapRef.current
    if (!wrap) return -1
    const rect = wrap.getBoundingClientRect()
    const idx = Math.floor((clientY - rect.top + scrollOffsetRef.current) / ROW_HEIGHT)
    return idx >= 0 && idx < tracksRef.current.length ? idx : -1
  }

  /** Soundly처럼 휠 스크롤 중에도 hover 박스가 커서 아래 행을 계속 따라감 */
  function updateHoverBox(): void {
    const box = hoverBoxRef.current
    if (!box) return
    const y = mouseYRef.current
    const idx = y == null ? -1 : indexAtY(y)
    if (idx < 0) {
      box.style.display = 'none'
      return
    }
    box.style.display = 'block'
    box.style.top = `${idx * ROW_HEIGHT - scrollOffsetRef.current}px`
  }

  // 필터 변경 등으로 목록이 바뀌면 hover 박스 재계산
  useEffect(() => {
    updateHoverBox()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks])

  const itemData: RowData = { tracks, selectedTrackId, onToggleStar }

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
        <div
          ref={wrapRef}
          style={{ flex: 1, position: 'relative' }}
          onMouseDown={(e) => {
            // 좌표 기반 선택: 빠른 휠 스크롤 직후/도중에도 클릭이 100% 등록됨
            if (e.button !== 0) return
            const rect = wrapRef.current!.getBoundingClientRect()
            if (rect.right - e.clientX < SCROLLBAR_GUARD) return // 스크롤바 클릭 제외
            const idx = indexAtY(e.clientY)
            if (idx >= 0) onSelectTrack(tracksRef.current[idx])
          }}
          onMouseMove={(e) => {
            mouseYRef.current = e.clientY
            updateHoverBox()
          }}
          onMouseLeave={() => {
            mouseYRef.current = null
            updateHoverBox()
          }}
        >
          <div
            ref={hoverBoxRef}
            className="list-hoverbox"
            style={{ height: ROW_HEIGHT, display: 'none' }}
          />
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
                overscanCount={12}
                onScroll={({ scrollOffset }) => {
                  scrollOffsetRef.current = scrollOffset
                  updateHoverBox()
                }}
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
