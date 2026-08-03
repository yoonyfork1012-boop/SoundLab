import type {
  Collection,
  Library,
  ScanProgress,
  ScanSummary,
  Track,
  TrackMetadataPatch,
  TracksChanged,
  UpdateState,
  WatchStatus,
} from "../shared/types";
import type { LibraryTree } from "../shared/folderTree";

// 스캔류 응답 — tracks는 실제로 바뀐 게 있을 때만 실려 온다(null이면 기존 목록을 그대로 유지).
interface ScanResult {
  libraries: Library[];
  tracks: Track[] | null;
  summary: ScanSummary;
}

declare const api: {
  selectFolder: () => Promise<string | null>;
  isDirectory: (filePath: string) => Promise<boolean>;
  getPathForFile: (file: File) => string;
  scanLibrary: (rootPath: string) => Promise<ScanResult>;
  loadAll: () => Promise<{
    libraries: Library[];
    tracks: Track[];
  }>;
  loadTree: () => Promise<{
    libraries: Library[];
    trees: LibraryTree[];
  }>;
  notifyReady: () => void;
  removeLibrary: (libraryId: number) => Promise<{
    libraries: Library[];
    tracks: Track[];
  }>;
  removeFolder: (
    libraryId: number,
    folderPath: string,
  ) => Promise<{
    libraries: Library[];
    tracks: Track[];
  }>;
  renameFolder: (
    libraryId: number,
    folderPath: string,
    newName: string,
  ) => Promise<{
    libraries: Library[];
    tracks: Track[];
    renamed: number;
  } | null>;
  renameLibrary: (libraryId: number, name: string) => Promise<Library[]>;
  scanNewFiles: (libraryId: number, rootPath: string) => Promise<ScanResult>;
  showInExplorer: (rootPath: string) => Promise<void>;
  rescanLibrary: (rootPath: string) => Promise<ScanResult>;
  refreshAllLibraries: () => Promise<ScanResult>;
  fullReindexLibrary: (
    libraryId: number,
    rootPath: string,
  ) => Promise<ScanResult>;
  setLibraryMonitor: (
    libraryId: number,
    rootPath: string,
    on: boolean,
  ) => Promise<Library[]>;
  analyzeLibrary: (libraryId: number) => Promise<{
    libraries: Library[];
    analyzedCount: number;
  }>;
  onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
  onLibraryUpdated: (
    callback: (data: {
      libraries: Library[];
      tracks: Track[];
      summary?: ScanSummary;
    }) => void,
  ) => () => void;
  onScanDone: (callback: (summary: ScanSummary) => void) => () => void;
  onTracksChanged: (callback: (changes: TracksChanged) => void) => () => void;
  onWatchStatus: (callback: (status: WatchStatus) => void) => () => void;
  toggleStar: (trackId: number) => Promise<boolean>;
  updateLastPlayed: (trackId: number) => void;
  searchTrackIds: (query: string) => Promise<number[]>;
  suggestSearchTerms: (prefix: string) => Promise<string[]>;
  semanticSearchIds: (query: string, limit: number) => Promise<number[]>;
  updateTrackMetadata: (
    trackId: number,
    patch: TrackMetadataPatch,
  ) => Promise<Track | null>;
  batchUpdateTrackMetadata: (
    trackIds: number[],
    patch: TrackMetadataPatch,
  ) => Promise<Track[]>;
  findDuplicates: () => Promise<Track[][]>;
  updateTrackMarkers: (
    trackId: number,
    markers: number[],
  ) => Promise<Track | null>;
  getCollections: () => Promise<Collection[]>;
  createCollection: (name: string) => Promise<Collection[]>;
  deleteCollection: (id: number) => Promise<Collection[]>;
  renameCollection: (id: number, name: string) => Promise<Collection[]>;
  setCollectionColor: (
    id: number,
    color: string | null,
  ) => Promise<Collection[]>;
  addTrackToCollection: (
    collectionId: number,
    trackId: number,
  ) => Promise<Collection[]>;
  addTracksToCollection: (
    collectionId: number,
    trackIds: number[],
  ) => Promise<Collection[]>;
  removeTrackFromCollection: (
    collectionId: number,
    trackId: number,
  ) => Promise<Collection[]>;
  reorderCollectionTracks: (
    collectionId: number,
    orderedTrackIds: number[],
  ) => Promise<Collection[]>;
  getAudioAccess: (
    filePath: string,
  ) => Promise<{ url: string; size: number; mtimeMs: number }>;
  readAudioFile: (filePath: string) => Promise<Uint8Array>;
  writeClipboardText: (text: string) => Promise<void>;
  removeTrack: (trackId: number) => Promise<void>;
  renameTrackFile: (
    trackId: number,
    filePath: string,
    newName: string,
  ) => Promise<{ filePath: string; filename: string }>;
  openExternal: (filePath: string) => Promise<void>;
  showItemInFolder: (filePath: string) => Promise<void>;
  copyToFolder: (filePath: string) => Promise<string | null>;
  getTrackArtwork: (
    filePath: string,
    folderCoverPath: string | null,
  ) => Promise<{ url: string; source: "embedded" | "folder" } | null>;
  getFolderCover: (
    folderPath: string,
  ) => Promise<{ url: string; source: "folder" } | null>;
  startDrag: (filePaths: string | string[]) => void;
  startDragFromBuffer: (bytes: Uint8Array, filename: string) => void;
  windowMinimize: () => void;
  windowToggleMaximize: () => void;
  windowClose: () => void;
  windowIsMaximized: () => Promise<boolean>;
  onWindowMaximized: (callback: (maximized: boolean) => void) => () => void;
  setDockMode: (on: boolean) => Promise<void>;
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdate: () => Promise<UpdateState>;
  installUpdate: () => void;
  onUpdateState: (callback: (state: UpdateState) => void) => () => void;
};
export type SoundLibApi = typeof api;
declare global {
  interface Window {
    api?: SoundLibApi;
  }
}
export {};
