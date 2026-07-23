import { readdir, stat } from "fs/promises";
import { createReadStream } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { isIndexableAudioFile, isSkippedDir } from "../../shared/audioFiles";
import {
  beginScanBatch,
  clearDirSnapshot,
  deleteTracksByIds,
  endScanBatch,
  getDirSnapshot,
  getTrackByPath,
  getTrackStatsByLibrary,
  replaceDirSnapshot,
  rollbackScanBatch,
  updateTrackPathOnly,
  upsertLibrary,
  upsertTrack,
  type TrackStatRow,
} from "../db/queries";
import { runExclusive } from "../db/txLock";
import { categoryFromFilename } from "../../shared/ucsCatId";
import { classifySound } from "../../shared/soundTaxonomy";
import { findCoverInDir } from "../artwork";
import type {
  Library,
  ScanProgress,
  ScanSummary,
  Track,
} from "../../shared/types";

// 이름변경/이동 감지를 위한 부분 해시 — 전체 파일을 읽지 않고 앞부분 64KB만 해시해
// 대용량 wav 파일이 많은 라이브러리에서도 빠르게 동작한다. 내용이 실제로 같은지 완벽히
// 보장하진 않지만, size+hash 조합으로 오탐 가능성을 실질적으로 없앤다.
const HASH_BYTES = 64 * 1024;

// 파싱 루프를 이만큼 돌 때마다 이벤트 루프에 제어를 돌려준다. 그래야 인덱싱 중에도
// 검색/재생/메뉴 이동 같은 IPC가 메인 프로세스에서 처리되어 앱이 멈추지 않는다.
const YIELD_EVERY = 24;
// 진행 상황 IPC 전송 빈도 제한 — 파일마다 보내면 렌더러가 이벤트 처리에만 매달린다.
const PROGRESS_EVERY = 32;

export function computeFileHash(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const hash = createHash("sha1");
      const stream = createReadStream(filePath, {
        start: 0,
        end: HASH_BYTES - 1,
      });
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

// music-metadata v10은 ESM 전용. 패키징된 CJS 빌드에서 static import은 parseFile이
// undefined가 되어 매 파일 실패 → 동적 import로 로드해야 함.
let mmPromise: Promise<typeof import("music-metadata")> | null = null;
function getMusicMetadata(): Promise<typeof import("music-metadata")> {
  if (!mmPromise) mmPromise = import("music-metadata");
  return mmPromise;
}

// 어떤 파일/폴더를 대상으로 삼을지는 스캐너와 감시(watcher)가 반드시 같은 기준을 써야 하므로
// 순수 공유 모듈에 두고 여기서 재-export한다(기존 임포트 경로 호환).
export {
  SUPPORTED_EXTENSIONS,
  isIgnoredFilename,
  isIndexableAudioFile,
} from "../../shared/audioFiles";

interface WalkResult {
  /** 실제로 stat/파싱 대상이 되는 파일 (프루닝되지 않은 폴더의 것) */
  files: string[];
  /** 이번 스캔이 통째로 건너뛴 폴더 — 그 안의 DB 트랙은 "그대로 존재"로 취급한다 */
  prunedDirs: Set<string>;
  /** 이번에 본 모든 폴더의 mtime — 다음 스캔의 프루닝 기준으로 저장한다 */
  dirs: Map<string, number>;
  /** 폴더 개수(진행 표시용) */
  dirCount: number;
}

// 폴더 트리를 훑으며 오디오 파일을 모은다.
//
// 증분 스캔의 핵심: 폴더의 mtime이 지난 스캔 때와 같으면 그 폴더 "직속" 파일 목록에
// 추가/삭제/이름변경이 없었다는 뜻이므로, 그 파일들에 대한 stat 호출을 통째로 건너뛴다.
// 수십만 파일 라이브러리에서 재스캔 시간을 지배하던 것이 바로 이 파일별 stat이었다.
// (하위 폴더 안쪽의 변경은 부모 mtime에 반영되지 않으므로 재귀 자체는 항상 수행한다.)
async function collectAudioFiles(
  rootPath: string,
  prevDirs: Map<string, number>,
  prune: boolean,
  onProgress?: (progress: ScanProgress) => void,
): Promise<WalkResult> {
  const result: WalkResult = {
    files: [],
    prunedDirs: new Set(),
    dirs: new Map(),
    dirCount: 0,
  };

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    result.dirCount++;

    // 폴더당 stat 1회 — 파일당 1회에 비하면 무시할 수 있는 비용이다(폴더 수 ≪ 파일 수).
    let dirMtime: number | null = null;
    try {
      dirMtime = (await stat(dir)).mtimeMs;
    } catch {
      /* mtime을 못 읽으면 프루닝하지 않고 정상 스캔한다(안전한 방향) */
    }
    if (dirMtime != null) result.dirs.set(dir, dirMtime);
    const pruned = prune && dirMtime != null && prevDirs.get(dir) === dirMtime;
    if (pruned) result.prunedDirs.add(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name)) await walk(fullPath);
      } else if (!pruned && isIndexableAudioFile(entry.name)) {
        result.files.push(fullPath);
      }
    }

    // 폴더 트리를 도는 동안에도 진행 상황이 보이도록 알린다. 프루닝이 걸리면 files는
    // 거의 늘지 않으므로 폴더 개수를 기준으로 보고한다.
    if (onProgress && result.dirCount % 50 === 0) {
      onProgress({
        phase: "discovering",
        scanned: result.files.length,
        total: 0,
        currentFile: dir,
      });
    }
  }

  await walk(rootPath);
  onProgress?.({
    phase: "discovering",
    scanned: result.files.length,
    total: 0,
    currentFile: "",
  });
  return result;
}

// 기존 메타데이터(UCS 파일명 CatID, 오디오 태그의 genre)가 있으면 그것을 우선 사용하고,
// 없을 때만 하이브리드 분류기로 자동 분류한다.
function resolveCategory(
  filename: string,
  folderPath: string,
  genre?: string,
): { category: string | null; subcategory: string | null } {
  const ucs = categoryFromFilename(filename);
  if (ucs)
    return { category: ucs.category, subcategory: ucs.subcategory || null };
  if (genre) return { category: genre, subcategory: null };
  const guess = classifySound({ filename, folderPath });
  return { category: guess.category, subcategory: guess.subcategory || null };
}

// 라이브러리 루트 폴더명(벤더/브랜드명인 경우가 많음, 예: "Blastwave FX", "Boom Library")은
// 분류 입력에서 제외한다 — 브랜드명이 우연히 카테고리 키워드와 겹쳐(예: "Blastwave"의
// "blast") 라이브러리 전체가 엉뚱하게 분류되는 것을 방지하기 위함. 실제 사운드 성격을
// 나타내는 하위 폴더명만 분류에 사용한다.
function relativeFolderPath(filePath: string, rootPath: string): string {
  const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const dir = norm(filePath.split(/[\\/]/).slice(0, -1).join("/"));
  const root = norm(rootPath);
  return dir.startsWith(root)
    ? dir.slice(root.length).replace(/^\/+/, "")
    : dir;
}

// 트랙이 든 폴더의 커버 이미지 경로 (폴더당 한 번만 탐색 후 캐시)
function folderCoverFor(
  filePath: string,
  cache: Map<string, string | null>,
): string | null {
  const dir = dirname(filePath);
  if (!cache.has(dir)) cache.set(dir, findCoverInDir(dir));
  return cache.get(dir) ?? null;
}

function cleanTagValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // BWF(bext) 필드는 고정 길이 필드라 널바이트/공백으로 패딩돼 있는 경우가 많음
  const trimmed = v.replace(/\0+$/, "").trim();
  return trimmed ? trimmed : null;
}

// 사운드 제작사/제작사 이름 — 전문 SFX 라이브러리는 대개 WAV의 BWF(bext) Originator에
// 회사명을 담고(예: "Boom Library"), 음악 파일은 ID3/Vorbis의 Publisher/Label 태그를 쓴다.
function resolvePublisher(meta: {
  native?: Record<string, { id: string; value: unknown }[]>;
  common?: { publisher?: string[]; label?: string[] };
}): string | null {
  const exifTags = meta.native?.exif ?? [];
  const bextOriginator = exifTags.find(
    (t) => t.id === "bext.originator",
  )?.value;
  return (
    cleanTagValue(bextOriginator) ??
    cleanTagValue(meta.common?.publisher?.[0]) ??
    cleanTagValue(meta.common?.label?.[0])
  );
}

// WAV(IEEE_FLOAT)/AIFC(fl32,fl64) 등 부동소수점 PCM 여부 — Bit Depth를 "32 float"처럼 표시하기 위함
function isFloatCodec(codec?: string): boolean {
  return !!codec && /float|fl32|fl64/i.test(codec);
}

async function parseAndUpsert(
  filePath: string,
  libraryId: number,
  rootPath: string,
  dirCoverCache: Map<string, string | null>,
  fileStat: { mtimeMs: number; size: number } | null,
  onError?: (filePath: string, message: string) => void,
): Promise<void> {
  const filename = filePath.split(/[\\/]/).pop() ?? filePath;
  const folderPath = relativeFolderPath(filePath, rootPath);
  // 스캔 시에는 폴더 커버만 저장(빠름). 임베디드 아트워크는 선택 시 우선 적용됨.
  const cover = folderCoverFor(filePath, dirCoverCache);
  const fileHash = await computeFileHash(filePath);
  const { parseFile } = await getMusicMetadata();
  try {
    const meta = await parseFile(filePath, {
      skipCovers: true,
      duration: true,
    });
    const genre = meta.common?.genre?.[0];
    const { category, subcategory } = resolveCategory(
      filename,
      folderPath,
      genre,
    );
    upsertTrack({
      libraryId,
      filePath,
      filename,
      durationMs: meta.format.duration
        ? Math.round(meta.format.duration * 1000)
        : null,
      sampleRate: meta.format.sampleRate ?? null,
      bitDepth: meta.format.bitsPerSample ?? null,
      channels: meta.format.numberOfChannels ?? null,
      category,
      subcategory,
      artworkPath: cover,
      artworkSource: cover ? "folder" : null,
      mtimeMs: fileStat?.mtimeMs ?? null,
      fileSize: fileStat?.size ?? null,
      publisher: resolvePublisher(meta),
      isFloat: isFloatCodec(meta.format.codec),
      fileHash,
    });
  } catch (err) {
    // 손상되었거나 읽을 수 없는 파일 하나 때문에 전체 인덱싱이 멈추면 안 된다.
    // 파일명 기반으로라도 등록해 목록에는 남기고, 오류는 요약에 모아 사용자에게 보고한다.
    onError?.(filePath, (err as Error)?.message ?? "unknown error");
    const { category, subcategory } = resolveCategory(filename, folderPath);
    upsertTrack({
      libraryId,
      filePath,
      filename,
      durationMs: null,
      sampleRate: null,
      bitDepth: null,
      channels: null,
      category,
      subcategory,
      artworkPath: cover,
      artworkSource: cover ? "folder" : null,
      mtimeMs: fileStat?.mtimeMs ?? null,
      fileSize: fileStat?.size ?? null,
      fileHash,
    });
  }
}

function emptySummary(): ScanSummary {
  return { added: 0, updated: 0, moved: 0, removed: 0, skipped: 0, errors: [] };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export interface ScanOptions {
  /**
   * incremental(기본): 폴더 mtime + 파일 mtime/size를 이전 인덱스와 비교해 새로
   *   추가되거나 바뀐 것만 처리한다.
   * full: 비교를 전부 무시하고 모든 파일을 다시 분석한다(문제 복구용).
   */
  mode?: "incremental" | "full";
  /** false면 디스크에서 사라진 파일을 인덱스에서 지우지 않는다("새 파일만 추가" 모드) */
  deleteMissing?: boolean;
  onProgress?: (progress: ScanProgress) => void;
}

/**
 * 라이브러리 폴더를 훑어 인덱스를 현재 디스크 상태에 맞춘다.
 *
 * 처리 구분:
 *  - 새 파일        → 신규 인덱싱
 *  - 수정된 파일    → 그 파일만 재분석
 *  - 삭제된 파일    → 인덱스에서 제거 (deleteMissing이 true일 때)
 *  - 변경 없는 파일 → 기존 인덱스 그대로 사용 (분석 안 함)
 *  - 이동/이름변경  → size+부분해시로 짝지어 경로만 갱신, 기존 분석 데이터 재사용
 */
export async function scanLibrary(
  rootPath: string,
  options: ScanOptions = {},
): Promise<{ library: Library; summary: ScanSummary }> {
  const { mode = "incremental", deleteMissing = true, onProgress } = options;
  const name = rootPath.split(/[\\/]/).filter(Boolean).pop() ?? rootPath;
  const library = upsertLibrary(rootPath, name);
  const summary = emptySummary();

  const existingStats = getTrackStatsByLibrary(library.id);
  const prevDirs =
    mode === "full" ? new Map<string, number>() : getDirSnapshot(library.id);

  const report = (
    phase: ScanProgress["phase"],
    scanned: number,
    total: number,
    currentFile: string,
  ): void => {
    onProgress?.({
      phase,
      scanned,
      total,
      currentFile,
      added: summary.added,
      updated: summary.updated,
      moved: summary.moved,
      removed: summary.removed,
      skipped: summary.skipped,
      errors: summary.errors.length,
      libraryName: library.name,
    });
  };

  const walk = await collectAudioFiles(
    rootPath,
    prevDirs,
    mode === "incremental",
    onProgress,
  );

  // 이번에 실제로 검사한 파일 + 프루닝된 폴더에 있던 기존 파일 = "지금도 존재하는 파일".
  // 프루닝된 폴더의 것을 여기 넣지 않으면 아래 삭제 처리가 멀쩡한 트랙을 지워버린다.
  const present = new Set<string>(walk.files);
  if (walk.prunedDirs.size > 0) {
    for (const filePath of existingStats.keys()) {
      if (walk.prunedDirs.has(dirname(filePath))) {
        present.add(filePath);
        summary.skipped++;
      }
    }
  }

  // 검사 대상 파일을 stat과 비교해 신규/변경/무변경으로 나눈다.
  const toAdd: {
    filePath: string;
    fileStat: { mtimeMs: number; size: number } | null;
  }[] = [];
  const toUpdate: {
    filePath: string;
    fileStat: { mtimeMs: number; size: number } | null;
  }[] = [];
  for (let i = 0; i < walk.files.length; i++) {
    const filePath = walk.files[i];
    let fileStat: { mtimeMs: number; size: number } | null = null;
    try {
      const info = await stat(filePath);
      fileStat = { mtimeMs: info.mtimeMs, size: info.size };
    } catch {
      /* stat 실패 시 변경 여부를 알 수 없으므로 항상 재분석 대상으로 둔다 */
    }
    const prev = existingStats.get(filePath);
    const unchanged =
      mode === "incremental" &&
      fileStat != null &&
      prev != null &&
      prev.mtimeMs === fileStat.mtimeMs &&
      prev.fileSize === fileStat.size;
    if (unchanged) {
      summary.skipped++;
    } else if (prev != null) {
      toUpdate.push({ filePath, fileStat });
    } else {
      toAdd.push({ filePath, fileStat });
    }
    if (i % YIELD_EVERY === 0) await yieldToEventLoop();
    if (i % (PROGRESS_EVERY * 8) === 0)
      report("discovering", i + 1, walk.files.length, filePath);
  }

  // 인덱스에는 있는데 디스크에서 사라진 파일 — 이동/이름변경 후보이자 삭제 후보.
  const missing = new Map<string, TrackStatRow>();
  for (const [filePath, row] of existingStats) {
    if (!present.has(filePath)) missing.set(filePath, row);
  }

  const dirCoverCache = new Map<string, string | null>();
  const onError = (filePath: string, message: string): void => {
    // 목록이 무한정 커지지 않도록 상한을 둔다(카운트는 errors.length가 아니라 별도 관리하지
    // 않고, 상한에 걸리면 그 이후 오류는 로그로만 남긴다).
    if (summary.errors.length < 200) summary.errors.push({ filePath, message });
    console.error("scan: file error:", filePath, message);
  };

  // 스캔은 BEGIN 상태로 파일마다 await(stat/parse/hash)를 넘기며 트랜잭션을 오래 열어둔다.
  // 그 사이 다른 트랜잭션 쓰기(다른 스캔, 폴더 제거/이름변경)가 끼어들면 중첩 BEGIN 실패 →
  // 그쪽 ROLLBACK이 이 스캔의 트랜잭션을 닫아 endScanBatch의 COMMIT이 터진다. 트랜잭션을 여는
  // 쓰기들을 runExclusive 큐로 직렬화해 절대 겹치지 않게 한다.
  await runExclusive(async () => {
    beginScanBatch();
    try {
      // ── 1) 이동/이름변경 매칭 ──
      // 새로 발견된 파일과 사라진 트랙을 size로 먼저 좁힌 뒤 부분해시로 확정한다.
      // 짝이 맞으면 재분석 없이 경로만 갱신해 기존 분석 데이터를 그대로 재사용한다.
      const stillNew: typeof toAdd = [];
      if (missing.size > 0) {
        const missingBySize = new Map<number, string[]>();
        for (const [filePath, row] of missing) {
          if (row.fileSize == null || row.fileHash == null) continue;
          const bucket = missingBySize.get(row.fileSize);
          if (bucket) bucket.push(filePath);
          else missingBySize.set(row.fileSize, [filePath]);
        }
        for (let i = 0; i < toAdd.length; i++) {
          const item = toAdd[i];
          const size = item.fileStat?.size;
          const bucket = size != null ? missingBySize.get(size) : undefined;
          let matchedPath: string | null = null;
          if (bucket && bucket.length > 0) {
            const hash = await computeFileHash(item.filePath);
            if (hash) {
              matchedPath =
                bucket.find((p) => missing.get(p)?.fileHash === hash) ?? null;
            }
          }
          if (matchedPath) {
            const row = missing.get(matchedPath)!;
            const filename =
              item.filePath.split(/[\\/]/).pop() ?? item.filePath;
            updateTrackPathOnly(
              row.id,
              item.filePath,
              filename,
              item.fileStat?.mtimeMs ?? null,
              item.fileStat?.size ?? null,
            );
            missing.delete(matchedPath);
            const bucketIdx = bucket!.indexOf(matchedPath);
            if (bucketIdx >= 0) bucket!.splice(bucketIdx, 1);
            summary.moved++;
          } else {
            stillNew.push(item);
          }
          if (i % YIELD_EVERY === 0) await yieldToEventLoop();
        }
      } else {
        stillNew.push(...toAdd);
      }

      // ── 2) 신규 + 변경 파일 분석 ──
      const work = [
        ...stillNew.map((x) => ({ ...x, kind: "add" as const })),
        ...toUpdate.map((x) => ({ ...x, kind: "update" as const })),
      ];
      for (let i = 0; i < work.length; i++) {
        const { filePath, fileStat, kind } = work[i];
        try {
          await parseAndUpsert(
            filePath,
            library.id,
            rootPath,
            dirCoverCache,
            fileStat,
            onError,
          );
          if (kind === "add") summary.added++;
          else summary.updated++;
        } catch (err) {
          // 파일 한 개의 처리 실패로 전체 스캔(트랜잭션)이 롤백돼 이미 스캔된 다른 파일까지
          // 통째로 사라지면 안 되므로, 개별 파일 단위로 격리해 기록만 남기고 계속 진행한다.
          onError(filePath, (err as Error)?.message ?? "unknown error");
        }
        if (i % YIELD_EVERY === 0) await yieldToEventLoop();
        if (i % PROGRESS_EVERY === 0)
          report(
            "parsing",
            i + 1,
            work.length,
            filePath.split(/[\\/]/).pop() ?? filePath,
          );
      }
      report("parsing", work.length, work.length, "");

      // ── 3) 사라진 파일 정리 ──
      if (deleteMissing && missing.size > 0) {
        report("finalizing", work.length, work.length, "");
        summary.removed = deleteTracksByIds(
          [...missing.values()].map((r) => r.id),
        );
      }

      // ── 4) 다음 증분 스캔을 위한 디렉터리 스냅샷 저장 ──
      // 오류가 하나라도 있었으면 스냅샷을 남기지 않는다 — 실패한 폴더가 "변경 없음"으로
      // 굳어져 다음 스캔에서 영영 건너뛰어지는 것을 막기 위함.
      if (summary.errors.length === 0) {
        replaceDirSnapshot(library.id, walk.dirs);
      } else {
        clearDirSnapshot(library.id);
      }

      endScanBatch();
    } catch (err) {
      rollbackScanBatch();
      throw err;
    }
  });

  return { library, summary };
}

// 파일 감시(watcher)에서 파일 1개가 추가되었거나 내용이 바뀐 것으로 판단됐을 때 호출.
// 전체 폴더를 다시 훑지 않고 해당 파일만 메타데이터 파싱 + DB upsert하는 증분 인덱싱 진입점.
// persistDb()는 호출하지 않으므로(대량 이벤트를 배치로 묶어 한 번만 디스크에 쓰기 위함),
// 호출부(watcher)가 배치 처리 후 직접 persist해야 한다.
export async function indexSingleFile(
  filePath: string,
  libraryId: number,
  rootPath: string,
): Promise<Track | null> {
  let fileStat: { mtimeMs: number; size: number } | null = null;
  try {
    const info = await stat(filePath);
    fileStat = { mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return null;
  }
  const dirCoverCache = new Map<string, string | null>();
  await parseAndUpsert(filePath, libraryId, rootPath, dirCoverCache, fileStat);
  return getTrackByPath(filePath);
}

/**
 * 감시(watcher)가 새로 생긴 폴더를 발견했을 때 — 그 폴더 하위의 오디오 파일 경로를 모은다.
 * 폴더째 복사/이동은 개별 파일 이벤트가 오지 않는 경우가 있어, 폴더 단위로 훑어 보완한다.
 */
export async function collectAudioFilesUnder(
  dir: string,
  limit = 5000,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name)) await walk(fullPath);
      } else if (isIndexableAudioFile(entry.name)) {
        out.push(fullPath);
      }
    }
  }
  await walk(dir);
  return out;
}
