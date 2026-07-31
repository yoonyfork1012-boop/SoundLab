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
  markers: number[];
}

// 메타데이터 패널 인라인 편집 / 일괄 편집이 공유하는 패치 타입.
// tags를 넘기면 통째로 교체, addTags/removeTags를 넘기면 기존 태그를 보존한 채 추가/제거.
export interface TrackMetadataPatch {
  category?: string | null;
  subcategory?: string | null;
  description?: string | null;
  tags?: string[];
  addTags?: string[];
  removeTags?: string[];
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
  phase: "discovering" | "parsing" | "finalizing";
  scanned: number;
  total: number;
  currentFile: string;
  // 증분 인덱싱 진행 상황 — 신규/변경/이동/삭제/건너뜀을 구분해 보여준다.
  // (기존 호출부 호환을 위해 전부 선택 필드)
  added?: number;
  updated?: number;
  moved?: number;
  removed?: number;
  skipped?: number;
  errors?: number;
  libraryName?: string;
}

// 스캔 한 번의 결과 요약 — 토스트/로그로 사용자에게 보여준다.
export interface ScanSummary {
  added: number;
  updated: number;
  moved: number;
  removed: number;
  // 변경이 없어 재분석을 건너뛴 파일 수(디렉터리 프루닝으로 stat조차 생략한 것 포함)
  skipped: number;
  // 손상/읽기 실패로 건너뛴 파일. 전체 인덱싱을 중단시키지 않고 여기에만 모인다.
  errors: { filePath: string; message: string }[];
}

// watcher가 배치로 모아 보내는 라이브러리 변경분 — 트랙 1건마다 렌더러 상태를 갱신하면
// 수십만 트랙에서 파생 인덱스(폴더트리/검색 blob)가 매번 통째로 재계산되므로,
// 한 배치를 한 번의 상태 업데이트로 적용할 수 있게 묶어서 보낸다.
export interface TracksChanged {
  added: Track[];
  updated: Track[];
  removedIds: number[];
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

// 자동 업데이트 진행 상태 — 메인(electron-updater)이 만들고 렌더러가 배너로 보여준다.
// 'none'은 "확인했고 최신"과 "아직 확인 전"을 겸한다(구분해서 보여줄 게 없다).
export type UpdateState =
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "none" }
  | { status: "downloading"; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };
