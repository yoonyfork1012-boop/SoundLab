import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { FixedSizeList, ListChildComponentProps, areEqual } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import type { Collection, Library, Track } from '@shared/types'
import { colorForCategory } from '@shared/ucsCategories'
import { ALL_COLUMNS, DEFAULT_VISIBLE, type ColumnDef } from './columns'
import { loadJSON, saveJSON } from '../../lib/uiState'
import ColumnMenu from './ColumnMenu'

interface ResultListProps {
  tracks: Track[]
  libraries: Library[]
  collections: Collection[]
  selectedTrackId: number | null
  selectedIds?: Set<number>
  onSelectTrack: (track: Track) => void
  onToggleStar: (track: Track) => void
  onAddToCollection: (collectionId: number, trackId: number) => void
  onCreateCollectionWith: (trackId: number) => void
  sortKey: string | null
  sortDir: 'asc' | 'desc'
  onSort: (key: string) => void
}

const ROW_HEIGHT = 30
const SCROLLBAR_GUARD = 14
const MIN_COL_WIDTH = 48
const COL_WIDTHS_KEY = 'soundlib.columnWidths'

interface RowData {
  tracks: Track[]
  selectedTrackId: number | null
  selectedIds?: Set<number>
  columns: ColumnDef[]
  gridTemplate: string
  totalWidth: number
  libraries: Library[]
}

function SpeakerIcon({ color }: { color: string }): JSX.Element {
  return (
    <svg className="list-row__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 8a5 5 0 0 1 0 8" />
    </svg>
  )
}

// Duration / Format / Channels 헤더용 아이콘 (텍스트 대신 표시, title로 툴팁 제공)
function IconDuration(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}
function IconFormat(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h2l2-6 3 12 2.5-9L14 15l2-6h5" />
    </svg>
  )
}
function IconChannels(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="6" height="16" rx="1.5" />
      <rect x="14" y="4" width="6" height="16" rx="1.5" />
    </svg>
  )
}
const HEADER_ICONS: Record<string, () => JSX.Element> = {
  duration: IconDuration,
  format: IconFormat,
  channels: IconChannels
}

const Row = memo(({ index, style, data }: ListChildComponentProps<RowData>): JSX.Element => {
  const { tracks, selectedTrackId, selectedIds, columns, gridTemplate, totalWidth, libraries } = data
  const track = tracks[index]
  const isSelected = track.id === selectedTrackId || (selectedIds?.has(track.id) ?? false)
  const isPreviewed = track.lastPlayedAt != null
  const color = colorForCategory(track.category)

  return (
    <div
      style={{ ...style, gridTemplateColumns: gridTemplate, width: totalWidth }}
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
                <span className="list-row__cat-pill" style={{ color }}>
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
            {col.value(track, { libraries })}
          </div>
        )
      })}
    </div>
  )
}, areEqual)
Row.displayName = 'Row'

export default function ResultList({
  tracks,
  libraries,
  collections,
  selectedTrackId,
  selectedIds,
  onSelectTrack,
  onToggleStar,
  onAddToCollection,
  onCreateCollectionWith,
  sortKey,
  sortDir,
  onSort
}: ResultListProps): JSX.Element {
  const listRef = useRef<FixedSizeList>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const hoverBoxRef = useRef<HTMLDivElement>(null)
  const scrollOffsetRef = useRef(0)
  const mouseYRef = useRef<number | null>(null)
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks

  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(DEFAULT_VISIBLE))
  // 컬럼별 고정 px 폭 — 하나를 늘려도 다른 컬럼에 영향 없이 독립적으로 리사이즈됨
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => loadJSON(COL_WIDTHS_KEY, {}))
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; track: Track } | null>(null)

  useEffect(() => {
    if (!rowMenu) return
    const close = (): void => setRowMenu(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [rowMenu])

  const columns = useMemo(
    () => ALL_COLUMNS.filter((c) => visibleCols.has(c.key)),
    [visibleCols]
  )
  function widthOf(col: ColumnDef): number {
    return colWidths[col.key] ?? col.defaultWidth
  }
  const gridTemplate = useMemo(
    () => columns.map((c) => `${widthOf(c)}px`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, colWidths]
  )
  const totalWidth = useMemo(
    () => columns.reduce((sum, c) => sum + widthOf(c), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, colWidths]
  )

  // 헤더 경계 드래그로 컬럼 폭 조절 — 컬럼마다 독립된 고정 px이므로 다른 컬럼에 영향 없음
  function startResize(e: React.MouseEvent, key: string): void {
    e.preventDefault()
    e.stopPropagation()
    const col = ALL_COLUMNS.find((c) => c.key === key)
    const startWidth = colWidths[key] ?? col?.defaultWidth ?? 100
    const startX = e.clientX
    let latest = startWidth
    function onMove(ev: MouseEvent): void {
      latest = Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX))
      setColWidths((prev) => ({ ...prev, [key]: latest }))
    }
    function onUp(): void {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      setColWidths((prev) => {
        saveJSON(COL_WIDTHS_KEY, prev)
        return prev
      })
    }
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

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

  function autoResizeColumns(): void {
    setColWidths({})
    saveJSON(COL_WIDTHS_KEY, {})
  }

  const itemData: RowData = { tracks, selectedTrackId, selectedIds, columns, gridTemplate, totalWidth, libraries }

  return (
    <div className="content">
      {tracks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__big">표시할 사운드가 없습니다</div>
          <div>좌측에서 폴더를 추가하거나 다른 폴더를 선택하세요</div>
        </div>
      ) : (
        <div className="list-scroll">
          <div className="list-scroll__inner" style={{ width: totalWidth }}>
            <div
              className="list-header"
              style={{ gridTemplateColumns: gridTemplate }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY })
              }}
            >
              {columns.map((col) => {
                const Icon = col.icon ? HEADER_ICONS[col.key] : null
                const isSorted = sortKey === col.key
                return (
                  <div
                    key={col.key}
                    className="list-header__cell"
                    style={col.align === 'right' ? { justifyContent: 'flex-end' } : undefined}
                  >
                    <span
                      className="list-header__label"
                      title={Icon ? col.label : undefined}
                      onClick={() => onSort(col.key)}
                    >
                      {Icon ? <Icon /> : col.label}
                      {isSorted && <span className="list-header__sort">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </span>
                    <span
                      className="list-header__resize"
                      title="드래그로 폭 조절"
                      onMouseDown={(e) => startResize(e, col.key)}
                      onContextMenu={(e) => e.stopPropagation()}
                    />
                  </div>
                )
              })}
            </div>

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
              onContextMenu={(e) => {
                const idx = indexAtY(e.clientY)
                if (idx < 0) return
                e.preventDefault()
                onSelectTrack(tracksRef.current[idx])
                setRowMenu({ x: e.clientX, y: e.clientY, track: tracksRef.current[idx] })
              }}
            >
              <div
                ref={hoverBoxRef}
                className="list-hoverbox"
                style={{ height: ROW_HEIGHT, width: totalWidth, display: 'none' }}
              />
              <AutoSizer disableWidth>
                {({ height }: { height: number }) => (
                  <FixedSizeList
                    ref={listRef}
                    height={height}
                    width={totalWidth}
                    itemCount={tracks.length}
                    itemSize={ROW_HEIGHT}
                    itemData={itemData}
                    itemKey={(index, data) => data.tracks[index].id}
                    overscanCount={12}
                    style={{ overflowX: 'hidden' }}
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
          </div>
        </div>
      )}

      {menu && (
        <ColumnMenu
          x={menu.x}
          y={menu.y}
          visible={visibleCols}
          onToggle={toggleColumn}
          onShuffle={() => {}}
          onAutoResize={autoResizeColumns}
          onClose={() => setMenu(null)}
        />
      )}

      {rowMenu && (
        <div
          className="colmenu"
          style={{ left: Math.min(rowMenu.x, window.innerWidth - 230), top: Math.min(rowMenu.y, window.innerHeight - 300) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="colmenu__item"
            onClick={() => {
              onToggleStar(rowMenu.track)
              setRowMenu(null)
            }}
          >
            <span className="colmenu__check">{rowMenu.track.starred ? '★' : '☆'}</span>
            <span>{rowMenu.track.starred ? '즐겨찾기 해제' : '즐겨찾기'}</span>
          </button>
          <div className="colmenu__sep" />
          <div className="colmenu__section">컬렉션에 추가</div>
          <div className="colmenu__scroll">
            {collections.map((col) => (
              <button
                key={col.id}
                className="colmenu__item"
                onClick={() => {
                  onAddToCollection(col.id, rowMenu.track.id)
                  setRowMenu(null)
                }}
              >
                <span className="colmenu__check" />
                <span>{col.name}</span>
              </button>
            ))}
          </div>
          <button
            className="colmenu__item"
            onClick={() => {
              onCreateCollectionWith(rowMenu.track.id)
              setRowMenu(null)
            }}
          >
            <span className="colmenu__check">＋</span>
            <span>새 컬렉션…</span>
          </button>
        </div>
      )}
    </div>
  )
}
