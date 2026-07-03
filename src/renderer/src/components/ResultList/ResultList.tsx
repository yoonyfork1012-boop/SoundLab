import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { FixedSizeList, ListChildComponentProps, areEqual } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import type { Library, Track } from '@shared/types'
import { colorForCategory } from '@shared/ucsCategories'
import { ALL_COLUMNS, DEFAULT_VISIBLE, type ColumnDef } from './columns'
import ColumnMenu from './ColumnMenu'

interface ResultListProps {
  tracks: Track[]
  library: Library | null
  selectedTrackId: number | null
  onSelectTrack: (track: Track) => void
}

const ROW_HEIGHT = 30
const SCROLLBAR_GUARD = 14

interface RowData {
  tracks: Track[]
  selectedTrackId: number | null
  columns: ColumnDef[]
  gridTemplate: string
  library: Library | null
}

function SpeakerIcon({ color }: { color: string }): JSX.Element {
  return (
    <svg className="list-row__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 8a5 5 0 0 1 0 8" />
    </svg>
  )
}

const Row = memo(({ index, style, data }: ListChildComponentProps<RowData>): JSX.Element => {
  const { tracks, selectedTrackId, columns, gridTemplate, library } = data
  const track = tracks[index]
  const isSelected = track.id === selectedTrackId
  const isPreviewed = track.lastPlayedAt != null
  const color = colorForCategory(track.category)

  return (
    <div
      style={{ ...style, gridTemplateColumns: gridTemplate }}
      className={`list-row${isSelected ? ' list-row--selected' : ''}${isPreviewed ? ' list-row--previewed' : ''}`}
      draggable
      onDragStart={(e) => {
        // 선택 여부와 무관하게 어떤 행이든 즉시 OS 네이티브 드래그(DAW/탐색기로 드롭)
        e.preventDefault()
        window.api?.startDrag(track.filePath)
      }}
    >
      {columns.map((col) => {
        if (col.key === 'name') {
          return (
            <div className="list-row__cell list-row__name" key={col.key}>
              <SpeakerIcon color={color} />
              <span className="list-row__filename" title={track.filePath}>
                {track.filename}
              </span>
            </div>
          )
        }
        if (col.key === 'category') {
          return (
            <div className="list-row__cell" key={col.key}>
              {track.category && (
                <span className="list-row__cat-pill" style={{ color, borderColor: color }}>
                  {track.category}
                </span>
              )}
            </div>
          )
        }
        return (
          <div
            className={`list-row__cell${col.key !== 'name' ? ' list-row__cell--sub' : ''}`}
            style={col.align === 'right' ? { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } : undefined}
            key={col.key}
          >
            {col.value(track, { library })}
          </div>
        )
      })}
    </div>
  )
}, areEqual)
Row.displayName = 'Row'

export default function ResultList({
  tracks,
  library,
  selectedTrackId,
  onSelectTrack
}: ResultListProps): JSX.Element {
  const listRef = useRef<FixedSizeList>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const hoverBoxRef = useRef<HTMLDivElement>(null)
  const scrollOffsetRef = useRef(0)
  const mouseYRef = useRef<number | null>(null)
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks

  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(DEFAULT_VISIBLE))
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const columns = useMemo(
    () => ALL_COLUMNS.filter((c) => visibleCols.has(c.key)),
    [visibleCols]
  )
  const gridTemplate = useMemo(() => columns.map((c) => c.width).join(' '), [columns])

  useEffect(() => {
    if (selectedTrackId == null) return
    const idx = tracks.findIndex((t) => t.id === selectedTrackId)
    if (idx >= 0) listRef.current?.scrollToItem(idx, 'smart')
  }, [selectedTrackId, tracks])

  function indexAtY(clientY: number): number {
    const wrap = wrapRef.current
    if (!wrap) return -1
    const rect = wrap.getBoundingClientRect()
    const idx = Math.floor((clientY - rect.top + scrollOffsetRef.current) / ROW_HEIGHT)
    return idx >= 0 && idx < tracksRef.current.length ? idx : -1
  }

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

  useEffect(() => {
    updateHoverBox()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks])

  function toggleColumn(key: string): void {
    setVisibleCols((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        if (key === 'name') return next // Name은 항상 유지
        next.delete(key)
      } else next.add(key)
      return next
    })
  }

  const itemData: RowData = { tracks, selectedTrackId, columns, gridTemplate, library }

  return (
    <div className="content">
      <div
        className="list-header"
        style={{ gridTemplateColumns: gridTemplate }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {columns.map((col) => (
          <div key={col.key} style={col.align === 'right' ? { textAlign: 'right' } : undefined}>
            {col.label}
          </div>
        ))}
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
            if (e.button !== 0) return
            const rect = wrapRef.current!.getBoundingClientRect()
            if (rect.right - e.clientX < SCROLLBAR_GUARD) return
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

      {menu && (
        <ColumnMenu
          x={menu.x}
          y={menu.y}
          visible={visibleCols}
          onToggle={toggleColumn}
          onShuffle={() => {}}
          onAutoResize={() => {}}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
