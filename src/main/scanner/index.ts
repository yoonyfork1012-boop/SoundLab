import { readdir, stat } from "fs/promises";
import { createReadStream } from "fs";
import { createHash } from "crypto";
import { join, extname } from "path";
import {
  beginScanBatch,
  deleteMissingTracks,
  endScanBatch,
  getTrackByPath,
  getTrackStatsByLibrary,
  hasTrackFilePath,
  rollbackScanBatch,
  upsertLibrary,
  upsertTrack,
} from "../db/queries";
import { runExclusive } from "../db/txLock";
import { dirname } from "path";
import { categoryFromFilename } from "../../shared/ucsCatId";
import { classifySound } from "../../shared/soundTaxonomy";
import { findCoverInDir } from "../artwork";
import type { Library, ScanProgress, Track } from "../../shared/types";

// 이름변경/이동 감지를 위한 부분 해시 — 전체 파일을 읽지 않고 앞부분 64KB만 해시해
// 대용량 wav 파일이 많은 라이브러리에서도 빠르게 동작한다. 내용이 실제로 같은지 완벽히
// 보장하진 않지만, size+hash 조합으로 오탐 가능성을 실질적으로 없앤다.
const HASH_BYTES = 64 * 1024;

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

export const SUPPORTED_EXTENSIONS = new Set([
  ".wav",
  ".aiff",
  ".aif",
  ".mp3",
  ".m4a",
  ".ogg",
  ".flac",
]);

async function collectAudioFiles(
  rootPath: string,
  onProgress?: (progress: ScanProgress) => void,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        results.push(fullPath);
        // 파일 검색(discovering) 단계 — 폴더 트리를 도는 동안에도 진행 상황이 보이도록
        // 25개 단위로만 알려 IPC 전송 빈도를 억제
        if (onProgress && results.length % 25 === 0) {
          onProgress({
            phase: "discovering",
            scanned: results.length,
            total: 0,
            currentFile: entry.name,
          });
        }
      }
    }
  }

  await walk(rootPath);
  onProgress?.({
    phase: "discovering",
    scanned: results.length,
    total: 0,
    currentFile: "",
  });
  return results;
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
  loggedErrorRef: { v: boolean },
  dirCoverCache: Map<string, string | null>,
  fileStat: { mtimeMs: number; size: number } | null,
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
    // 개별 파일 파싱 실패는 무시하되, 첫 오류만 진단용으로 기록
    if (!loggedErrorRef.v) {
      loggedErrorRef.v = true;
      console.error(
        "metadata parse failed:",
        filename,
        (err as Error)?.message,
      );
    }
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

// 증분 스캔: 이미 등록된 파일 중 mtime/size가 이전과 동일하면 메타데이터 재파싱을 건너뛴다.
// 최초 실행(라이브러리에 아무 트랙도 없음) 시에는 모든 파일이 "변경됨"으로 취급돼 자연히
// 전체 인덱싱이 수행되고, 이후 재스캔(폴더 재추가·변경 감시 재스캔)에서는 실제로 새로
// 추가되었거나 내용이 바뀐 파일만 다시 파싱된다.
export async function scanLibrary(
  rootPath: string,
  onProgress?: (progress: ScanProgress) => void,
): Promise<Library> {
  const name = rootPath.split(/[\\/]/).filter(Boolean).pop() ?? rootPath;
  const library = upsertLibrary(rootPath, name);

  const files = await collectAudioFiles(rootPath, onProgress);
  const existingStats = getTrackStatsByLibrary(library.id);
  const loggedErrorRef = { v: false };
  const presentFilePaths = new Set<string>();
  const dirCoverCache = new Map<string, string | null>();

  // 스캔은 BEGIN 상태로 파일마다 await(stat/parse/hash)를 넘기며 트랜잭션을 오래 열어둔다.
  // 그 사이 다른 트랜잭션 쓰기(다른 스캔, 폴더 제거/이름변경)가 끼어들면 중첩 BEGIN 실패 →
  // 그쪽 ROLLBACK이 이 스캔의 트랜잭션을 닫아 endScanBatch의 COMMIT이 터진다. 트랜잭션을 여는
  // 쓰기들을 runExclusive 큐로 직렬화해 절대 겹치지 않게 한다.
  await runExclusive(async () => {
    beginScanBatch();
    try {
      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        presentFilePaths.add(filePath);
        try {
          let fileStat: { mtimeMs: number; size: number } | null = null;
          try {
            const info = await stat(filePath);
            fileStat = { mtimeMs: info.mtimeMs, size: info.size };
          } catch {
            /* stat 실패 시 변경 여부를 알 수 없으므로 항상 재파싱 */
          }
          const prev = existingStats.get(filePath);
          const unchanged =
            fileStat != null &&
            prev != null &&
            prev.mtimeMs === fileStat.mtimeMs &&
            prev.fileSize === fileStat.size;
          if (!unchanged) {
            await parseAndUpsert(
              filePath,
              library.id,
              rootPath,
              loggedErrorRef,
              dirCoverCache,
              fileStat,
            );
          }
        } catch (err) {
          // 파일 한 개의 처리 실패로 전체 스캔(트랜잭션)이 롤백돼 이미 스캔된 다른 파일까지
          // 통째로 사라지면 안 되므로, 개별 파일 단위로 격리해 로그만 남기고 계속 진행한다.
          console.error(
            "scan: skipping file after error:",
            filePath,
            (err as Error)?.message,
          );
        }
        onProgress?.({
          phase: "parsing",
          scanned: i + 1,
          total: files.length,
          currentFile: filePath.split(/[\\/]/).pop() ?? filePath,
        });
      }
      deleteMissingTracks(library.id, presentFilePaths);
      endScanBatch();
    } catch (err) {
      rollbackScanBatch();
      throw err;
    }
  });

  return library;
}

// "Scan for new files" — 기존에 등록된 파일은 건드리지 않고, DB에 없는 새 파일만 추가.
// (삭제된 파일 정리는 하지 않는 non-destructive 스캔)
export async function scanNewFilesOnly(
  rootPath: string,
  libraryId: number,
  onProgress?: (progress: ScanProgress) => void,
): Promise<number> {
  const files = await collectAudioFiles(rootPath, onProgress);
  const newFiles = files.filter((f) => !hasTrackFilePath(f));
  const loggedErrorRef = { v: false };
  const dirCoverCache = new Map<string, string | null>();

  // scanLibrary와 동일 — 트랜잭션을 여는 스캔을 runExclusive로 직렬화해 다른 트랜잭션 쓰기와
  // 겹치지 않게 한다(겹치면 스캔의 COMMIT이 "no transaction is active"로 터진다).
  await runExclusive(async () => {
    beginScanBatch();
    try {
      for (let i = 0; i < newFiles.length; i++) {
        const filePath = newFiles[i];
        try {
          let fileStat: { mtimeMs: number; size: number } | null = null;
          try {
            const info = await stat(filePath);
            fileStat = { mtimeMs: info.mtimeMs, size: info.size };
          } catch {
            /* noop */
          }
          await parseAndUpsert(
            filePath,
            libraryId,
            rootPath,
            loggedErrorRef,
            dirCoverCache,
            fileStat,
          );
        } catch (err) {
          // scanLibrary와 동일한 이유로 파일 단위 실패를 격리한다.
          console.error(
            "scanNewFilesOnly: skipping file after error:",
            filePath,
            (err as Error)?.message,
          );
        }
        onProgress?.({
          phase: "parsing",
          scanned: i + 1,
          total: newFiles.length,
          currentFile: filePath.split(/[\\/]/).pop() ?? filePath,
        });
      }
      endScanBatch();
    } catch (err) {
      rollbackScanBatch();
      throw err;
    }
  });

  return newFiles.length;
}

// 파일 감시(watcher)에서 파일 1개가 추가되었거나 내용이 바뀐 것으로 판단됐을 때 호출.
// 전체 폴더를 다시 훑지 않고 해당 파일만 메타데이터 파싱 + DB upsert하는 증분 인덱싱 진입점.
// persistDb()는 호출하지 않으므로(대량 이벤트를 배치로 묶어 한 번만 디스크에 쓰기 위함),
// 호출부(watcher)가 배치 처리 후 직접 persistDb()를 호출해야 한다.
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
  const loggedErrorRef = { v: false };
  const dirCoverCache = new Map<string, string | null>();
  await parseAndUpsert(
    filePath,
    libraryId,
    rootPath,
    loggedErrorRef,
    dirCoverCache,
    fileStat,
  );
  return getTrackByPath(filePath);
}
