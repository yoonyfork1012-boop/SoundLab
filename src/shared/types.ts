export interface Track {
  id: number;
  libraryId: number;
  filePath: string;
  filename: string;
  durationMs: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  tags: string[];
  starred: boolean;
  artworkPath: string | null;
  artworkSource: "embedded" | "manual" | "generated" | null;
  addedAt: number;
  lastPlayedAt: number | null;
  fileSize: number | null;
  publisher: string | null;
  isFloat: boolean;
  fileHash: string | null;
}

export type PublisherMode =
  | "library-root-child"
  | "file-parent-1"
  | "file-parent-2"
  | "file-parent-3"
  | "custom";

export interface PublisherRule {
  mode: PublisherMode;
  customPath: string | null;
}

export interface Library {
  id: number;
  rootPath: string;
  name: string;
  createdAt: number;
  monitor: boolean;
  analyzedAt: number | null;
}

export interface ScanProgress {
  phase: "discovering" | "parsing";
  scanned: number;
  total: number;
  currentFile: string;
}

export interface Collection {
  id: number;
  name: string;
  trackIds: number[];
  createdAt: number;
  color: string | null;
}

// 좌측 사이드바/하단 상태 영역에 표시할 작은 감시 상태 텍스트.
// 'indexed'/'removed'는 배치 처리 완료 후 몇 초간 보여주고 자동으로 'watching'으로 되돌아간다.
export interface WatchStatus {
  libraryId: number;
  kind: "watching" | "updating" | "indexed" | "removed" | "error";
  count?: number;
  message?: string;
}
