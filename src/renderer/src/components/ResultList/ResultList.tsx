import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FixedSizeList, ListChildComponentProps, areEqual } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import type { Collection, Library, PublisherRule, Track } from "@shared/types";
import { colorForCategory } from "@shared/ucsCategories";
import { ALL_COLUMNS, DEFAULT_VISIBLE, type ColumnDef } from "./columns";
import { loadJSON, saveJSON } from "../../lib/uiState";
import ColumnMenu from "./ColumnMenu";

interface ResultListProps {
  tracks: Track[];
  libraries: Library[];
  collections: Collection[];
  selectedTrackId: number | null;
  selectedIds?: Set<number>;
  onSelectTrack: (track: Track) => void;
  onToggleStar: (track: Track) => void;
  onAddToCollection: (collectionId: number, trackId: number) => void;
  onCreateCollectionWith: (trackId: number) => void;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  publisherRule: PublisherRule;
  previewedIds: Set<number>;
  reorderable?: boolean;
  onReorder?: (orderedTrackIds: number[]) => void;
  onBrowseFolder?: (track: Track) => void;
  onRenameTrack?: (track: Track) => void;
  onOpenMetadataPanel?: () => void;
  onRemoveTrack?: (track: Track) => void;
  onNotify?: (message: string) => void;
}

const SCROLLBAR_GUARD = 14;
const MIN_COL_WIDTH = 48;
const COL_WIDTHS_KEY = "soundlib.columnWidths";
const COL_ORDER_KEY = "soundlib.columnOrder";
const FONT_SIZE_KEY = "soundlib.listFontSize";

const FONT_SIZE_OPTIONS = [
  { key: "small", label: "Small", rowHeight: 26, fontSize: 11 },
  { key: "medium", label: "Medium", rowHeight: 32, fontSize: 12.5 },
  { key: "large", label: "Large", rowHeight: 40, fontSize: 14.5 },
] as const;
type FontSizeKey = (typeof FONT_SIZE_OPTIONS)[number]["key"];

interface RowData {
  tracks: Track[];
  selectedTrackId: number | null;
  selectedIds?: Set<number>;
  columns: ColumnDef[];
  gridTemplate: string;
  totalWidth: number;
  libraries: Library[];
  publisherRule: PublisherRule;
  previewedIds: Set<number>;
  reorderable: boolean;
  dragOverId: number | null;
  onReorderStart: (id: number) => void;
  onReorderOver: (id: number) => void;
  onReorderDrop: () => void;
  onReorderCancel: () => void;
}

function GripIcon(): JSX.Element {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
      <circle cx="2.5" cy="2.5" r="1.3" />
      <circle cx="7.5" cy="2.5" r="1.3" />
      <circle cx="2.5" cy="7" r="1.3" />
      <circle cx="7.5" cy="7" r="1.3" />
      <circle cx="2.5" cy="11.5" r="1.3" />
      <circle cx="7.5" cy="11.5" r="1.3" />
    </svg>
  );
}

function SpeakerIcon({ color }: { color: string }): JSX.Element {
  return (
    <svg
      className="list-row__icon"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 8a5 5 0 0 1 0 8" />
    </svg>
  );
}

// Duration / Format / Channels ?�더???�이�?(?�스???�???�시, title�??�팁 ?�공)
function IconDuration(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}
function IconFormat(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12h2l2-6 3 12 2.5-9L14 15l2-6h5" />
    </svg>
  );
}
function IconChannels(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="6" height="16" rx="1.5" />
      <rect x="14" y="4" width="6" height="16" rx="1.5" />
    </svg>
  );
}
const HEADER_ICONS: Record<string, () => JSX.Element> = {
  duration: IconDuration,
  format: IconFormat,
  channels: IconChannels,
};

const Row = memo(
  ({ index, style, data }: ListChildComponentProps<RowData>): JSX.Element => {
    const {
      tracks,
      selectedTrackId,
      selectedIds,
      columns,
      gridTemplate,
      totalWidth,
      libraries,
      publisherRule,
      previewedIds,
      reorderable,
      dragOverId,
      onReorderStart,
      onReorderOver,
      onReorderDrop,
      onReorderCancel,
    } = data;
    const track = tracks[index];
    const isSelected =
      track.id === selectedTrackId || (selectedIds?.has(track.id) ?? false);
    const isPreviewed =
      track.lastPlayedAt != null || previewedIds.has(track.id);
    const isDragOver = reorderable && dragOverId === track.id;
    const color = colorForCategory(track.category);

    return (
      <div
        style={{
          ...style,
          gridTemplateColumns: gridTemplate,
          width: totalWidth,
        }}
        className={`list-row${isSelected ? " list-row--selected" : ""}${isPreviewed ? " list-row--previewed" : ""}${isDragOver ? " list-row--dragover" : ""}`}
        draggable
        onDragStart={(e) => {
          // ?�택 ?��??� 무�??�게 ?�떤 ?�이??즉시 OS ?�이?�브 ?�래�?DAW/?�색기로 ?�롭)
          e.preventDefault();
          window.api?.startDrag(track.filePath);
        }}
        onDragOver={
          reorderable
            ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                onReorderOver(track.id);
              }
            : undefined
        }
        onDrop={
          reorderable
            ? (e) => {
                e.preventDefault();
                onReorderDrop();
              }
            : undefined
        }
      >
        {columns.map((col) => {
          if (col.key === "name") {
            return (
              <div className="list-row__cell list-row__name" key={col.key}>
                {reorderable && (
                  <span
                    className="list-row__grip"
                    draggable
                    title="드래그해서 순서 바꾸기"
                    onDragStart={(e) => {
                      // 부모 row의 OS 네이티브 드래그(startDrag)로 이벤트가 버블링되지 않도록 막는다 —
                      // 그러지 않으면 e.preventDefault()가 이 순서 재정렬 드래그까지 취소시킨다.
                      e.stopPropagation();
                      e.dataTransfer.effectAllowed = "move";
                      onReorderStart(track.id);
                    }}
                    onDragEnd={(e) => {
                      // 유효한 행 위에서 놓였으면 onDrop이 이미 순서를 커밋하고 상태를 비웠다 —
                      // 여기서는 목록 밖에 놓거나 취소된 경우를 위한 안전한 상태 초기화만 한다
                      e.stopPropagation();
                      onReorderCancel();
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripIcon />
                  </span>
                )}
                <SpeakerIcon color={color} />
                <span className="list-row__filename" title={track.filePath}>
                  {track.filename}
                </span>
              </div>
            );
          }
          return (
            <div
              className={`list-row__cell${col.key !== "name" ? " list-row__cell--sub" : ""}`}
              style={
                col.align === "right"
                  ? { textAlign: "right", fontVariantNumeric: "tabular-nums" }
                  : undefined
              }
              key={col.key}
            >
              {col.value(track, { libraries, publisherRule })}
            </div>
          );
        })}
      </div>
    );
  },
  areEqual,
);
Row.displayName = "Row";

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
  onSort,
  publisherRule,
  previewedIds,
  reorderable = false,
  onReorder,
  onBrowseFolder,
  onRenameTrack,
  onOpenMetadataPanel,
  onRemoveTrack,
  onNotify,
}: ResultListProps): JSX.Element {
  const listRef = useRef<FixedSizeList>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hoverBoxRef = useRef<HTMLDivElement>(null);
  const scrollOffsetRef = useRef(0);
  const mouseYRef = useRef<number | null>(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    new Set(DEFAULT_VISIBLE),
  );
  // 컬럼�?고정 px ?????�나�??�려???�른 컬럼???�향 ?�이 ?�립?�으�?리사?�즈??
  const [colWidths, setColWidths] = useState<Record<string, number>>(() =>
    loadJSON(COL_WIDTHS_KEY, {}),
  );
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    loadJSON(
      COL_ORDER_KEY,
      ALL_COLUMNS.map((c) => c.key),
    ),
  );
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [rowMenu, setRowMenu] = useState<{
    x: number;
    y: number;
    track: Track;
  } | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<
    "collection" | "fontsize" | null
  >(null);
  const [fontSizeKey, setFontSizeKeyState] = useState<FontSizeKey>(() =>
    loadJSON(FONT_SIZE_KEY, "medium" as FontSizeKey),
  );
  const fontSizeOpt =
    FONT_SIZE_OPTIONS.find((o) => o.key === fontSizeKey) ??
    FONT_SIZE_OPTIONS[1];
  const rowHeight = fontSizeOpt.rowHeight;
  function setFontSizeKey(key: FontSizeKey): void {
    setFontSizeKeyState(key);
    saveJSON(FONT_SIZE_KEY, key);
  }
  const [dragRowId, setDragRowId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const dragRowIdRef = useRef<number | null>(null);
  const dragOverIdRef = useRef<number | null>(null);
  dragRowIdRef.current = dragRowId;
  dragOverIdRef.current = dragOverId;

  function handleReorderStart(id: number): void {
    setDragRowId(id);
  }
  function handleReorderOver(id: number): void {
    if (dragOverIdRef.current !== id) setDragOverId(id);
  }
  function handleReorderDrop(): void {
    const fromId = dragRowIdRef.current;
    const toId = dragOverIdRef.current;
    setDragRowId(null);
    setDragOverId(null);
    if (fromId == null || toId == null || fromId === toId || !onReorder) return;
    const ids = tracksRef.current.map((t) => t.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  }
  function handleReorderCancel(): void {
    setDragRowId(null);
    setDragOverId(null);
  }

  useEffect(() => {
    if (!rowMenu) return;
    setActiveSubmenu(null);
    const close = (): void => setRowMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [rowMenu]);

  const columns = useMemo(() => {
    const byKey = new Map(ALL_COLUMNS.map((c) => [c.key, c]));
    const validOrder = columnOrder.filter((key) => byKey.has(key));
    const missing = ALL_COLUMNS.map((c) => c.key).filter(
      (key) => !validOrder.includes(key),
    );
    return [...validOrder, ...missing]
      .map((key) => byKey.get(key)!)
      .filter((c) => visibleCols.has(c.key));
  }, [columnOrder, visibleCols]);
  function widthOf(col: ColumnDef): number {
    return colWidths[col.key] ?? col.defaultWidth;
  }
  const gridTemplate = useMemo(
    () => columns.map((c) => `${widthOf(c)}px`).join(" "),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, colWidths],
  );
  const totalWidth = useMemo(
    () => columns.reduce((sum, c) => sum + widthOf(c), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, colWidths],
  );

  // ?�더 경계 ?�래그로 컬럼 ??조절 ??컬럼마다 ?�립??고정 px?��?�??�른 컬럼???�향 ?�음
  function startResize(e: React.MouseEvent, key: string): void {
    e.preventDefault();
    e.stopPropagation();
    const col = ALL_COLUMNS.find((c) => c.key === key);
    const startWidth = colWidths[key] ?? col?.defaultWidth ?? 100;
    const startX = e.clientX;
    let latest = startWidth;
    function onMove(ev: MouseEvent): void {
      latest = Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX));
      setColWidths((prev) => ({ ...prev, [key]: latest }));
    }
    function onUp(): void {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setColWidths((prev) => {
        saveJSON(COL_WIDTHS_KEY, prev);
        return prev;
      });
    }
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function moveColumn(fromKey: string, toKey: string): void {
    if (fromKey === toKey) return;
    setColumnOrder((prev) => {
      const known = new Set(ALL_COLUMNS.map((c) => c.key));
      const base = prev.filter((key) => known.has(key));
      for (const col of ALL_COLUMNS) {
        if (!base.includes(col.key)) base.push(col.key);
      }
      const from = base.indexOf(fromKey);
      const to = base.indexOf(toKey);
      if (from < 0 || to < 0) return prev;
      const next = [...base];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      saveJSON(COL_ORDER_KEY, next);
      return next;
    });
  }

  // ?�택???�랙??"바�??�만"(?�릭/?�살???�동) ?�면 밖이�?보이?�록 ?�크�????�렬/?�플�?
  // tracks 배열 ?�서�?바뀌는 경우?�는 ?�행?��? ?�도�?tracks???�존?�에???�외
  useEffect(() => {
    if (selectedTrackId == null) return;
    const idx = tracksRef.current.findIndex((t) => t.id === selectedTrackId);
    if (idx >= 0) listRef.current?.scrollToItem(idx, "smart");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrackId]);

  // 정렬/셔플로 tracks 순서가 바뀌어도 scrollTop은 건드리지 않는다 — react-window는
  // itemData만 바뀔 뿐 스크롤 위치를 스스로 초기화하지 않으므로, 화면에 보이던 "행 위치"는
  // 그대로 두고 그 자리에 놓이는 아이템만 새 순서로 바뀐다(특정 아이템을 따라가도록
  // scrollTo를 호출하면 정렬 방향이 바뀔 때마다 그 아이템의 절대 위치가 크게 달라져
  // 스크롤바가 오히려 위아래로 크게 움직이는 결과가 된다).

  function indexAtY(clientY: number): number {
    const wrap = wrapRef.current;
    if (!wrap) return -1;
    const rect = wrap.getBoundingClientRect();
    const idx = Math.floor(
      (clientY - rect.top + scrollOffsetRef.current) / rowHeight,
    );
    return idx >= 0 && idx < tracksRef.current.length ? idx : -1;
  }

  function updateHoverBox(): void {
    const box = hoverBoxRef.current;
    if (!box) return;
    const y = mouseYRef.current;
    const idx = y == null ? -1 : indexAtY(y);
    if (idx < 0) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    box.style.top = `${idx * rowHeight - scrollOffsetRef.current}px`;
  }

  useEffect(() => {
    updateHoverBox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks]);

  function toggleColumn(key: string): void {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (key === "name") return next; // Name?� ??�� ?��?
        next.delete(key);
      } else next.add(key);
      return next;
    });
  }

  function autoResizeColumns(): void {
    setColWidths({});
    saveJSON(COL_WIDTHS_KEY, {});
  }

  async function handleSendToFolder(track: Track): Promise<void> {
    if (!window.api) return;
    const dest = await window.api.copyToFolder(track.filePath);
    if (dest) onNotify?.(`Copied to ${dest}`);
  }

  async function handleRemoveTrack(track: Track): Promise<void> {
    await window.api?.removeTrack(track.id);
    onRemoveTrack?.(track);
  }

  function handleHorizontalWheel(e: React.WheelEvent<HTMLDivElement>): void {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const wantsHorizontal =
      e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (!wantsHorizontal) return;
    const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
    if (delta === 0) return;
    e.preventDefault();
    e.stopPropagation();
    scroll.scrollLeft += delta;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = (): void => setViewportWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const itemData: RowData = {
    tracks,
    selectedTrackId,
    selectedIds,
    columns,
    gridTemplate,
    totalWidth,
    libraries,
    publisherRule,
    previewedIds,
    reorderable,
    dragOverId,
    onReorderStart: handleReorderStart,
    onReorderOver: handleReorderOver,
    onReorderDrop: handleReorderDrop,
    onReorderCancel: handleReorderCancel,
  };

  return (
    <div
      className="content"
      style={
        {
          "--row-h": `${rowHeight}px`,
          "--list-font-size": `${fontSizeOpt.fontSize}px`,
        } as React.CSSProperties
      }
    >
      {tracks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__big">No sounds to display</div>
          <div>Add a folder from the sidebar or select another folder.</div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="list-scroll"
          onWheelCapture={handleHorizontalWheel}
        >
          <div className="list-scroll__inner" style={{ width: totalWidth }}>
            <div
              className="list-header"
              style={{ gridTemplateColumns: gridTemplate }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              {columns.map((col) => {
                const Icon = col.icon ? HEADER_ICONS[col.key] : null;
                const isSorted = sortKey === col.key;
                return (
                  <div
                    key={col.key}
                    className={`list-header__cell${dragCol === col.key ? " list-header__cell--dragging" : ""}`}
                    style={
                      col.align === "right"
                        ? { justifyContent: "flex-end" }
                        : undefined
                    }
                    draggable
                    onDragStart={(e) => {
                      setDragCol(col.key);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", col.key);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from =
                        e.dataTransfer.getData("text/plain") || dragCol;
                      if (from) moveColumn(from, col.key);
                      setDragCol(null);
                    }}
                    onDragEnd={() => setDragCol(null)}
                  >
                    <span
                      className="list-header__label"
                      title={Icon ? col.label : undefined}
                      onClick={() => onSort(col.key)}
                    >
                      {Icon ? <Icon /> : col.label}
                      {isSorted && (
                        <span className="list-header__sort">
                          {sortDir === "asc" ? "^" : "v"}
                        </span>
                      )}
                    </span>
                    <span
                      className="list-header__resize"
                      title="?�래그로 ??조절"
                      onMouseDown={(e) => startResize(e, col.key)}
                      onContextMenu={(e) => e.stopPropagation()}
                    />
                  </div>
                );
              })}
            </div>

            <div
              ref={wrapRef}
              style={{ flex: 1, position: "relative" }}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                const rect = wrapRef.current!.getBoundingClientRect();
                if (rect.right - e.clientX < SCROLLBAR_GUARD) return;
                const idx = indexAtY(e.clientY);
                if (idx >= 0) onSelectTrack(tracksRef.current[idx]);
              }}
              onMouseMove={(e) => {
                mouseYRef.current = e.clientY;
                updateHoverBox();
              }}
              onMouseLeave={() => {
                mouseYRef.current = null;
                updateHoverBox();
              }}
              onContextMenu={(e) => {
                const idx = indexAtY(e.clientY);
                if (idx < 0) return;
                e.preventDefault();
                onSelectTrack(tracksRef.current[idx]);
                setRowMenu({
                  x: e.clientX,
                  y: e.clientY,
                  track: tracksRef.current[idx],
                });
              }}
            >
              <div
                ref={hoverBoxRef}
                className="list-hoverbox"
                style={{
                  height: rowHeight,
                  width: totalWidth,
                  display: "none",
                }}
              />
              <AutoSizer>
                {({ height, width }: { height: number; width: number }) => (
                  <FixedSizeList
                    ref={listRef}
                    height={height}
                    width={Math.max(1, viewportWidth || width)}
                    itemCount={tracks.length}
                    itemSize={rowHeight}
                    itemData={itemData}
                    itemKey={(index, data) => data.tracks[index].id}
                    overscanCount={12}
                    style={{ overflowX: "hidden" }}
                    onScroll={({ scrollOffset }) => {
                      scrollOffsetRef.current = scrollOffset;
                      updateHoverBox();
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

      {rowMenu &&
        (() => {
          const menuWidth = 230;
          const submenuWidth = 210;
          const flipSubmenu =
            rowMenu.x + menuWidth + submenuWidth > window.innerWidth;
          return (
            <div
              className="colmenu"
              style={{
                left: Math.min(rowMenu.x, window.innerWidth - menuWidth - 8),
                top: Math.min(rowMenu.y, window.innerHeight - 380),
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* Add to collection ▶ */}
              <div
                className="colmenu__item colmenu__item--action colmenu__item--haschildren"
                onMouseEnter={() => setActiveSubmenu("collection")}
                onMouseLeave={() =>
                  setActiveSubmenu((s) => (s === "collection" ? null : s))
                }
              >
                <span>Add to collection</span>
                <span className="colmenu__arrow">▶</span>
                {activeSubmenu === "collection" && (
                  <div
                    className={`colmenu colmenu__submenu${flipSubmenu ? " colmenu__submenu--left" : ""}`}
                    style={{ width: submenuWidth }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {collections.length > 0 && (
                      <div className="colmenu__scroll">
                        {collections.map((col) => (
                          <button
                            key={col.id}
                            className="colmenu__item"
                            onClick={() => {
                              onAddToCollection(col.id, rowMenu.track.id);
                              setRowMenu(null);
                            }}
                          >
                            <span>{col.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {collections.length > 0 && <div className="colmenu__sep" />}
                    <button
                      className="colmenu__item"
                      onClick={() => {
                        onCreateCollectionWith(rowMenu.track.id);
                        setRowMenu(null);
                      }}
                    >
                      <span className="colmenu__check">+</span>
                      <span>New collection</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="colmenu__sep" />

              <button
                className="colmenu__item colmenu__item--action"
                onClick={() => {
                  onToggleStar(rowMenu.track);
                  setRowMenu(null);
                }}
              >
                <span>{rowMenu.track.starred ? "Unflag" : "Flag"}</span>
                <span className="colmenu__shortcut">F</span>
              </button>
              <button
                className="colmenu__item colmenu__item--action"
                onClick={() => {
                  onBrowseFolder?.(rowMenu.track);
                  setRowMenu(null);
                }}
              >
                <span>Browse this folder</span>
                <span className="colmenu__shortcut">Ctrl+Shift+F</span>
              </button>
              <button
                className="colmenu__item colmenu__item--action"
                onClick={() => {
                  void window.api?.showItemInFolder(rowMenu.track.filePath);
                  setRowMenu(null);
                }}
              >
                <span>Show in File Explorer</span>
                <span className="colmenu__shortcut">Ctrl+Shift+R</span>
              </button>

              <div className="colmenu__sep" />

              <button
                className="colmenu__item colmenu__item--action"
                draggable
                title="Cubase 창으로 직접 끌어다 놓으면 트랙에 추가됩니다"
                onDragStart={(e) => {
                  e.preventDefault();
                  window.api?.startDrag(rowMenu.track.filePath);
                }}
                onClick={() => setRowMenu(null)}
              >
                <span>Send to Cubase</span>
                <span className="colmenu__shortcut">S</span>
              </button>
              <button
                className="colmenu__item"
                onClick={() => {
                  void window.api?.openExternal(rowMenu.track.filePath);
                  setRowMenu(null);
                }}
              >
                <span>Open in external editor</span>
              </button>
              <button
                className="colmenu__item"
                onClick={() => {
                  void handleSendToFolder(rowMenu.track);
                  setRowMenu(null);
                }}
              >
                <span>Send to folder</span>
              </button>

              <div className="colmenu__sep" />

              <button
                className="colmenu__item colmenu__item--action"
                onClick={() => {
                  onRenameTrack?.(rowMenu.track);
                  setRowMenu(null);
                }}
              >
                <span>Rename</span>
                <span className="colmenu__shortcut">Ctrl+E</span>
              </button>
              <button
                className="colmenu__item"
                onClick={() => {
                  onOpenMetadataPanel?.();
                  setRowMenu(null);
                }}
              >
                <span>Open metadata panel</span>
              </button>

              <div className="colmenu__sep" />

              <button
                className="colmenu__item colmenu__item--action colmenu__item--danger"
                onClick={() => {
                  void handleRemoveTrack(rowMenu.track);
                  setRowMenu(null);
                }}
              >
                <span>Remove</span>
                <span className="colmenu__shortcut">Backspace</span>
              </button>

              <div className="colmenu__sep" />

              {/* Font size ▶ */}
              <div
                className="colmenu__item colmenu__item--action colmenu__item--haschildren"
                onMouseEnter={() => setActiveSubmenu("fontsize")}
                onMouseLeave={() =>
                  setActiveSubmenu((s) => (s === "fontsize" ? null : s))
                }
              >
                <span>Font size</span>
                <span className="colmenu__arrow">▶</span>
                {activeSubmenu === "fontsize" && (
                  <div
                    className={`colmenu colmenu__submenu${flipSubmenu ? " colmenu__submenu--left" : ""}`}
                    style={{ width: 140 }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {FONT_SIZE_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        className="colmenu__item"
                        onClick={() => setFontSizeKey(opt.key)}
                      >
                        <span className="colmenu__check">
                          {fontSizeKey === opt.key ? "✓" : ""}
                        </span>
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
    </div>
  );
}
