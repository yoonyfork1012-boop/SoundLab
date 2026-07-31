import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  Collection,
  Library,
  ScanProgress,
  ScanSummary,
  Track,
  TrackMetadataPatch,
  TracksChanged,
  WatchStatus,
} from "../shared/types";
import type { LibraryTree } from "../shared/folderTree";

// 스캔류 응답 — tracks는 실제로 바뀐 게 있을 때만 실려 온다(null이면 기존 목록 유지).
interface ScanResult {
  libraries: Library[];
  tracks: Track[] | null;
  summary: ScanSummary;
}

const api = {
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:selectFolder"),

  isDirectory: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke("file:isDirectory", filePath),

  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  scanLibrary: (rootPath: string): Promise<ScanResult> =>
    ipcRenderer.invoke("library:scan", rootPath),

  loadAll: (): Promise<{ libraries: Library[]; tracks: Track[] }> =>
    ipcRenderer.invoke("app:loadAll"),

  // 시작 시 사이드바 폴더 트리만 먼저 받아 즉시 그린다(전체 트랙은 loadAll로 백그라운드 로드).
  loadTree: (): Promise<{ libraries: Library[]; trees: LibraryTree[] }> =>
    ipcRenderer.invoke("app:loadTree"),

  // 초기 데이터 로드가 끝났음을 메인 프로세스에 알려 스플래시 창을 닫고 메인 창을 보여주게 함
  notifyReady: (): void => ipcRenderer.send("app:renderer-ready"),

  removeLibrary: (
    libraryId: number,
  ): Promise<{ libraries: Library[]; tracks: Track[] }> =>
    ipcRenderer.invoke("library:remove", libraryId),

  // 사이드바 하위 폴더: 인덱스에서만 제거(실제 파일 보존)
  removeFolder: (
    libraryId: number,
    folderPath: string,
  ): Promise<{ libraries: Library[]; tracks: Track[] }> =>
    ipcRenderer.invoke("folder:remove", libraryId, folderPath),

  // 사이드바 하위 폴더: 실제 디스크 폴더 리네임 + 하위 트랙 경로 갱신
  renameFolder: (
    libraryId: number,
    folderPath: string,
    newName: string,
  ): Promise<{
    libraries: Library[];
    tracks: Track[];
    renamed: number;
  } | null> =>
    ipcRenderer.invoke("folder:rename", libraryId, folderPath, newName),

  renameLibrary: (libraryId: number, name: string): Promise<Library[]> =>
    ipcRenderer.invoke("library:rename", libraryId, name),

  scanNewFiles: (libraryId: number, rootPath: string): Promise<ScanResult> =>
    ipcRenderer.invoke("library:scanNew", libraryId, rootPath),

  showInExplorer: (rootPath: string): Promise<void> =>
    ipcRenderer.invoke("library:showInExplorer", rootPath),

  // 수동 "Refresh / Rescan" — 선택한 라이브러리 폴더 하나만 다시 훑어 추가/삭제/변경 반영
  rescanLibrary: (rootPath: string): Promise<ScanResult> =>
    ipcRenderer.invoke("library:rescan", rootPath),

  // Local 옆 인덱싱 버튼 — 전체 라이브러리 증분 인덱싱(변경분만)
  refreshAllLibraries: (): Promise<ScanResult> =>
    ipcRenderer.invoke("library:refreshAll"),

  // 보조 메뉴 전용 — 증분 비교를 무시하고 라이브러리를 처음부터 전부 다시 분석
  fullReindexLibrary: (
    libraryId: number,
    rootPath: string,
  ): Promise<ScanResult> =>
    ipcRenderer.invoke("library:fullReindex", libraryId, rootPath),

  setLibraryMonitor: (
    libraryId: number,
    rootPath: string,
    on: boolean,
  ): Promise<Library[]> =>
    ipcRenderer.invoke("library:setMonitor", libraryId, rootPath, on),

  analyzeLibrary: (
    libraryId: number,
  ): Promise<{ libraries: Library[]; analyzedCount: number }> =>
    ipcRenderer.invoke("library:analyze", libraryId),

  onScanProgress: (
    callback: (progress: ScanProgress) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: ScanProgress,
    ): void => callback(progress);
    ipcRenderer.on("library:scanProgress", listener);
    return () => ipcRenderer.removeListener("library:scanProgress", listener);
  },

  onLibraryUpdated: (
    callback: (data: {
      libraries: Library[];
      tracks: Track[];
      summary?: ScanSummary;
    }) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { libraries: Library[]; tracks: Track[]; summary?: ScanSummary },
    ): void => callback(data);
    ipcRenderer.on("library:updated", listener);
    return () => ipcRenderer.removeListener("library:updated", listener);
  },

  // 백그라운드 스캔이 "변경 없음"으로 끝났을 때 — 인덱싱 표시만 끄면 된다.
  onScanDone: (callback: (summary: ScanSummary) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      summary: ScanSummary,
    ): void => callback(summary);
    ipcRenderer.on("library:scanDone", listener);
    return () => ipcRenderer.removeListener("library:scanDone", listener);
  },

  // 실시간 감시(watcher)가 한 배치에서 처리한 추가/변경/삭제를 묶어 보내는 이벤트.
  // 리스트 전체를 다시 받지 않고 tracks 배열에 patch만 적용해 정렬/검색/스크롤 상태를
  // 지키면서, 파일 여러 개가 한꺼번에 들어와도 렌더러 상태 갱신은 배치당 한 번만 일어난다.
  onTracksChanged: (
    callback: (changes: TracksChanged) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      changes: TracksChanged,
    ): void => callback(changes);
    ipcRenderer.on("library:tracksChanged", listener);
    return () => ipcRenderer.removeListener("library:tracksChanged", listener);
  },
  onWatchStatus: (callback: (status: WatchStatus) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: WatchStatus,
    ): void => callback(status);
    ipcRenderer.on("library:watchStatus", listener);
    return () => ipcRenderer.removeListener("library:watchStatus", listener);
  },

  toggleStar: (trackId: number): Promise<boolean> =>
    ipcRenderer.invoke("track:toggleStar", trackId),

  // 반환값이 없는 부수 기록이라 응답을 기다릴 이유가 없다 — invoke 대신 send.
  updateLastPlayed: (trackId: number): void =>
    ipcRenderer.send("track:updateLastPlayed", trackId),

  updateTrackMetadata: (
    trackId: number,
    patch: TrackMetadataPatch,
  ): Promise<Track | null> =>
    ipcRenderer.invoke("track:updateMetadata", trackId, patch),

  batchUpdateTrackMetadata: (
    trackIds: number[],
    patch: TrackMetadataPatch,
  ): Promise<Track[]> =>
    ipcRenderer.invoke("track:batchUpdateMetadata", trackIds, patch),

  findDuplicates: (): Promise<Track[][]> =>
    ipcRenderer.invoke("library:findDuplicates"),

  updateTrackMarkers: (
    trackId: number,
    markers: number[],
  ): Promise<Track | null> =>
    ipcRenderer.invoke("track:updateMarkers", trackId, markers),

  // Collections
  getCollections: (): Promise<Collection[]> =>
    ipcRenderer.invoke("collections:getAll"),
  createCollection: (name: string): Promise<Collection[]> =>
    ipcRenderer.invoke("collections:create", name),
  deleteCollection: (id: number): Promise<Collection[]> =>
    ipcRenderer.invoke("collections:delete", id),
  renameCollection: (id: number, name: string): Promise<Collection[]> =>
    ipcRenderer.invoke("collections:rename", id, name),
  setCollectionColor: (
    id: number,
    color: string | null,
  ): Promise<Collection[]> =>
    ipcRenderer.invoke("collections:setColor", id, color),
  addTrackToCollection: (
    collectionId: number,
    trackId: number,
  ): Promise<Collection[]> =>
    ipcRenderer.invoke("collections:addTrack", collectionId, trackId),
  addTracksToCollection: (
    collectionId: number,
    trackIds: number[],
  ): Promise<Collection[]> =>
    ipcRenderer.invoke("collections:addTracks", collectionId, trackIds),
  removeTrackFromCollection: (
    collectionId: number,
    trackId: number,
  ): Promise<Collection[]> =>
    ipcRenderer.invoke("collections:removeTrack", collectionId, trackId),
  reorderCollectionTracks: (
    collectionId: number,
    orderedTrackIds: number[],
  ): Promise<Collection[]> =>
    ipcRenderer.invoke("collections:reorder", collectionId, orderedTrackIds),

  readAudioFile: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke("file:readAudio", filePath),

  getAudioAccess: (
    filePath: string,
  ): Promise<{ url: string; size: number; mtimeMs: number }> =>
    ipcRenderer.invoke("file:getAudioAccess", filePath),

  writeClipboardText: (text: string): Promise<void> =>
    ipcRenderer.invoke("clipboard:writeText", text),

  // 리스트 우클릭 메뉴: 파일 시스템 액션
  removeTrack: (trackId: number): Promise<void> =>
    ipcRenderer.invoke("track:remove", trackId),
  renameTrackFile: (
    trackId: number,
    filePath: string,
    newName: string,
  ): Promise<{ filePath: string; filename: string }> =>
    ipcRenderer.invoke("track:rename", trackId, filePath, newName),
  openExternal: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("file:openExternal", filePath),
  showItemInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("file:showItemInFolder", filePath),
  copyToFolder: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke("file:copyToFolder", filePath),

  // 커버 아트워크 (임베디드 우선 → 폴더 커버 → null)
  getTrackArtwork: (
    filePath: string,
    folderCoverPath: string | null,
  ): Promise<{ url: string; source: "embedded" | "folder" } | null> =>
    ipcRenderer.invoke("artwork:getForTrack", filePath, folderCoverPath),
  getFolderCover: (
    folderPath: string,
  ): Promise<{ url: string; source: "folder" } | null> =>
    ipcRenderer.invoke("artwork:getFolderCover", folderPath),

  // 리스트 행을 OS 네이티브 드래그로 내보내기 (DAW/탐색기로 드롭).
  // 배열을 넘기면 선택한 사운드를 한 번에 전부 드래그한다(메인의 drag:start가 다중 파일 지원).
  startDrag: (filePaths: string | string[]): void =>
    ipcRenderer.send("drag:start", filePaths),

  // Waveform에서 선택한 구간만 잘라 임시 오디오로 만든 뒤 그 파일을 네이티브 드래그로 내보내기
  startDragFromBuffer: (bytes: Uint8Array, filename: string): void =>
    ipcRenderer.send("drag:startFromBuffer", bytes, filename),

  // 창 제어 (커스텀 타이틀바)
  windowMinimize: (): void => ipcRenderer.send("window:minimize"),
  windowToggleMaximize: (): void => ipcRenderer.send("window:toggleMaximize"),
  windowClose: (): void => ipcRenderer.send("window:close"),
  windowIsMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke("window:isMaximized"),
  onWindowMaximized: (callback: (maximized: boolean) => void): (() => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      maximized: boolean,
    ): void => callback(maximized);
    ipcRenderer.on("window:maximized", listener);
    return () => ipcRenderer.removeListener("window:maximized", listener);
  },

  // Dock Mode: 창을 화면 하단의 얇은 트랜스포트 바로 축소/복원
  setDockMode: (on: boolean): Promise<void> =>
    ipcRenderer.invoke("window:setDockMode", on),
};

contextBridge.exposeInMainWorld("api", api);

export type SoundLibApi = typeof api;
