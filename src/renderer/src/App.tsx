import { useEffect, useMemo, useRef, useState } from "react";
import MenuBar from "./components/MenuBar/MenuBar";
import Sidebar from "./components/Sidebar/Sidebar";
import ResultList from "./components/ResultList/ResultList";
import FolderGrid from "./components/FolderGrid/FolderGrid";
import PlayerBar, { type PlayerHandle } from "./components/PlayerBar/PlayerBar";
import MetadataPanel from "./components/MetadataPanel/MetadataPanel";
import AnalysisPanel from "./components/AnalysisPanel/AnalysisPanel";
import AccentPicker from "./components/AccentPicker/AccentPicker";
import CollectionHero from "./components/CollectionHero/CollectionHero";
import NamePromptModal from "./components/NamePromptModal/NamePromptModal";
import ContextMenu from "./components/ContextMenu/ContextMenu";
import ColorPickerPopover from "./components/ColorPickerPopover/ColorPickerPopover";
import Toast from "./components/Toast/Toast";
import ShortcutsModal from "./components/ShortcutsModal/ShortcutsModal";
import PublisherSettingsModal from "./components/PublisherSettingsModal/PublisherSettingsModal";
import BatchEditModal from "./components/BatchEditModal/BatchEditModal";
import DuplicatesModal from "./components/DuplicatesModal/DuplicatesModal";
import type {
  Collection,
  Library,
  PublisherRule,
  ScanProgress,
  Track,
  TrackMetadataPatch,
  WatchStatus,
} from "@shared/types";
import {
  isBrowserPreview,
  mockCollections,
  mockLibrary,
  mockTracks,
} from "./mockData";
import {
  buildFolderTree,
  tracksUnder,
  type FolderNode,
  type LibraryTree,
} from "./lib/folderTree";
import { applyAccent, loadAccent, saveAccent } from "./lib/theme";
import { loadJSON, loadNumber, saveJSON, saveNumber } from "./lib/uiState";
import { shuffleTracks, sortTracks } from "./components/ResultList/columns";
import { DEFAULT_PUBLISHER_RULE } from "@shared/publisher";

function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 440;
const META_MIN = 220;
const META_MAX = 480;
const PLAYER_MIN = 96;
const PLAYER_MAX = 380;
const META_PANEL_HEIGHT_MIN = 160;
// Analysis(Peak/Stereo Image)가 ?�무�?좁아??최소 ???�도 ?�이???�도�??�약 ??// ??그러�?Metadata�??�까지 ?�렸????Analysis가 ?�면 밖으�??�전??밀??"?�라�? 것처??보임
const ANALYSIS_MIN_RESERVED = 170;

const TABS_KEY = "soundlib.tabs";
const ACTIVE_TAB_KEY = "soundlib.activeTabId";

// 탭 하나 = 브라우징 위치 하나. 폴더(=라이브러리 하위 경로)와 컬렉션은 서로 배타적이다.
interface WorkspaceTab {
  id: number;
  folder: string | null;
  collection: number | null;
}

// Date.now()는 같은 밀리초에 두 번 부르면 겹친다(빠른 연속 클릭). 단조 증가 카운터로 보강.
let tabIdSeq = 0;
function newTab(): WorkspaceTab {
  tabIdSeq += 1;
  return { id: Date.now() * 1000 + tabIdSeq, folder: null, collection: null };
}

export default function App(): JSX.Element {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  // 시작 시 메인이 만들어 보내주는 사이드바 폴더 트리 — 전체 트랙(tracks)이 백그라운드로
  // 다 로드되기 전까지 사이드바를 즉시 그리는 데 쓴다. tracks가 채워지면 그때부터는
  // tracks에서 파생한 트리(watcher 추가/삭제까지 반영)를 쓰고 이 값은 무시된다.
  const [serverTrees, setServerTrees] = useState<LibraryTree[]>([]);
  const [tracksLoaded, setTracksLoaded] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [search, setSearch] = useState("");
  const [subSearch, setSubSearch] = useState("");
  // Shuffle?� ?��????�니??"버튼 ?�릭 = 지�?즉시 ?�로 ?�기" ?�작. shuffled???�재 리스?��?
  // ?�플???�서�?보이??중인지�??��??�며(컬럼 ?�렬???�릭?�면 ?�시 false), ?�속 ?�?�하지 ?�는??
  const [shuffled, setShuffled] = useState(false);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);

  // ── 탭 ──
  // 탭 하나가 곧 "무엇을 보고 있는지"(폴더 또는 컬렉션)다. selectedFolder/selectedCollection을
  // 별도 state로 두지 않고 활성 탭에서 파생시켜, 탭을 바꾸면 보던 위치가 그대로 따라오게 한다.
  // 탭이 0개인 상태도 유효하다(첫 실행). 그때는 중앙에 빈 상태 안내만 뜬다.
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() =>
    loadJSON<WorkspaceTab[]>(TABS_KEY, []),
  );
  const [activeTabId, setActiveTabId] = useState<number | null>(() => {
    const saved = loadNumber(ACTIVE_TAB_KEY, -1);
    if (tabs.some((t) => t.id === saved)) return saved;
    return tabs[0]?.id ?? null;
  });
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const selectedFolder = activeTab?.folder ?? null;
  const selectedCollection = activeTab?.collection ?? null;
  const pendingTabIdRef = useRef<number | null>(null);

  // 기존 호출부는 setSelectedFolder(x); setSelectedCollection(null); 처럼 한 렌더 안에서
  // 연달아 부른다. 함수형 업데이터를 써야 뒤 호출이 앞 호출을 덮어쓰지 않는다.
  // 활성 탭이 없으면(빈 상태) 새 탭을 만들어 거기에 적용한다 — 사이드바에서 라이브러리나
  // 컬렉션을 클릭하는 모든 경로가 이 함수를 거치므로, 탭 자동 생성이 여기서 한 번에 처리된다.
  // 단, 위의 연속 호출이 탭을 두 개 만들지 않도록 이번에 만든 탭 id를 ref에 남겨 재사용한다
  // (setActiveTabId는 다음 렌더에나 반영되므로 activeTab만으로는 두 번째 호출을 못 잡는다).
  function patchActiveTab(patch: Partial<Omit<WorkspaceTab, "id">>): void {
    const targetId = activeTab?.id ?? pendingTabIdRef.current;
    if (targetId == null) {
      const tab = { ...newTab(), ...patch };
      // 탭 없는 상태(=Local 루트)와 똑같은 화면이면 탭을 만들지 않는다.
      // 사이드바 Local이나 breadcrumb Home 클릭이 여기로 들어온다.
      if (tab.folder == null && tab.collection == null) return;
      pendingTabIdRef.current = tab.id;
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      return;
    }
    setTabs((prev) =>
      prev.map((t) => (t.id === targetId ? { ...t, ...patch } : t)),
    );
  }
  function setSelectedFolder(folder: string | null): void {
    patchActiveTab({ folder });
  }
  function setSelectedCollection(collection: number | null): void {
    patchActiveTab({ collection });
  }

  function addTab(): void {
    const tab = newTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(id: number): void {
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    // 다시 빈 상태가 되면 ref도 비운다 — 안 그러면 사라진 탭 id를 계속 가리킨다
    if (next.length === 0) pendingTabIdRef.current = null;
    // 활성 탭을 닫으면 왼쪽 탭으로(없으면 첫 탭으로) 넘긴다. 마지막 탭이었다면 빈 상태로.
    if (id === activeTabId)
      setActiveTabId(next.length > 0 ? next[Math.max(0, idx - 1)].id : null);
  }

  useEffect(() => {
    saveJSON(TABS_KEY, tabs);
  }, [tabs]);
  useEffect(() => {
    saveNumber(ACTIVE_TAB_KEY, activeTabId ?? -1);
  }, [activeTabId]);
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [showMeta, setShowMeta] = useState(true);
  const [publisherRule, setPublisherRule] = useState<PublisherRule>(() =>
    loadJSON("soundlib.publisherRule", DEFAULT_PUBLISHER_RULE),
  );
  const [publisherSettingsOpen, setPublisherSettingsOpen] = useState(false);
  const [namePrompt, setNamePrompt] = useState<{
    title: string;
    defaultValue?: string;
    confirmLabel?: string;
    onSubmit: (name: string) => void;
  } | null>(null);
  const [collectionMenu, setCollectionMenu] = useState<{
    x: number;
    y: number;
    collection: Collection;
  } | null>(null);
  const [libraryMenu, setLibraryMenu] = useState<{
    x: number;
    y: number;
    library: Library;
  } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{
    x: number;
    y: number;
    node: FolderNode;
    library: Library;
  } | null>(null);
  const [colorPicker, setColorPicker] = useState<{
    x: number;
    y: number;
    collectionId: number;
    color: string | null;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [folderDragDepth, setFolderDragDepth] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  // ?�중 ?�택(Ctrl+A ??. ?�일 ?�릭/?�살???�동 ???�당 ?�랙 ?�나�?초기?�됨.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // "미리듣기(previewed)" 표시를 tracks 배열과 분리된 별도 상태로 둔다 — 예전에는 선택할 때마다
  // setTracks(prev => prev.map(...))로 tracks 참조 자체를 바꿨는데, 이게 visibleTracks의
  // useMemo 의존성이라 클릭할 때마다 라이브러리 전체(수만~수십만 트랙)를 다시 정렬/필터링하는
  // 원인이었다(클릭 반응 저하의 주범). previewedIds는 이 세션에서만 유지되는 휘발성 상태로,
  // 앱을 재시작하면 초기화되어 회색 표시도 함께 사라진다(DB의 lastPlayedAt과는 무관).
  const [previewedIds, setPreviewedIds] = useState<Set<number>>(new Set());
  const toastTimerRef = useRef<number | undefined>(undefined);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const subSearchRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<PlayerHandle>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  function showToast(message: string): void {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200);
  }
  const [view, setView] = useState<"grid" | "list">("grid");
  const [dockMode, setDockModeState] = useState(false);
  const [accent, setAccentState] = useState<string>(loadAccent());
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    loadNumber("soundlib.sidebarWidth", 246),
  );
  const [metaWidth, setMetaWidth] = useState(() =>
    loadNumber("soundlib.metaWidth", 272),
  );
  const [metaPanelHeight, setMetaPanelHeight] = useState(() =>
    loadNumber("soundlib.metaPanelHeight", 320),
  );
  const [playerHeight, setPlayerHeight] = useState(() =>
    loadNumber("soundlib.playerHeight", 140),
  );
  const [sort, setSort] = useState<{ key: string | null; dir: "asc" | "desc" }>(
    () => loadJSON("soundlib.sort", { key: null, dir: "asc" }),
  );
  function handleSort(key: string): void {
    // Shuffle mode is disabled when the user sorts the list
    if (shuffled) setShuffled(false);
    setSort((prev) => {
      const next: { key: string | null; dir: "asc" | "desc" } =
        prev.key === key
          ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
          : { key, dir: "asc" };
      saveJSON("soundlib.sort", next);
      return next;
    });
  }
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [watchStatus, setWatchStatus] = useState<WatchStatus | null>(null);

  // 진행 ?�벤?��? ?�면(?�동 ?�캔?�든 백그?�운??감시 ?�스캔이?? ?�덱???�시�?켠다
  useEffect(() => {
    if (!window.api?.onScanProgress) return;
    return window.api.onScanProgress((p) => {
      setScanProgress(p);
      setScanning(true);
    });
  }, []);

  // "Monitor for changes"�?백그?�운?�에???�스캔되�?최신 ?�이브러�??�랙??반영?�고
  // (?�동 ?�캔 ?�들?��? 거치지 ?�으므�? ?�기??직접 ?�덱???�시�??�다
  useEffect(() => {
    if (!window.api?.onLibraryUpdated) return;
    return window.api.onLibraryUpdated(({ libraries, tracks }) => {
      setLibraries(libraries);
      setTracks(tracks);
      setScanning(false);
      setScanProgress(null);
    });
  }, []);

  // 실시간 감시(watcher)가 보내는 세분화 이벤트 — 폴더 전체를 다시 받지 않고 tracks 배열에
  // 추가/갱신/제거만 patch한다. 정렬/검색/필터/스크롤은 이 상태들과 무관하게 유지되므로
  // 리스트가 위아래로 튀거나 초기화되지 않는다.
  useEffect(() => {
    if (!window.api?.onTrackAdded) return;
    return window.api.onTrackAdded((track) => {
      setTracks((prev) =>
        prev.some((t) => t.id === track.id)
          ? prev.map((t) => (t.id === track.id ? track : t))
          : [...prev, track],
      );
    });
  }, []);

  useEffect(() => {
    if (!window.api?.onTrackUpdated) return;
    return window.api.onTrackUpdated((track) => {
      setTracks((prev) => prev.map((t) => (t.id === track.id ? track : t)));
      setSelectedTrack((prev) => (prev && prev.id === track.id ? track : prev));
    });
  }, []);

  useEffect(() => {
    if (!window.api?.onTrackRemoved) return;
    return window.api.onTrackRemoved((trackId) => {
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
      setSelectedTrack((prev) => (prev && prev.id === trackId ? null : prev));
      setSelectedIds((prev) => {
        if (!prev.has(trackId)) return prev;
        const next = new Set(prev);
        next.delete(trackId);
        return next;
      });
    });
  }, []);

  useEffect(() => {
    if (!window.api?.onWatchStatus) return;
    return window.api.onWatchStatus((status) => setWatchStatus(status));
  }, []);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  function setAccent(hex: string): void {
    setAccentState(hex);
    saveAccent(hex);
  }

  // Dock Mode: 창을 화면 하단의 얇은 트랜스포트 바로 축소한다. PlayerBar는 항상 마운트된
  // 상태를 유지해(App.tsx의 렌더 트리에서 조건부로 제거하지 않음) 재생이 끊기지 않는다.
  function handleToggleDockMode(): void {
    const next = !dockMode;
    setDockModeState(next);
    void window.api?.setDockMode(next);
  }

  function handleSavePublisherRule(next: PublisherRule): void {
    setPublisherRule(next);
    saveJSON("soundlib.publisherRule", next);
    setPublisherSettingsOpen(false);
  }

  // ?�이?�바/메�??�널 ?�래�?리사?�즈 (최소·최�? ???�한, 종료 ?????�??
  function startPanelResize(
    e: React.MouseEvent,
    which: "sidebar" | "meta",
  ): void {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = which === "sidebar" ? sidebarWidth : metaWidth;
    const min = which === "sidebar" ? SIDEBAR_MIN : META_MIN;
    const max = which === "sidebar" ? SIDEBAR_MAX : META_MAX;
    let latest = startWidth;

    function onMove(ev: MouseEvent): void {
      const delta =
        which === "sidebar" ? ev.clientX - startX : startX - ev.clientX;
      latest = Math.max(min, Math.min(max, startWidth + delta));
      if (which === "sidebar") setSidebarWidth(latest);
      else setMetaWidth(latest);
    }
    function onUp(): void {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      saveNumber(
        which === "sidebar" ? "soundlib.sidebarWidth" : "soundlib.metaWidth",
        latest,
      );
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }
  // Bottom player height resize handle with min/max limits
  function startPlayerResize(e: React.MouseEvent): void {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = playerHeight;
    let latest = startHeight;
    function onMove(ev: MouseEvent): void {
      latest = Math.max(
        PLAYER_MIN,
        Math.min(PLAYER_MAX, startHeight + (startY - ev.clientY)),
      );
      setPlayerHeight(latest);
    }
    function onUp(): void {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      saveNumber("soundlib.playerHeight", latest);
    }
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ?�전???�?�된 metaPanelHeight가 지�?�??�기 기�??�로 ?�무 커서 Analysis가 ?�면
  // 밖으�?밀?�나 ?�으�??? ?�전??????창에???�?? ?�작 ??�??�기 변�???보정?�다.
  useEffect(() => {
    function clampToFit(): void {
      const rightPanelHeight =
        rightPanelRef.current?.getBoundingClientRect().height;
      if (!rightPanelHeight) return;
      const maxAllowed = Math.max(
        META_PANEL_HEIGHT_MIN,
        rightPanelHeight - ANALYSIS_MIN_RESERVED,
      );
      setMetaPanelHeight((prev) => (prev > maxAllowed ? maxAllowed : prev));
    }
    clampToFit();
    window.addEventListener("resize", clampToFit);
    return () => window.removeEventListener("resize", clampToFit);
  }, [showMeta]);

  // ?�작 ???�?�돼 ?�던 ?�체 ?�이브러�??�랙 로드 (?�적 ?��?)
  useEffect(() => {
    if (isBrowserPreview) {
      setLibraries([mockLibrary]);
      setTracks(mockTracks);
      setCollections(mockCollections);
      return;
    }
    let notified = false;
    // notifyReady를 setState와 같은 동기 틱에서 부르면, React가 로드된 데이터를 커밋/페인트하기
    // 전에 메인이 창을 노출해 "빈 초기 화면 → 뒤늦게 채워짐" 깜빡임이 생긴다. 데이터 setState가
    // 실제 프레임으로 그려진 뒤(double rAF = 첫 페인트 이후) 신호를 보내 채워진 상태로 노출되게 한다.
    const notifyAfterPaint = (): void => {
      if (notified) return;
      notified = true;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.api?.notifyReady()),
      );
    };
    // 1) 사이드바 폴더 트리를 먼저 받아 즉시 그린다(경량 페이로드). 이게 끝나면 바로 창을
    //    노출하므로, 수십만 트랙 라이브러리에서도 시작이 몇 초 안에 끝난 것처럼 보인다.
    const loadTreeP = window.api
      ?.loadTree()
      .then(({ libraries, trees }) => {
        setLibraries(libraries);
        setServerTrees(trees);
      })
      .catch(() => {});
    const loadCollectionsP = window.api?.getCollections().then(setCollections);
    // 트리 + 컬렉션(둘 다 가벼움)이 그려지면 창을 노출한다 — 무거운 전체 트랙 로드를 기다리지 않는다.
    Promise.all([loadTreeP, loadCollectionsP]).finally(notifyAfterPaint);

    // 2) 전체 트랙(리스트·검색·정렬용, 무거움)은 백그라운드로 이어서 로드한다. 완료되면
    //    tracks가 채워지고 tracksLoaded가 true가 되어 사이드바 트리가 tracks 파생 버전으로 전환된다.
    void window.api?.loadAll().then(({ libraries, tracks }) => {
      setLibraries(libraries);
      setTracks(tracks);
      setTracksLoaded(true);
    });
  }, []);

  function handleCreateCollection(): void {
    setNamePrompt({
      title: "New collection name",
      onSubmit: async (name) => {
        if (window.api) setCollections(await window.api.createCollection(name));
        setNamePrompt(null);
      },
    });
  }

  async function handleDeleteCollection(id: number): Promise<void> {
    if (!window.api) return;
    if (!window.confirm("Delete this collection? This does not delete sounds."))
      return;
    setCollections(await window.api.deleteCollection(id));
    // 활성 탭뿐 아니라 이 컬렉션을 가리키던 모든 탭을 비운다
    setTabs((prev) =>
      prev.map((t) => (t.collection === id ? { ...t, collection: null } : t)),
    );
  }

  async function handleAddToCollection(
    collectionId: number,
    trackId: number,
  ): Promise<void> {
    if (!window.api) return;
    setCollections(
      await window.api.addTrackToCollection(collectionId, trackId),
    );
  }

  function handleRenameCollection(collection: Collection): void {
    setNamePrompt({
      title: "Rename collection",
      defaultValue: collection.name,
      confirmLabel: "Rename",
      onSubmit: async (name) => {
        if (window.api)
          setCollections(
            await window.api.renameCollection(collection.id, name),
          );
        setNamePrompt(null);
      },
    });
  }

  async function handleSetCollectionColor(
    collectionId: number,
    color: string | null,
  ): Promise<void> {
    if (!window.api) return;
    setCollections(await window.api.setCollectionColor(collectionId, color));
  }

  // 컬렉션 안에서 사용자가 드래그로 지정한 순서를 낙관적으로 먼저 반영한 뒤 서버 결과로 동기화
  async function handleReorderCollection(
    collectionId: number,
    orderedTrackIds: number[],
  ): Promise<void> {
    setCollections((prev) =>
      prev.map((c) =>
        c.id === collectionId ? { ...c, trackIds: orderedTrackIds } : c,
      ),
    );
    if (!window.api) return;
    setCollections(
      await window.api.reorderCollectionTracks(collectionId, orderedTrackIds),
    );
  }

  async function handleAddFolderToCollection(
    collectionId: number,
  ): Promise<void> {
    if (!window.api) return;
    const folder = await window.api.selectFolder();
    if (!folder) return;
    const matching = tracksUnder(tracks, folder);
    if (matching.length === 0) {
      showToast("No sounds found in the selected folder");
      return;
    }
    setCollections(
      await window.api.addTracksToCollection(
        collectionId,
        matching.map((t) => t.id),
      ),
    );
    showToast(`Added ${matching.length} sounds to the collection`);
  }

  async function handleShareCollection(collection: Collection): Promise<void> {
    if (!window.api) return;
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const paths = collection.trackIds
      .map((id) => byId.get(id)?.filePath)
      .filter((p): p is string => !!p);
    if (paths.length === 0) {
      showToast("No sounds to share");
      return;
    }
    await window.api.writeClipboardText(paths.join("\n"));
    showToast(`Copied ${paths.length} file paths to clipboard`);
  }

  function handleSearchInCollection(collection: Collection): void {
    setSelectedCollection(collection.id);
    setSelectedFolder(null);
    setShowStarredOnly(false);
    searchInputRef.current?.focus();
  }

  function handleSearchInLibrary(library: Library): void {
    setSelectedFolder(library.rootPath);
    setSelectedCollection(null);
    setShowStarredOnly(false);
    searchInputRef.current?.focus();
  }

  function handleCheckOnlyLibrary(library: Library): void {
    setSelectedFolder(library.rootPath);
    setSelectedCollection(null);
    setShowStarredOnly(false);
  }

  async function handleScanNewFiles(library: Library): Promise<void> {
    if (!window.api) return;
    setScanning(true);
    try {
      const {
        libraries: allLibs,
        tracks: allTracks,
        addedCount,
      } = await window.api.scanNewFiles(library.id, library.rootPath);
      setLibraries(allLibs);
      setTracks(allTracks);
      showToast(
        addedCount > 0 ? `Added ${addedCount} new files` : "No new files",
      );
    } catch (err) {
      showToast(
        `Failed to scan for new files: ${(err as Error)?.message ?? "unknown error"}`,
      );
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  }

  async function handleShowInExplorer(library: Library): Promise<void> {
    await window.api?.showInExplorer(library.rootPath);
  }

  // 수동 "Refresh / Rescan" — 실시간 감시가 켜져 있어도, 사용자가 원할 때 해당 라이브러리
  // 폴더 하나만 즉시 재확인. scanLibrary는 mtime/size가 그대로인 파일은 건너뛰므로 대용량
  // 폴더에서도 증분으로 동작한다(전체 앱 재인덱싱이 아님).
  async function handleRescanLibrary(library: Library): Promise<void> {
    if (!window.api) return;
    setScanning(true);
    try {
      const { libraries: allLibs, tracks: allTracks } =
        await window.api.rescanLibrary(library.rootPath);
      setLibraries(allLibs);
      setTracks(allTracks);
      showToast("Rescanned");
    } catch (err) {
      showToast(`Rescan failed: ${(err as Error)?.message ?? "unknown error"}`);
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  }

  async function handleRefreshAllLibraries(): Promise<void> {
    if (!window.api) return;
    if (libraries.length === 0) {
      showToast("No libraries to refresh");
      return;
    }
    setScanning(true);
    try {
      const { libraries: allLibs, tracks: allTracks } =
        await window.api.refreshAllLibraries();
      setLibraries(allLibs);
      setTracks(allTracks);
      showToast("Library refreshed");
    } catch (err) {
      showToast(
        `Refresh failed: ${(err as Error)?.message ?? "unknown error"}`,
      );
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  }

  async function handleAnalyzeLibrary(library: Library): Promise<void> {
    if (!window.api) return;
    showToast("Analyzing sounds...");
    const { libraries: allLibs, analyzedCount } =
      await window.api.analyzeLibrary(library.id);
    setLibraries(allLibs);
    showToast(`Analyzed ${analyzedCount} tracks`);
  }

  function handleRenameLibrary(library: Library): void {
    setNamePrompt({
      title: "Rename library",
      defaultValue: library.name,
      confirmLabel: "Rename",
      onSubmit: async (name) => {
        if (window.api)
          setLibraries(await window.api.renameLibrary(library.id, name));
        setNamePrompt(null);
      },
    });
  }

  // 사이드바 노드가 라이브러리 루트인지(하위 폴더가 아니라) 판정
  function isLibraryRoot(node: FolderNode, library: Library): boolean {
    return norm(node.path) === norm(library.rootPath);
  }

  // ✕ 제거 — 라이브러리 루트면 라이브러리 제거, 하위 폴더면 그 폴더 하위 트랙만 인덱스에서 제거.
  function handleRemoveNode(node: FolderNode, library: Library): void {
    if (isLibraryRoot(node, library)) {
      if (
        confirm(
          `"${node.name}" 라이브러리를 제거할까요? (실제 파일은 삭제되지 않습니다)`,
        )
      )
        void handleRemoveLibrary(library.id);
    } else {
      void handleRemoveFolder(node, library);
    }
  }

  // 우클릭 — 라이브러리 루트면 라이브러리 메뉴, 하위 폴더면 폴더 메뉴.
  function handleNodeContextMenu(
    e: React.MouseEvent,
    node: FolderNode,
    library: Library,
  ): void {
    if (isLibraryRoot(node, library)) {
      setLibraryMenu({ x: e.clientX, y: e.clientY, library });
    } else {
      setFolderMenu({ x: e.clientX, y: e.clientY, node, library });
    }
  }

  // 하위 폴더 제거 — 폴더 하위 트랙을 인덱스에서만 제거(실제 파일 보존). 선택/탭도 정리.
  async function handleRemoveFolder(
    node: FolderNode,
    library: Library,
  ): Promise<void> {
    if (!window.api) return;
    if (
      !confirm(
        `"${node.name}" 폴더의 사운드 ${node.trackCount.toLocaleString()}개를 라이브러리에서 제거할까요? (실제 파일은 삭제되지 않습니다)`,
      )
    )
      return;
    const { libraries: allLibs, tracks: allTracks } =
      await window.api.removeFolder(library.id, node.path);
    setLibraries(allLibs);
    setTracks(allTracks);
    // selectedFolder는 활성 탭의 folder에서 파생되므로, 탭들을 정리하면 선택도 함께 풀린다.
    const prefix = norm(node.path) + "/";
    setTabs((prev) =>
      prev.map((t) =>
        t.folder && (norm(t.folder) + "/").startsWith(prefix)
          ? { ...t, folder: null }
          : t,
      ),
    );
    showToast(
      `Removed ${node.trackCount.toLocaleString()} sounds from library`,
    );
  }

  // 하위 폴더 이름변경 — 실제 디스크 폴더를 리네임하고 하위 트랙 경로를 갱신. 트리가 경로에서
  // 파생되므로 이름 변경을 영속하려면 실제 폴더를 바꿔야 한다. 성공 후 선택/탭을 새 경로로 재지정.
  function handleRenameFolder(
    libraryId: number,
    folderPath: string,
    currentName: string,
  ): void {
    setNamePrompt({
      title: "Rename folder",
      defaultValue: currentName,
      confirmLabel: "Rename",
      onSubmit: async (name) => {
        setNamePrompt(null);
        if (!window.api) return;
        const trimmed = name.trim();
        if (!trimmed || trimmed === currentName) return;
        try {
          const res = await window.api.renameFolder(
            libraryId,
            folderPath,
            trimmed,
          );
          if (!res) return;
          setLibraries(res.libraries);
          setTracks(res.tracks);
          const oldNorm = norm(folderPath);
          const newNorm =
            oldNorm.slice(0, oldNorm.length - currentName.length) + trimmed;
          const remap = (p: string): string => {
            const n = norm(p);
            if (n === oldNorm) return newNorm;
            if ((n + "/").startsWith(oldNorm + "/"))
              return newNorm + n.slice(oldNorm.length);
            return p;
          };
          // selectedFolder는 활성 탭 folder에서 파생 — 탭들을 새 경로로 재지정하면 선택도 따라온다.
          setTabs((prev) =>
            prev.map((t) =>
              t.folder ? { ...t, folder: remap(t.folder) } : t,
            ),
          );
          showToast(`Renamed folder (${res.renamed.toLocaleString()} sounds)`);
        } catch (err) {
          showToast(
            `Rename failed: ${(err as Error)?.message ?? "unknown error"}`,
          );
        }
      },
    });
  }

  async function handleToggleMonitor(library: Library): Promise<void> {
    if (!window.api) return;
    const next = !library.monitor;
    setLibraries(
      await window.api.setLibraryMonitor(library.id, library.rootPath, next),
    );
    showToast(next ? "Monitoring enabled" : "Monitoring disabled");
  }

  // ?�이브러리별 ?�더 ?�리
  // 전체 트랙이 로드되기 전에는 메인이 만들어 준 트리(serverTrees)를 그대로 쓰고, 로드가
  // 끝나면 tracks에서 파생한 트리로 전환한다 — 후자는 watcher의 추가/삭제까지 실시간 반영한다.
  const derivedTrees = useMemo(
    () =>
      tracksLoaded
        ? libraries.map((lib) => ({
            library: lib,
            node: buildFolderTree(
              tracks.filter((t) => t.libraryId === lib.id),
              lib.rootPath,
            ),
          }))
        : null,
    [libraries, tracks, tracksLoaded],
  );
  const trees = derivedTrees ?? serverTrees;
  // 루트(진입) ?�면 그리?�에 보일 ?�더 = 모든 ?�이브러리의 최상???�더
  const rootFolders = useMemo(
    () => trees.flatMap((t) => t.node.children),
    [trees],
  );
  // Current selected library for the breadcrumb and shortcuts
  const currentLibrary = useMemo(() => {
    if (!selectedFolder) return null;
    return (
      libraries.find((l) =>
        norm(selectedFolder).startsWith(norm(l.rootPath)),
      ) ?? null
    );
  }, [selectedFolder, libraries]);

  // 탭에 표시할 이름: 최상위 라이브러리명이 아니라 지금 보고 있는 폴더명.
  function tabLabel(tab: WorkspaceTab): string {
    if (tab.collection != null) {
      return (
        collections.find((c) => c.id === tab.collection)?.name ?? "Collection"
      );
    }
    if (tab.folder) {
      return norm(tab.folder).split("/").filter(Boolean).pop() ?? "Folder";
    }
    return "All Sounds";
  }

  async function handleOpenFolder(folderPath?: string): Promise<void> {
    if (!window.api) return;
    // onClick 등에서 이벤트 객체가 그대로 넘어오는 경우가 있어(문자열 경로가 아님),
    // 그대로 scanLibrary로 보내면 IPC 직렬화가 "An object could not be cloned"로 실패한다.
    // 문자열 경로가 아니면 무시하고 폴더 선택 다이얼로그를 연다.
    const folder =
      typeof folderPath === "string"
        ? folderPath
        : await window.api.selectFolder();
    if (!folder) return;
    setScanning(true);
    try {
      // ?�더 추�? = ?�적. ?�캔 ???�체�??�시 받아 반영(기존 ?�이브러�??��?)
      const { libraries: allLibs, tracks: allTracks } =
        await window.api.scanLibrary(folder);
      setLibraries(allLibs);
      setTracks(allTracks);
      // 라이브러리를 추가하면 그 루트를 연 탭을 새로 띄운다(첫 실행 시 유일한 탭 생성 경로)
      const tab = { ...newTab(), folder };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    } catch (err) {
      showToast(
        `Failed to scan folder: ${(err as Error)?.message ?? "unknown error"}`,
      );
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  }

  function hasExternalFileDrag(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  function getDroppedPaths(e: React.DragEvent): string[] {
    return Array.from(e.dataTransfer.files)
      .map(
        (file) =>
          window.api?.getPathForFile(file) ??
          (file as File & { path?: string }).path,
      )
      .filter((path): path is string => Boolean(path));
  }

  function handleAppDragEnter(e: React.DragEvent): void {
    if (!hasExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setFolderDragDepth((depth) => depth + 1);
  }

  function handleAppDragOver(e: React.DragEvent): void {
    if (!hasExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleAppDragLeave(e: React.DragEvent): void {
    if (!hasExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setFolderDragDepth((depth) => Math.max(0, depth - 1));
  }

  async function handleAppDrop(e: React.DragEvent): Promise<void> {
    if (!hasExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setFolderDragDepth(0);
    if (!window.api) return;

    const droppedPaths = getDroppedPaths(e);
    const folderPaths: string[] = [];
    for (const path of droppedPaths) {
      if (await window.api.isDirectory(path)) folderPaths.push(path);
    }
    if (folderPaths.length === 0) {
      showToast("Drop a Windows folder to add it to the library");
      return;
    }

    for (const folder of folderPaths) {
      await handleOpenFolder(folder);
    }
    if (folderPaths.length > 1) {
      showToast(`Added ${folderPaths.length} folders to the library`);
    }
  }

  async function handleRemoveLibrary(id: number): Promise<void> {
    if (!window.api) return;
    const { libraries: allLibs, tracks: allTracks } =
      await window.api.removeLibrary(id);
    setLibraries(allLibs);
    setTracks(allTracks);
    // 사라진 라이브러리 하위를 가리키던 탭은 모두 "All Sounds"로 되돌린다
    setTabs((prev) =>
      prev.map((t) =>
        t.folder &&
        !allLibs.some((l) => norm(t.folder!).startsWith(norm(l.rootPath)))
          ? { ...t, folder: null }
          : t,
      ),
    );
    setSelectedTrack((prev) => (prev && prev.libraryId === id ? null : prev));
  }

  async function handleUpdateTrackMetadata(
    trackId: number,
    patch: TrackMetadataPatch,
  ): Promise<void> {
    if (!window.api) return;
    const updated = await window.api.updateTrackMetadata(trackId, patch);
    if (!updated) return;
    setTracks((prev) => prev.map((t) => (t.id === trackId ? updated : t)));
    setSelectedTrack((prev) => (prev && prev.id === trackId ? updated : prev));
  }

  // PlayerBar가 loop 구간/마커를 DB에 저장한 뒤 갱신된 Track을 돌려주면 in-memory 상태에도
  // 반영한다 — 그래야 세션 중 다른 트랙을 거쳐 돌아와도 stale Track이 방금 저장한 값을
  // 덮어쓰지 않는다.
  function handleTrackPersisted(track: Track): void {
    setTracks((prev) => prev.map((t) => (t.id === track.id ? track : t)));
    setSelectedTrack((prev) => (prev && prev.id === track.id ? track : prev));
  }

  async function handleBatchUpdateMetadata(
    trackIds: number[],
    patch: TrackMetadataPatch,
  ): Promise<void> {
    if (!window.api) return;
    const updatedTracks = await window.api.batchUpdateTrackMetadata(
      trackIds,
      patch,
    );
    const byId = new Map(updatedTracks.map((t) => [t.id, t]));
    setTracks((prev) => prev.map((t) => byId.get(t.id) ?? t));
    setSelectedTrack((prev) =>
      prev && byId.has(prev.id) ? byId.get(prev.id)! : prev,
    );
    showToast(`Updated ${updatedTracks.length} sounds`);
  }

  async function handleToggleStar(track: Track): Promise<void> {
    const starred = window.api
      ? await window.api.toggleStar(track.id)
      : !track.starred;
    setTracks((prev) =>
      prev.map((t) => (t.id === track.id ? { ...t, starred } : t)),
    );
    setSelectedTrack((prev) =>
      prev && prev.id === track.id ? { ...prev, starred } : prev,
    );
  }

  // 우클릭 메뉴 "Browse this folder" — 사이드바/리스트를 해당 트랙이 들어있는 폴더로 이동
  function handleBrowseFolder(track: Track): void {
    const dir = norm(track.filePath).split("/").slice(0, -1).join("/");
    setSelectedFolder(dir);
    setSelectedCollection(null);
    setShowStarredOnly(false);
  }

  // 우클릭 메뉴 / Ctrl+E "Rename" — 실제 파일을 같은 폴더 안에서 리네임
  function handleRenameTrackFile(track: Track): void {
    const dot = track.filename.lastIndexOf(".");
    const base = dot > 0 ? track.filename.slice(0, dot) : track.filename;
    setNamePrompt({
      title: "Rename file",
      defaultValue: base,
      confirmLabel: "Rename",
      onSubmit: async (name) => {
        if (window.api) {
          try {
            const { filePath, filename } = await window.api.renameTrackFile(
              track.id,
              track.filePath,
              name,
            );
            setTracks((prev) =>
              prev.map((t) =>
                t.id === track.id ? { ...t, filePath, filename } : t,
              ),
            );
            setSelectedTrack((prev) =>
              prev && prev.id === track.id
                ? { ...prev, filePath, filename }
                : prev,
            );
            showToast("Renamed");
          } catch (err) {
            showToast(
              `Rename failed: ${(err as Error)?.message ?? "unknown error"}`,
            );
          }
        }
        setNamePrompt(null);
      },
    });
  }

  // 우클릭 메뉴 / Backspace "Remove" — 실제 IPC 호출은 ResultList가 수행하고,
  // 여기서는 로컬 상태(트랙 목록/선택)만 정리한다
  function handleRemoveTrackFromLibrary(track: Track): void {
    setTracks((prev) => prev.filter((t) => t.id !== track.id));
    setSelectedTrack((prev) => (prev && prev.id === track.id ? null : prev));
    setSelectedIds((prev) => {
      if (!prev.has(track.id)) return prev;
      const next = new Set(prev);
      next.delete(track.id);
      return next;
    });
    showToast("Removed from library");
  }

  async function handleSelectTrack(track: Track): Promise<void> {
    setSelectedTrack(track);
    setSelectedIds(new Set([track.id])); // ?�일 ?�택?�로 초기??    // Soundly처럼 미리?�기???�운?�는 ?�색(previewed) 처리 ??tracks 배열은 건드리지 않고
    // previewedIds만 갱신(visibleTracks 재정렬을 유발하지 않음)
    setPreviewedIds((prev) =>
      prev.has(track.id) ? prev : new Set(prev).add(track.id),
    );
    // 마지막 재생 시각 기록은 재생과 무관한 부수 작업이다. await 하면 메인 프로세스 왕복이
    // 트랙 선택 경로에 끼어들어 플레이어의 로드가 그만큼 늦어지므로 기다리지 않는다.
    if (window.api) void window.api.updateLastPlayed(track.id).catch(() => {});
  }

  const activeCollection =
    collections.find((c) => c.id === selectedCollection) ?? null;

  // CollectionHero 통계(전체 개수/재생시간/카테고리 구성)는 검색·즐겨찾기 필터와 무관하게
  // 컬렉션 전체를 기준으로 보여줘야 하므로 visibleTracks와 별도로 계산한다
  const collectionMembers = useMemo(() => {
    if (!activeCollection) return [];
    const byId = new Map(tracks.map((t) => [t.id, t]));
    return activeCollection.trackIds
      .map((id) => byId.get(id))
      .filter((t): t is Track => !!t);
  }, [activeCollection, tracks]);

  // 사용자가 정렬/셔플을 걸지 않은 "직접 순서" 상태에서만 컬렉션 내 드래그 재정렬을 허용한다 —
  // 정렬된 뷰에서 순서를 바꾸면 눈에 보이는 순서와 실제 저장 순서가 어긋나 보일 수 있어서다
  const collectionReorderable =
    Boolean(activeCollection) && !shuffled && sort.key === null;

  const visibleTracks = useMemo(() => {
    // 탭이 없는 빈 워크스페이스에서는 아무 트랙도 없다. 렌더뿐 아니라 여기서 막아야
    // 재생 큐(next/prev)와 전체 선택(Ctrl+A)도 전체 라이브러리를 훑지 않는다.
    if (!activeTab) return [];
    let base: Track[];
    if (activeCollection) {
      const byId = new Map(tracks.map((t) => [t.id, t]));
      base = activeCollection.trackIds
        .map((id) => byId.get(id))
        .filter((t): t is Track => !!t);
    } else {
      base = selectedFolder ? tracksUnder(tracks, selectedFolder) : tracks;
    }
    if (showStarredOnly) base = base.filter((t) => t.starred);
    if (search.trim()) {
      const q = search.toLowerCase();
      base = base.filter(
        (t) =>
          t.filename.toLowerCase().includes(q) ||
          (t.category ?? "").toLowerCase().includes(q) ||
          (t.subcategory ?? "").toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    if (subSearch.trim()) {
      const q = subSearch.toLowerCase();
      base = base.filter(
        (t) =>
          t.filename.toLowerCase().includes(q) ||
          (t.category ?? "").toLowerCase().includes(q) ||
          (t.subcategory ?? "").toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    // shuffled�?리스???�시 ?�서 ?�체�??�고, ?�니�??�렬 ?�태(?�는 기본 ?�서)�??�시
    base = shuffled
      ? shuffleTracks(base, shuffleSeed)
      : sortTracks(base, sort.key, sort.dir, { libraries, publisherRule });
    return base;
  }, [
    activeTab,
    tracks,
    selectedFolder,
    activeCollection,
    showStarredOnly,
    search,
    subSearch,
    sort,
    libraries,
    shuffled,
    shuffleSeed,
  ]);

  const isFiltering = Boolean(
    search.trim() || showStarredOnly || activeCollection,
  );
  // ?�더�??�택?�면(=selectedFolder ?�음) ?�위 ?�더가 ?�어???�운?��? ?��?�?보여�?(Soundly 방식).
  // ?�더 카드 그리?�는 최상??진입 ?�면(?�무 ?�더???�택 ?????�서�??�시.
  const showGrid =
    view === "grid" &&
    !isFiltering &&
    !selectedFolder &&
    rootFolders.length > 0;

  function selectRelative(delta: number): void {
    // Shuffle mode still moves through the visible track list
    if (visibleTracks.length === 0) return;
    const idx = visibleTracks.findIndex((t) => t.id === selectedTrack?.id);
    let next = idx === -1 ? 0 : idx + delta;
    next = Math.max(0, Math.min(visibleTracks.length - 1, next));
    void handleSelectTrack(visibleTracks[next]);
  }

  // Shuffle 버튼 ?�릭 = ?��????�니??"지�?리스?��? ???�서�??�시 ?�기"
  function handleShuffleClick(): void {
    setShuffled(true);
    setShuffleSeed(Date.now());
  }
  // Shortcut navigation library lookup
  const shortcutLibrary = useMemo(() => {
    if (currentLibrary) return currentLibrary;
    if (selectedTrack)
      return libraries.find((l) => l.id === selectedTrack.libraryId) ?? null;
    return libraries[0] ?? null;
  }, [currentLibrary, selectedTrack, libraries]);

  function selectAllVisible(): void {
    if (visibleTracks.length === 0) return;
    setSelectedIds(new Set(visibleTracks.map((t) => t.id)));
    showToast(`${visibleTracks.length.toLocaleString()} selected`);
  }

  async function removeTracksFromActiveCollection(
    ids: number[],
  ): Promise<void> {
    if (!window.api || !activeCollection) return;
    let cols = collections;
    for (const id of ids) {
      cols = await window.api.removeTrackFromCollection(
        activeCollection.id,
        id,
      );
    }
    setCollections(cols);
    showToast(`Removed ${ids.length} sounds from the collection`);
  }

  // Delete: 컬렉??보기?�서???�택 ?�랙??컬렉?�에???�거. (?�이브러�?보기?�서???�제 ?�일??  // ??��?��? ?�으므�??�전?�게 ?�무 ?�작???��? ?�음)
  function handleDeleteShortcut(): void {
    if (activeCollection) {
      const ids =
        selectedIds.size > 0
          ? [...selectedIds]
          : selectedTrack
            ? [selectedTrack.id]
            : [];
      if (ids.length > 0) void removeTracksFromActiveCollection(ids);
    } else if (selectedCollection == null && showStarredOnly) {
      // 즐겨찾기 보기?�서 Delete = ?�택 ?�랙 즐겨찾기 ?�제
      if (selectedTrack?.starred) void handleToggleStar(selectedTrack);
    }
  }
  // F2: 활성 컬렉션 → 컬렉션 이름변경; 라이브러리 루트 선택 → 라이브러리(표시명) 변경;
  // 하위 폴더 선택 → 실제 폴더 이름변경(디스크 rename + 경로 갱신).
  function handleRenameShortcut(): void {
    if (activeCollection) {
      handleRenameCollection(activeCollection);
      return;
    }
    if (!currentLibrary || !selectedFolder) return;
    if (norm(selectedFolder) === norm(currentLibrary.rootPath)) {
      handleRenameLibrary(currentLibrary);
    } else {
      const name = norm(selectedFolder).split("/").pop() ?? selectedFolder;
      handleRenameFolder(currentLibrary.id, selectedFolder, name);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (target?.isContentEditable ?? false);
      const mod = e.ctrlKey || e.metaKey;

      // ?�?� ?�커???�치?� 무�??�게 ?�작 ?�?�
      // Ctrl+F: main search / Ctrl+Shift+F: sub search
      if (mod && (e.key === "f" || e.key === "F")) {
        const el = e.shiftKey ? subSearchRef.current : searchInputRef.current;
        el?.focus();
        el?.select();
        return;
      }
      // Esc: ?��? + 구간 ?�택 ?�제 (?�력 중이�?블러)
      if (e.key === "Escape") {
        playerRef.current?.stopAndClear();
        setSelectedIds((prev) => (prev.size > 0 ? new Set() : prev));
        if (inEditable) target?.blur();
        return;
      }

      if (mod && (e.key === "a" || e.key === "A")) {
        if (inEditable) return; // ?�풋 ???�스???�체 ?�택?� 기본 ?�작 ?��?
        e.preventDefault();
        selectAllVisible();
        return;
      }
      if (mod && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        if (shortcutLibrary) void handleScanNewFiles(shortcutLibrary);
        return;
      }
      if (mod && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        const path = selectedFolder ?? shortcutLibrary?.rootPath;
        if (path) void window.api?.showInExplorer(path);
        return;
      }
      if (mod && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        if (selectedTrack) handleRenameTrackFile(selectedTrack);
        return;
      }
      // �???Ctrl/Meta 조합?� 브라?��?/OS 기본 ?�작??맡�?
      if (mod) return;
      // ?�력창에???�집 중이�?(Ctrl 조합???�닌) ?�머지 ?�축?�는 ?�스???�력??방해?��? ?�도�?무시
      if (inEditable) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          playerRef.current?.playPause();
          break;
        case "Enter":
          e.preventDefault();
          playerRef.current?.play();
          break;
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault();
          selectRelative(1);
          break;
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault();
          selectRelative(-1);
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          handleDeleteShortcut();
          break;
        case "F2":
          e.preventDefault();
          handleRenameShortcut();
          break;
        case "s":
        case "S":
          handleShuffleClick();
          break;
        case "f":
        case "F":
          if (selectedTrack) void handleToggleStar(selectedTrack);
          break;
        case "l":
        case "L":
          playerRef.current?.toggleLoopRegion();
          break;
        case "m":
        case "M":
          playerRef.current?.addMarker();
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    visibleTracks,
    selectedTrack,
    activeCollection,
    selectedCollection,
    showStarredOnly,
    currentLibrary,
    shortcutLibrary,
    selectedFolder,
    selectedIds,
    collections,
  ]);

  // 브레?�크?? ?�이브러리명 + ?�택 ?�더 ?�그먼트 (Home = 루트 그리??
  const crumbs = useMemo(() => {
    if (!currentLibrary || !selectedFolder) return [];
    const root = norm(currentLibrary.rootPath);
    const list: Array<{ label: string; path: string }> = [
      { label: currentLibrary.name, path: currentLibrary.rootPath },
    ];
    const rel = norm(selectedFolder).slice(root.length).replace(/^\/+/, "");
    let acc = root;
    rel
      .split("/")
      .filter(Boolean)
      .forEach((seg) => {
        acc = `${acc}/${seg}`;
        list.push({ label: seg, path: acc });
      });
    return list;
  }, [currentLibrary, selectedFolder]);

  return (
    <div
      className={`app${folderDragDepth > 0 ? " app--folder-drag" : ""}`}
      style={{
        gridTemplateRows: `var(--menubar-h) var(--topbar-h) 1fr`,
      }}
      onDragEnter={handleAppDragEnter}
      onDragOver={handleAppDragOver}
      onDragLeave={handleAppDragLeave}
      onDrop={(e) => void handleAppDrop(e)}
    >
      <MenuBar
        onAddFolder={handleOpenFolder}
        onToggleMeta={() => setShowMeta((v) => !v)}
        view={view}
        onSetView={setView}
        onShowShortcuts={() => setShowShortcuts(true)}
        onOpenPublisherSettings={() => setPublisherSettingsOpen(true)}
        onFindDuplicates={() => setDuplicatesOpen(true)}
        dockMode={dockMode}
        onUndock={handleToggleDockMode}
      />

      {!dockMode && (
        <div className="topbar">
          <div className="topbar__search-wrap">
            <svg
              className="topbar__search-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              ref={searchInputRef}
              className="topbar__search"
              placeholder="Search sounds"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* 탭 = 브라우징 위치. 각 탭은 그 탭에서 선택한 라이브러리(또는 컬렉션) 이름을 단다 */}
          <div className="tabs">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`tab${tab.id === activeTabId ? " tab--active" : ""}`}
                onClick={() => setActiveTabId(tab.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) closeTab(tab.id); // 가운데 클릭으로 닫기
                }}
                title={tab.folder ?? tabLabel(tab)}
              >
                <span className="tab__label">{tabLabel(tab)}</span>
                <span
                  className="tab__close"
                  onClick={(e) => {
                    e.stopPropagation(); // 닫기 클릭이 탭 활성화로 새어나가지 않게
                    closeTab(tab.id);
                  }}
                  title="탭 닫기"
                >
                  ×
                </span>
              </div>
            ))}
            <button className="tab__add" onClick={addTab} title="새 탭">
              +
            </button>
          </div>

          <div className="topbar__actions">
            <AccentPicker accent={accent} onChange={setAccent} />
            <button
              className="icon-btn"
              title="Shuffle"
              onClick={handleShuffleClick}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 3h5v5" />
                <path d="M4 20L21 3" />
                <path d="M21 16v5h-5" />
                <path d="M15 15l6 6" />
                <path d="M4 4l5 5" />
              </svg>
            </button>
            <div
              className="topbar__subsearch-wrap"
              title="Filter results as you type"
            >
              <svg
                className="topbar__subsearch-icon"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                ref={subSearchRef}
                className="topbar__subsearch"
                placeholder="Filter sounds"
                value={subSearch}
                onChange={(e) => setSubSearch(e.target.value)}
              />
            </div>
            <button
              className={`icon-btn${showMeta ? " icon-btn--active" : ""}`}
              title="Metadata panel"
              onClick={() => setShowMeta((v) => !v)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M15 4v16" />
              </svg>
            </button>
            <button
              className="icon-btn"
              title="Dock mode — 화면 하단의 얇은 트랜스포트 바로 축소"
              onClick={handleToggleDockMode}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="12" rx="1.5" />
                <path d="M3 20h18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div
        className={`main${dockMode ? " main--dock" : ""}`}
        style={
          dockMode
            ? { gridTemplateColumns: "1fr", gridTemplateRows: "100%" }
            : {
                gridTemplateColumns: showMeta
                  ? `${sidebarWidth}px 1fr ${metaWidth}px`
                  : `${sidebarWidth}px 1fr`,
                gridTemplateRows: `1fr ${playerHeight}px`,
              }
        }
      >
        {/* ?�이?�바 ??조절 ?�들 ???�레?�어 ?�까지 ?�려가�??�레?�어 컨트�??��??�데�?            가로�?르는 것처??보이므�? 콘텐�????�쪽)까�?�??�도�??�이�??�한?�다 */}
        {!dockMode && (
          <div
            className="resizer resizer--left"
            style={{ left: sidebarWidth, bottom: playerHeight }}
            onMouseDown={(e) => startPanelResize(e, "sidebar")}
          />
        )}
        {!dockMode && showMeta && (
          <div
            className="resizer resizer--right"
            style={{ right: metaWidth }}
            onMouseDown={(e) => startPanelResize(e, "meta")}
          />
        )}
        {!dockMode && (
          <Sidebar
            trees={trees}
            tracks={tracks}
            onOpenFolder={handleOpenFolder}
            onRefreshLocal={() => void handleRefreshAllLibraries()}
            onRemoveNode={handleRemoveNode}
            selectedFolder={selectedFolder}
            onSelectFolder={(p) => {
              setSelectedFolder(p);
              setSelectedCollection(null);
              setShowStarredOnly(false);
            }}
            collections={collections}
            selectedCollection={selectedCollection}
            onSelectCollection={(id) => {
              setSelectedCollection(id);
              setSelectedFolder(null);
              setShowStarredOnly(false);
            }}
            onCreateCollection={handleCreateCollection}
            onDeleteCollection={handleDeleteCollection}
            showStarredOnly={showStarredOnly}
            onToggleStarredView={() => {
              setShowStarredOnly((v) => !v);
              setSelectedCollection(null);
            }}
            onSelectLocalRoot={() => {
              // Local ?�릭 = 최상??진입?? 모든 ?�택 ?�제 + ?�더 그리???�면?�로
              setSelectedFolder(null);
              setSelectedCollection(null);
              setShowStarredOnly(false);
              setSearch("");
              setSubSearch("");
              setView("grid");
            }}
            onCollectionContextMenu={(e, collection) =>
              setCollectionMenu({ x: e.clientX, y: e.clientY, collection })
            }
            onNodeContextMenu={handleNodeContextMenu}
            scanning={scanning}
            scanProgress={scanProgress}
            watchStatus={watchStatus}
          />
        )}

        {!dockMode && (
          <div className="content-wrap">
            {!activeTab ? (
              // 탭이 하나도 없는 빈 워크스페이스 — 루트 폴더/전체 트랙을 흘리지 않고
              // 안내만 보여준다. All Sounds를 열면 전체 사운드 탭이 생긴다.
              <div className="empty-state empty-workspace">
                <div className="empty-state__big">
                  열린 워크스페이스가 없습니다
                </div>
                <div>
                  사이드바에서 폴더나 컬렉션을 고르거나, 아래에서 All Sounds를
                  열어 전체 사운드를 둘러보세요.
                </div>
                <button className="empty-workspace__btn" onClick={addTab}>
                  All Sounds 열기
                </button>
              </div>
            ) : (
              <>
                {activeCollection && (
                  <CollectionHero
                    collection={activeCollection}
                    tracks={collectionMembers}
                  />
                )}
                <div className="breadcrumb">
                  <span
                    className={`breadcrumb__link${!selectedFolder && !activeCollection ? " breadcrumb__link--current" : ""}`}
                    onClick={() => {
                      setSelectedFolder(null);
                      setSelectedCollection(null);
                    }}
                  >
                    Home
                  </span>
                  {activeCollection && (
                    <span className="breadcrumb__seg">
                      <span className="breadcrumb__sep">/</span>
                      <span className="breadcrumb__link breadcrumb__link--current">
                        ??{activeCollection.name}
                      </span>
                    </span>
                  )}
                  {crumbs.map((c, i) => (
                    <span key={i} className="breadcrumb__seg">
                      <span className="breadcrumb__sep">/</span>
                      <span
                        className={`breadcrumb__link${i === crumbs.length - 1 ? " breadcrumb__link--current" : ""}`}
                        onClick={() => setSelectedFolder(c.path)}
                      >
                        {c.label}
                      </span>
                    </span>
                  ))}
                  <span className="breadcrumb__count">
                    {showGrid
                      ? `${rootFolders.length} folders`
                      : !tracksLoaded
                        ? "사운드 로딩 중…"
                        : `${visibleTracks.length} sounds`}
                  </span>
                </div>

                {/* 폴더 트리는 즉시 뜨지만 전체 트랙은 백그라운드로 로드된다 — 아직 로드가
                    끝나지 않아 리스트가 비어 보일 때, 사용자가 "폴더가 비었다"고 오해하지
                    않도록 로딩 중임을 알린다. */}
                {!tracksLoaded && !showGrid && visibleTracks.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-state__big">사운드 로딩 중…</div>
                    <div>
                      폴더는 준비됐어요. 전체 사운드 목록을 불러오는 중입니다 —
                      곧 이 폴더의 사운드가 표시됩니다.
                    </div>
                  </div>
                )}

                {showGrid ? (
                  <FolderGrid
                    folders={rootFolders}
                    onOpenFolder={(p) => setSelectedFolder(p)}
                  />
                ) : (
                  <ResultList
                    tracks={visibleTracks}
                    libraries={libraries}
                    collections={collections}
                    selectedTrackId={selectedTrack?.id ?? null}
                    selectedIds={selectedIds}
                    onSelectTrack={handleSelectTrack}
                    onToggleStar={handleToggleStar}
                    onAddToCollection={handleAddToCollection}
                    sortKey={sort.key}
                    sortDir={sort.dir}
                    onSort={handleSort}
                    publisherRule={publisherRule}
                    previewedIds={previewedIds}
                    reorderable={collectionReorderable}
                    onReorder={
                      activeCollection
                        ? (ids) =>
                            void handleReorderCollection(
                              activeCollection.id,
                              ids,
                            )
                        : undefined
                    }
                    onBrowseFolder={handleBrowseFolder}
                    onRenameTrack={handleRenameTrackFile}
                    onOpenMetadataPanel={() => setShowMeta(true)}
                    onRemoveTrack={handleRemoveTrackFromLibrary}
                    onNotify={showToast}
                    onBatchEdit={() => setBatchEditOpen(true)}
                    onCreateCollectionWith={(trackId) => {
                      setNamePrompt({
                        title: "New collection name",
                        onSubmit: async (name) => {
                          if (window.api) {
                            const cols =
                              await window.api.createCollection(name);
                            setCollections(cols);
                            const created = cols[cols.length - 1];
                            if (created)
                              await handleAddToCollection(created.id, trackId);
                          }
                          setNamePrompt(null);
                        },
                      });
                    }}
                  />
                )}
              </>
            )}
          </div>
        )}

        {!dockMode && showMeta && (
          <div className="right-panel" ref={rightPanelRef}>
            <div
              className="right-panel__meta"
              style={{ height: metaPanelHeight }}
            >
              <MetadataPanel
                track={selectedTrack}
                libraries={libraries}
                publisherRule={publisherRule}
                onToggleStar={handleToggleStar}
                onUpdateMetadata={(trackId, patch) =>
                  void handleUpdateTrackMetadata(trackId, patch)
                }
              />
            </div>
            <div className="right-panel__resizer right-panel__resizer--fixed" />
            <AnalysisPanel playerRef={playerRef} track={selectedTrack} />
          </div>
        )}

        {/* 리스???�레?�어 경계 ?�이 조절 ?�들 ???�이?�바+콘텐�???��지�?메�?/분석 ?�널
            컬럼?� ?�아?�로 ?�뉘지 ?�는 ?�나???�역?��?�?�?경계까�????�히지 ?�음) */}
        {!dockMode && (
          <div
            className="resizer-h"
            style={{ bottom: playerHeight, right: showMeta ? metaWidth : 0 }}
            onMouseDown={startPlayerResize}
          />
        )}

        {/* PlayerBar??Dock Mode ?��??�도 ??�� 마운?��??�유지??WaveSurfer ?�스?�스가
            그대�?살아?�어 ?�직 중인 ?�운?��? 도킹/�?도킹 ?�이 ?�기지 ?�는??*/}
        <PlayerBar
          ref={playerRef}
          track={selectedTrack}
          accent={accent}
          panelHeight={dockMode ? 92 : playerHeight}
          onPrev={() => selectRelative(-1)}
          onNext={() => selectRelative(1)}
          queueTracks={visibleTracks}
          dockMode={dockMode}
          onTrackPersisted={handleTrackPersisted}
        />
      </div>

      {namePrompt && (
        <NamePromptModal
          title={namePrompt.title}
          defaultValue={namePrompt.defaultValue}
          confirmLabel={namePrompt.confirmLabel}
          onSubmit={namePrompt.onSubmit}
          onCancel={() => setNamePrompt(null)}
        />
      )}

      {collectionMenu && (
        <ContextMenu
          x={collectionMenu.x}
          y={collectionMenu.y}
          onClose={() => setCollectionMenu(null)}
          items={[
            {
              key: "search",
              label: "Search in collection",
              onClick: () =>
                handleSearchInCollection(collectionMenu.collection),
            },
            {
              key: "addfolder",
              label: "Add folder",
              onClick: () =>
                void handleAddFolderToCollection(collectionMenu.collection.id),
            },
            {
              key: "rename",
              label: "Rename",
              onClick: () => handleRenameCollection(collectionMenu.collection),
            },
            {
              key: "share",
              label: "Share",
              onClick: () =>
                void handleShareCollection(collectionMenu.collection),
            },
            {
              key: "setcolor",
              label: "Set color",
              onClick: () =>
                setColorPicker({
                  x: collectionMenu.x,
                  y: collectionMenu.y,
                  collectionId: collectionMenu.collection.id,
                  color: collectionMenu.collection.color,
                }),
            },
            { key: "sep1", separator: true },
            {
              key: "delete",
              label: "Delete",
              danger: true,
              onClick: () =>
                void handleDeleteCollection(collectionMenu.collection.id),
            },
          ]}
        />
      )}

      {colorPicker && (
        <ColorPickerPopover
          x={colorPicker.x}
          y={colorPicker.y}
          color={colorPicker.color}
          onPick={(color) =>
            void handleSetCollectionColor(colorPicker.collectionId, color)
          }
          onClose={() => setColorPicker(null)}
        />
      )}

      {libraryMenu && (
        <ContextMenu
          x={libraryMenu.x}
          y={libraryMenu.y}
          onClose={() => setLibraryMenu(null)}
          width={240}
          items={[
            {
              key: "search",
              label: "Search in library",
              onClick: () => handleSearchInLibrary(libraryMenu.library),
            },
            {
              key: "checkonly",
              label: "Check only this library",
              onClick: () => handleCheckOnlyLibrary(libraryMenu.library),
            },
            {
              key: "scannew",
              label: "Scan for new files",
              onClick: () => void handleScanNewFiles(libraryMenu.library),
            },
            {
              key: "rescan",
              label: "Refresh / Rescan",
              onClick: () => void handleRescanLibrary(libraryMenu.library),
            },
            {
              key: "explorer",
              label: "Show in Explorer",
              onClick: () => void handleShowInExplorer(libraryMenu.library),
            },
            {
              key: "analyze",
              label: "Analyze for Find Similar",
              onClick: () => void handleAnalyzeLibrary(libraryMenu.library),
            },
            {
              key: "rename",
              label: "Rename",
              onClick: () => handleRenameLibrary(libraryMenu.library),
            },
            { key: "sep1", separator: true },
            {
              key: "remove",
              label: "Remove",
              danger: true,
              onClick: () => void handleRemoveLibrary(libraryMenu.library.id),
            },
          ]}
        />
      )}

      {folderMenu && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          onClose={() => setFolderMenu(null)}
          width={220}
          items={[
            {
              key: "search",
              label: "Search in this folder",
              onClick: () => {
                setSelectedFolder(folderMenu.node.path);
                setSelectedCollection(null);
                setShowStarredOnly(false);
                searchInputRef.current?.focus();
              },
            },
            {
              key: "explorer",
              label: "Show in Explorer",
              onClick: () =>
                void window.api?.showInExplorer(folderMenu.node.path),
            },
            {
              key: "rename",
              label: "Rename",
              onClick: () =>
                handleRenameFolder(
                  folderMenu.library.id,
                  folderMenu.node.path,
                  folderMenu.node.name,
                ),
            },
            { key: "sep1", separator: true },
            {
              key: "remove",
              label: "Remove",
              danger: true,
              onClick: () =>
                void handleRemoveFolder(folderMenu.node, folderMenu.library),
            },
          ]}
        />
      )}

      {showShortcuts && (
        <ShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}
      {duplicatesOpen && (
        <DuplicatesModal
          onClose={() => setDuplicatesOpen(false)}
          onRemoveTrack={handleRemoveTrackFromLibrary}
          onNotify={showToast}
        />
      )}
      {batchEditOpen && (
        <BatchEditModal
          count={selectedIds.size}
          onCancel={() => setBatchEditOpen(false)}
          onSubmit={(patch) => {
            setBatchEditOpen(false);
            void handleBatchUpdateMetadata([...selectedIds], patch);
          }}
        />
      )}
      {publisherSettingsOpen && (
        <PublisherSettingsModal
          value={publisherRule}
          onSave={handleSavePublisherRule}
          onCancel={() => setPublisherSettingsOpen(false)}
        />
      )}

      {folderDragDepth > 0 && (
        <div className="folder-drop-overlay" aria-hidden="true">
          <div className="folder-drop-overlay__panel">
            <svg
              width="34"
              height="34"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
              <path d="M12 11v5" />
              <path d="M9.5 13.5 12 11l2.5 2.5" />
            </svg>
            <div className="folder-drop-overlay__title">
              Drop folder to add library
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
