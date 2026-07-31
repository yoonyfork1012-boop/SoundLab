import type Database from "better-sqlite3";
import { getDb, persistDb, schedulePersist } from "./index";
import type {
  Collection,
  Library,
  Track,
  TrackMetadataPatch,
} from "../../shared/types";

type SqlRow = Record<string, unknown>;

// db 인스턴스별로 prepared statement를 캐싱한다(WeakMap이라 DB가 재생성되면 자동으로
// 예전 캐시가 버려진다). better-sqlite3는 sql.js와 달리 매 prepare가 WASM 경계를
// 넘지 않지만, 자주 호출되는 SQL을 재준비하지 않는 게 여전히 더 빠르다.
const stmtCacheByDb = new WeakMap<
  Database.Database,
  Map<string, Database.Statement>
>();

function prep(sql: string): Database.Statement {
  const d = getDb();
  let cache = stmtCacheByDb.get(d);
  if (!cache) {
    cache = new Map();
    stmtCacheByDb.set(d, cache);
  }
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = d.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

function selectRows(sql: string, params: unknown[] = []): SqlRow[] {
  return prep(sql).all(params) as SqlRow[];
}

function selectRow(sql: string, params: unknown[] = []): SqlRow | undefined {
  return prep(sql).get(params) as SqlRow | undefined;
}

function run(sql: string, params: unknown[] = []): Database.RunResult {
  return prep(sql).run(params);
}

function rowToTrack(row: SqlRow): Track {
  return {
    id: row.id as number,
    libraryId: row.library_id as number,
    filePath: row.file_path as string,
    filename: row.filename as string,
    durationMs: (row.duration_ms as number) ?? null,
    sampleRate: (row.sample_rate as number) ?? null,
    bitDepth: (row.bit_depth as number) ?? null,
    channels: (row.channels as number) ?? null,
    category: (row.category as string) ?? null,
    subcategory: (row.subcategory as string) ?? null,
    description: (row.description as string) ?? null,
    tags: row.tags ? JSON.parse(row.tags as string) : [],
    starred: row.starred === 1,
    artworkPath: (row.artwork_path as string) ?? null,
    artworkSource: (row.artwork_source as Track["artworkSource"]) ?? null,
    addedAt: row.added_at as number,
    lastPlayedAt: (row.last_played_at as number) ?? null,
    fileSize: (row.file_size as number) ?? null,
    publisher: (row.publisher as string) ?? null,
    isFloat: row.is_float === 1,
    fileHash: (row.file_hash as string) ?? null,
    markers: row.markers ? (JSON.parse(row.markers as string) as number[]) : [],
  };
}

export function upsertLibrary(rootPath: string, name: string): Library {
  const existing = selectRow("SELECT * FROM libraries WHERE root_path = ?", [
    rootPath,
  ]);

  if (existing) {
    return rowToLibrary(existing);
  }

  const createdAt = Date.now();
  const result = run(
    "INSERT INTO libraries (root_path, name, created_at) VALUES (?, ?, ?)",
    [rootPath, name, createdAt],
  );
  const id = result.lastInsertRowid as number;
  persistDb();

  return { id, rootPath, name, createdAt, monitor: false, analyzedAt: null };
}

export function beginScanBatch(): void {
  getDb().exec("BEGIN TRANSACTION");
}

export function endScanBatch(): void {
  getDb().exec("COMMIT");
  persistDb();
}

export function rollbackScanBatch(): void {
  try {
    getDb().exec("ROLLBACK");
  } catch {
    /* noop */
  }
}

export function upsertTrack(track: {
  libraryId: number;
  filePath: string;
  filename: string;
  durationMs: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  category: string | null;
  subcategory: string | null;
  artworkPath?: string | null;
  artworkSource?: string | null;
  mtimeMs?: number | null;
  fileSize?: number | null;
  publisher?: string | null;
  isFloat?: boolean;
  fileHash?: string | null;
}): void {
  run(
    `INSERT INTO tracks (library_id, file_path, filename, duration_ms, sample_rate, bit_depth, channels, category, subcategory, artwork_path, artwork_source, mtime_ms, file_size, publisher, is_float, file_hash, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       library_id = excluded.library_id,
       filename = excluded.filename,
       duration_ms = excluded.duration_ms,
       sample_rate = excluded.sample_rate,
       bit_depth = excluded.bit_depth,
       channels = excluded.channels,
       category = excluded.category,
       subcategory = excluded.subcategory,
       artwork_path = excluded.artwork_path,
       artwork_source = excluded.artwork_source,
       mtime_ms = excluded.mtime_ms,
       file_size = excluded.file_size,
       publisher = excluded.publisher,
       is_float = excluded.is_float,
       file_hash = excluded.file_hash`,
    [
      track.libraryId,
      track.filePath,
      track.filename,
      track.durationMs,
      track.sampleRate,
      track.bitDepth,
      track.channels,
      track.category,
      track.subcategory,
      track.artworkPath ?? null,
      track.artworkSource ?? null,
      track.mtimeMs ?? null,
      track.fileSize ?? null,
      track.publisher ?? null,
      track.isFloat ? 1 : 0,
      track.fileHash ?? null,
      Date.now(),
    ],
  );
}

// 파일 감시 큐 전용 — 트랙 1건 조회(경로 기준). unlink 이벤트 처리 시 rename 후보로 보관하거나
// 삭제 전 캐시 정리에 필요한 정보(파일 크기/해시/id)를 얻기 위함.
export function getTrackByPath(filePath: string): Track | null {
  const row = selectRow("SELECT * FROM tracks WHERE file_path = ?", [filePath]);
  return row ? rowToTrack(row) : null;
}

// 같은 라이브러리 안에서 size+hash가 일치하는 트랙을 찾는다 — rename/move 후보 판별용.
// excludeFilePath는 방금 확인한 자기 자신(그대로 존재하는 파일)을 후보에서 제외하기 위함.
export function findRenameCandidate(
  libraryId: number,
  fileSize: number,
  fileHash: string,
  excludeFilePath: string,
): Track | null {
  const row = selectRow(
    "SELECT * FROM tracks WHERE library_id = ? AND file_size = ? AND file_hash = ? AND file_path != ? LIMIT 1",
    [libraryId, fileSize, fileHash, excludeFilePath],
  );
  return row ? rowToTrack(row) : null;
}

// 파일 삭제(unlink) 처리 — 컬렉션 소속 정리 후 트랙 제거. 아트워크 캐시 삭제는 호출부(watcher)에서
// getTrackByPath로 먼저 조회한 filePath를 이용해 별도로 처리한다.
// 감시 큐에서 대량 이벤트를 배치 처리할 때 매번 디스크에 전체 DB를 쓰지 않도록 persist는
// 호출부(watcher)가 배치 단위로 한 번만 수행한다.
export function deleteTrackByPath(filePath: string): void {
  const track = getTrackByPath(filePath);
  if (!track) return;
  run("DELETE FROM collection_tracks WHERE track_id = ?", [track.id]);
  run("DELETE FROM tracks WHERE id = ?", [track.id]);
}

// rename/move로 판별된 트랙의 경로만 갱신 — 콘텐츠(길이/샘플레이트 등 메타데이터)는 동일하므로
// 재파싱 없이 경로/파일명/mtime/size만 바꾼다. 카테고리·퍼블리셔는 그대로 유지(사용자 수정 보존).
export function updateTrackPathOnly(
  trackId: number,
  filePath: string,
  filename: string,
  mtimeMs: number | null,
  fileSize: number | null,
): void {
  run(
    "UPDATE tracks SET file_path = ?, filename = ?, mtime_ms = ?, file_size = ? WHERE id = ?",
    [filePath, filename, mtimeMs, fileSize, trackId],
  );
}

// 라이브러리의 기존 트랙 파일별 스냅샷 — 스캔 시 파일별 stat과 비교해 변경되지 않은
// 파일은 재파싱(메타데이터 재추출)을 건너뛰는 증분 인덱싱의 기반.
// id/fileHash까지 함께 싣는 이유: 스캔 도중 "사라진 트랙"과 "새로 발견된 파일"을
// size+hash로 짝지어 이동/이름변경으로 판정하고, 기존 분석 데이터를 재사용하기 위함.
export interface TrackStatRow {
  id: number;
  mtimeMs: number | null;
  fileSize: number | null;
  fileHash: string | null;
}

export function getTrackStatsByLibrary(
  libraryId: number,
): Map<string, TrackStatRow> {
  // raw()로 행마다 객체를 만들지 않고 배열 그대로 받는다 — 수십만 행에서 체감되는 차이.
  const rows = prep(
    "SELECT file_path, id, mtime_ms, file_size, file_hash FROM tracks WHERE library_id = ?",
  )
    .raw()
    .all(libraryId) as [
    string,
    number,
    number | null,
    number | null,
    string | null,
  ][];
  const map = new Map<string, TrackStatRow>();
  for (const [filePath, id, mtimeMs, fileSize, fileHash] of rows) {
    map.set(filePath, {
      id,
      mtimeMs: mtimeMs ?? null,
      fileSize: fileSize ?? null,
      fileHash: fileHash ?? null,
    });
  }
  return map;
}

// 스캔이 판정한 "사라진 트랙" id들을 한 번에 제거한다. 호출부가 이미 어떤 트랙이
// 없어졌는지 알고 있으므로 여기서 다시 전체 목록을 훑지 않는다.
export function deleteTracksByIds(trackIds: number[]): number {
  if (trackIds.length === 0) return 0;
  const delColl = prep("DELETE FROM collection_tracks WHERE track_id = ?");
  const delTrack = prep("DELETE FROM tracks WHERE id = ?");
  for (const id of trackIds) {
    delColl.run(id);
    delTrack.run(id);
  }
  return trackIds.length;
}

// ── 증분 인덱싱: 디렉터리 mtime 스냅샷 ──
// 폴더의 mtime은 그 폴더 "직속" 항목의 추가/삭제/이름변경 시에만 갱신된다(하위 폴더
// 깊은 곳의 변경이나 기존 파일의 내용 수정은 반영되지 않는다). 그래서 이 스냅샷은
// "직속 파일 목록이 그대로인가"만 판정하는 데 쓰고, 파일 내용 수정은 실시간 감시
// (watcher)가 잡는다. 둘 다 놓친 경우는 전체 재인덱싱으로 복구한다.
export function getDirSnapshot(libraryId: number): Map<string, number> {
  const rows = prep(
    "SELECT dir_path, mtime_ms FROM scan_dirs WHERE library_id = ?",
  )
    .raw()
    .all(libraryId) as [string, number | null][];
  const map = new Map<string, number>();
  for (const [dirPath, mtimeMs] of rows) {
    if (mtimeMs != null) map.set(dirPath, mtimeMs);
  }
  return map;
}

export function replaceDirSnapshot(
  libraryId: number,
  dirs: Map<string, number>,
): void {
  run("DELETE FROM scan_dirs WHERE library_id = ?", [libraryId]);
  const ins = prep(
    "INSERT OR REPLACE INTO scan_dirs (library_id, dir_path, mtime_ms) VALUES (?, ?, ?)",
  );
  for (const [dirPath, mtimeMs] of dirs) {
    ins.run(libraryId, dirPath, mtimeMs);
  }
}

// 전체 재인덱싱 등, 다음 스캔이 무조건 모든 폴더를 훑게 만들고 싶을 때.
export function clearDirSnapshot(libraryId: number): void {
  run("DELETE FROM scan_dirs WHERE library_id = ?", [libraryId]);
}

export function hasTrackFilePath(filePath: string): boolean {
  return (
    selectRow("SELECT 1 FROM tracks WHERE file_path = ? LIMIT 1", [
      filePath,
    ]) !== undefined
  );
}

// library_id가 실재하는 라이브러리를 가리키는 트랙만 반환한다. 과거에 라이브러리 행만
// 사라지고 트랙이 남은 "고아 트랙"은 사이드바 어디에도 뜨지 않으면서 로딩 페이로드만
// 키우므로 여기서 제외한다(비파괴적 — DB에는 그대로 남는다).
export function getAllTracks(): Track[] {
  return selectRows(
    "SELECT * FROM tracks WHERE library_id IN (SELECT id FROM libraries) ORDER BY filename",
  ).map(rowToTrack);
}

// 사이드바 폴더 트리 구성에만 필요한 최소 데이터(library_id, file_path)를 라이브러리별로
// 모아 반환한다. 전체 트랙(모든 컬럼)을 렌더러로 넘기는 것보다 페이로드가 수십 배 작아
// 시작 시 사이드바를 즉시 그릴 수 있다. raw()로 받아 대용량에서도 빠르다.
export function getTrackPathsByLibrary(): Map<number, string[]> {
  const rows = prep(
    "SELECT library_id, file_path FROM tracks WHERE library_id IN (SELECT id FROM libraries)",
  )
    .raw()
    .all() as [number, string][];
  const byLib = new Map<number, string[]>();
  for (const [libId, filePath] of rows) {
    let arr = byLib.get(libId);
    if (!arr) {
      arr = [];
      byLib.set(libId, arr);
    }
    arr.push(filePath);
  }
  return byLib;
}

function rowToLibrary(row: SqlRow): Library {
  return {
    id: row.id as number,
    rootPath: row.root_path as string,
    name: row.name as string,
    createdAt: row.created_at as number,
    monitor: row.monitor === 1,
    analyzedAt: (row.analyzed_at as number) ?? null,
  };
}

export function getAllLibraries(): Library[] {
  return selectRows("SELECT * FROM libraries ORDER BY created_at").map(
    rowToLibrary,
  );
}

export function renameLibrary(id: number, name: string): void {
  run("UPDATE libraries SET name = ? WHERE id = ?", [name, id]);
  persistDb();
}

export function setLibraryMonitor(id: number, on: boolean): void {
  run("UPDATE libraries SET monitor = ? WHERE id = ?", [on ? 1 : 0, id]);
  persistDb();
}

export function markLibraryAnalyzed(id: number, at: number): void {
  run("UPDATE libraries SET analyzed_at = ? WHERE id = ?", [at, id]);
  persistDb();
}

// "Analyze for Find Similar" — 실제 오디오 콘텐츠 분석(핑거프린팅) 대신, 이미 갖고 있는
// 메타데이터(길이/채널/샘플레이트/비트뎁스)로 근사 유사도 키를 만들어 저장한다.
// 추후 진짜 오디오 지문 분석으로 교체 가능하도록 similarity_key 컬럼만 사용.
export function computeSimilarityKeys(libraryId: number): number {
  const tracks = selectRows(
    "SELECT id, duration_ms, channels, sample_rate, bit_depth FROM tracks WHERE library_id = ?",
    [libraryId],
  );
  const update = prep("UPDATE tracks SET similarity_key = ? WHERE id = ?");
  for (const row of tracks) {
    const durBucket = row.duration_ms
      ? Math.round((row.duration_ms as number) / 50)
      : 0;
    const key = `${durBucket}-${row.channels ?? 0}-${row.sample_rate ?? 0}-${row.bit_depth ?? 0}`;
    update.run(key, row.id as number);
  }
  persistDb();
  return tracks.length;
}

// 현재 트랙이 0개인 라이브러리 id 목록.
export function getEmptyLibraryIds(): number[] {
  return selectRows(
    `SELECT id FROM libraries
     WHERE id NOT IN (SELECT DISTINCT library_id FROM tracks WHERE library_id IS NOT NULL)`,
  ).map((row) => row.id as number);
}

// 트랙이 하나도 남지 않은 라이브러리를 정리한다. 폴더를 겹쳐 추가하면 겹치는 파일이
// 새로 추가한 라이브러리로 재귀속(upsertTrack의 ON CONFLICT library_id 갱신)되면서
// 예전 라이브러리가 빈 껍데기로 남을 수 있는데, 그것만 제거하기 위함.
// protectedIds에는 "이번 스캔이 비운 게 아닌" 라이브러리 id를 넘겨 보호한다 — 방금 스캔한
// 라이브러리와, 스캔 전부터 이미 비어 있던(의도적으로 비운/네트워크 드라이브가 일시적으로
// 비어 보이던) 라이브러리. 이렇게 하면 무관한 빈 라이브러리가 다른 폴더 추가로 사라지지 않는다.
export function deleteEmptyLibraries(protectedIds: number[] = []): number[] {
  const protectedSet = new Set(protectedIds);
  const ids = getEmptyLibraryIds().filter((id) => !protectedSet.has(id));
  const del = prep("DELETE FROM libraries WHERE id = ?");
  for (const id of ids) {
    del.run(id);
  }
  if (ids.length > 0) persistDb();
  return ids;
}

export function deleteLibrary(libraryId: number): void {
  run(
    "DELETE FROM collection_tracks WHERE track_id IN (SELECT id FROM tracks WHERE library_id = ?)",
    [libraryId],
  );
  run("DELETE FROM tracks WHERE library_id = ?", [libraryId]);
  run("DELETE FROM scan_dirs WHERE library_id = ?", [libraryId]);
  run("DELETE FROM libraries WHERE id = ?", [libraryId]);
  persistDb();
}

export function toggleStarred(trackId: number): boolean {
  const row = selectRow("SELECT starred FROM tracks WHERE id = ?", [trackId]);
  const next = row?.starred === 1 ? 0 : 1;
  run("UPDATE tracks SET starred = ? WHERE id = ?", [next, trackId]);
  schedulePersist();
  return next === 1;
}

// 트랙을 클릭할 때마다 호출되는 가장 뜨거운 쓰기 경로 — 여기서 DB 전체를 동기 저장하면
// 같은 메인 스레드의 file:getAudioAccess IPC가 밀리고, 그 IPC를 기다리는 플레이어의
// ws.load() 호출이 늦어져 이전 사운드가 계속 재생된다. 반드시 디바운스 저장을 쓸 것.
export function updateLastPlayed(trackId: number): void {
  run("UPDATE tracks SET last_played_at = ? WHERE id = ?", [
    Date.now(),
    trackId,
  ]);
  schedulePersist();
}

// "Remove" (컨텍스트 메뉴) — 실제 파일은 건드리지 않고 라이브러리 인덱스에서만 제거.
// 다시 스캔하면 그대로 재인덱싱되므로 되돌릴 수 있는 안전한 동작이다.
export function removeTrack(trackId: number): void {
  // 이 트랙이 속한 폴더의 스냅샷을 무효화한다 — 안 그러면 폴더 mtime이 그대로라 다음
  // 증분 스캔이 그 폴더를 통째로 건너뛰어, 파일이 디스크에 멀쩡히 있는데도 영영
  // 다시 인덱싱되지 않는다("Remove는 재스캔으로 되돌릴 수 있다"는 약속이 깨진다).
  const owner = selectRow("SELECT library_id FROM tracks WHERE id = ?", [
    trackId,
  ]);
  run("DELETE FROM collection_tracks WHERE track_id = ?", [trackId]);
  run("DELETE FROM tracks WHERE id = ?", [trackId]);
  if (owner && owner.library_id != null) {
    clearDirSnapshot(owner.library_id as number);
  }
  persistDb();
}

// 사이드바 폴더(및 그 하위)에 속한 트랙의 (id, file_path)를 모은다. folderPathNorm은
// 트리 노드의 정규화 경로(슬래시 '/', 뒤 슬래시 없음). DB의 file_path는 실제 OS 경로라
// 구분자가 다를 수 있어(SQL LIKE는 폴더명 속 '_' 등을 와일드카드로 오인) JS에서 정확히 거른다.
export function getFolderTrackRows(
  libraryId: number,
  folderPathNorm: string,
): { id: number; filePath: string }[] {
  const rows = selectRows(
    "SELECT id, file_path FROM tracks WHERE library_id = ?",
    [libraryId],
  );
  const prefix = folderPathNorm.replace(/\/+$/, "") + "/";
  const out: { id: number; filePath: string }[] = [];
  for (const r of rows) {
    const fp = r.file_path as string;
    if ((fp.replace(/\\/g, "/") + "/").startsWith(prefix)) {
      out.push({ id: r.id as number, filePath: fp });
    }
  }
  return out;
}

// 폴더 하위 트랙을 인덱스에서만 제거 (실제 파일은 그대로) — 라이브러리 "Remove"와 같은
// 비파괴 동작을 폴더 단위로 적용. 지운 트랙 수를 반환한다.
export function removeTracksUnderFolder(
  libraryId: number,
  folderPathNorm: string,
): number {
  const ids = getFolderTrackRows(libraryId, folderPathNorm).map((r) => r.id);
  if (ids.length === 0) return 0;
  const db = getDb();
  db.exec("BEGIN TRANSACTION");
  try {
    // removeTrack과 같은 이유 — 인덱스에서 뺀 폴더가 다음 증분 스캔에서 프루닝되어
    // 영영 돌아오지 않는 일이 없도록 이 라이브러리의 디렉터리 스냅샷을 무효화한다.
    run("DELETE FROM scan_dirs WHERE library_id = ?", [libraryId]);
    const delColl = prep("DELETE FROM collection_tracks WHERE track_id = ?");
    const delTrack = prep("DELETE FROM tracks WHERE id = ?");
    for (const id of ids) {
      delColl.run(id);
      delTrack.run(id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  persistDb();
  return ids.length;
}

// 폴더 rename(디스크 rename은 호출부에서 이미 수행)에 맞춰 하위 트랙들의 file_path 접두사를
// 옛 폴더 경로 → 새 폴더 경로로 일괄 치환한다. filename(파일명)은 바뀌지 않는다.
export function updateFolderTrackPaths(
  rows: { id: number; filePath: string }[],
  oldRealFolder: string,
  newRealFolder: string,
): void {
  const db = getDb();
  db.exec("BEGIN TRANSACTION");
  try {
    const upd = prep("UPDATE tracks SET file_path = ? WHERE id = ?");
    for (const r of rows) {
      const suffix = r.filePath.slice(oldRealFolder.length);
      const newPath = newRealFolder + suffix;
      upd.run(newPath, r.id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  persistDb();
}

function applyTagPatch(
  currentTags: string[],
  patch: TrackMetadataPatch,
): string[] {
  if (patch.tags) return patch.tags;
  let next = currentTags;
  if (patch.removeTags && patch.removeTags.length > 0) {
    const remove = new Set(patch.removeTags);
    next = next.filter((t) => !remove.has(t));
  }
  if (patch.addTags && patch.addTags.length > 0) {
    const existing = new Set(next);
    for (const tag of patch.addTags) {
      if (!existing.has(tag)) {
        next = [...next, tag];
        existing.add(tag);
      }
    }
  }
  return next;
}

// 행 업데이트만 수행하고 persist는 하지 않는 내부 헬퍼 — 배치 편집에서 트랙마다
// 전체 DB export가 반복되지 않도록, persist는 호출자가 마지막에 한 번만 하도록 분리한다.
function applyTrackMetadata(
  trackId: number,
  patch: TrackMetadataPatch,
): Track | null {
  const row = selectRow("SELECT * FROM tracks WHERE id = ?", [trackId]);
  if (!row) return null;
  const nextCategory =
    patch.category !== undefined
      ? patch.category
      : (row.category as string | null);
  const nextSubcategory =
    patch.subcategory !== undefined
      ? patch.subcategory
      : (row.subcategory as string | null);
  const nextDescription =
    patch.description !== undefined
      ? patch.description
      : (row.description as string | null);
  const currentTags = row.tags
    ? (JSON.parse(row.tags as string) as string[])
    : [];
  const nextTags =
    patch.tags !== undefined ||
    patch.addTags !== undefined ||
    patch.removeTags !== undefined
      ? applyTagPatch(currentTags, patch)
      : currentTags;

  run(
    "UPDATE tracks SET category = ?, subcategory = ?, description = ?, tags = ? WHERE id = ?",
    [
      nextCategory,
      nextSubcategory,
      nextDescription,
      JSON.stringify(nextTags),
      trackId,
    ],
  );
  const updated = selectRow("SELECT * FROM tracks WHERE id = ?", [trackId]);
  return updated ? rowToTrack(updated) : null;
}

export function updateTrackMetadata(
  trackId: number,
  patch: TrackMetadataPatch,
): Track | null {
  const track = applyTrackMetadata(trackId, patch);
  persistDb();
  return track;
}

export function batchUpdateTrackMetadata(
  trackIds: number[],
  patch: TrackMetadataPatch,
): Track[] {
  const updated: Track[] = [];
  for (const id of trackIds) {
    const track = applyTrackMetadata(id, patch);
    if (track) updated.push(track);
  }
  // 배치 전체를 한 번에 반영 — DB 전체 직렬화(db.export())가 트랙 수만큼이 아니라 1회만 발생.
  if (updated.length > 0) persistDb();
  return updated;
}

// 같은 file_hash + file_size를 가진 트랙(=바이트 단위로 동일할 가능성이 매우 높은 파일)을
// 묶어 반환한다 — 2개 이상 모인 그룹만 포함. 각 그룹은 added_at 오름차순(먼저 추가된 것이
// "원본" 후보로 앞에 오도록) 정렬.
export function findDuplicateGroups(): Track[][] {
  const rows = selectRows(
    `SELECT file_hash, file_size FROM tracks
     WHERE file_hash IS NOT NULL AND file_size IS NOT NULL
     GROUP BY file_hash, file_size HAVING COUNT(*) > 1`,
  );
  const groups: Track[][] = [];
  for (const row of rows) {
    const members = selectRows(
      "SELECT * FROM tracks WHERE file_hash = ? AND file_size = ? ORDER BY added_at ASC",
      [row.file_hash, row.file_size],
    ).map(rowToTrack);
    if (members.length > 1) groups.push(members);
  }
  return groups;
}

export function getTrackById(trackId: number): Track | null {
  const row = selectRow("SELECT * FROM tracks WHERE id = ?", [trackId]);
  return row ? rowToTrack(row) : null;
}

// 포인트 마커(초 단위) 목록 전체를 교체 저장
export function updateTrackMarkers(
  trackId: number,
  markers: number[],
): Track | null {
  run("UPDATE tracks SET markers = ? WHERE id = ?", [
    JSON.stringify(markers),
    trackId,
  ]);
  schedulePersist();
  return getTrackById(trackId);
}

// 파일 리네임 후 DB에 반영된 새 경로/파일명을 기록
export function renameTrackFile(
  trackId: number,
  filePath: string,
  filename: string,
): void {
  run("UPDATE tracks SET file_path = ?, filename = ? WHERE id = ?", [
    filePath,
    filename,
    trackId,
  ]);
  persistDb();
}

// ── Collections ──
export function getCollections(): Collection[] {
  return selectRows("SELECT * FROM collections ORDER BY created_at").map(
    (row) => {
      const id = row.id as number;
      const trackIds = selectRows(
        "SELECT track_id FROM collection_tracks WHERE collection_id = ? ORDER BY position",
        [id],
      ).map((r) => r.track_id as number);
      return {
        id,
        name: row.name as string,
        trackIds,
        createdAt: (row.created_at as number) ?? 0,
        color: (row.color as string) ?? null,
      };
    },
  );
}

export function createCollection(name: string): void {
  run("INSERT INTO collections (name, created_at) VALUES (?, ?)", [
    name,
    Date.now(),
  ]);
  persistDb();
}

export function deleteCollection(id: number): void {
  run("DELETE FROM collection_tracks WHERE collection_id = ?", [id]);
  run("DELETE FROM collections WHERE id = ?", [id]);
  persistDb();
}

export function renameCollection(id: number, name: string): void {
  run("UPDATE collections SET name = ? WHERE id = ?", [name, id]);
  persistDb();
}

export function setCollectionColor(id: number, color: string | null): void {
  run("UPDATE collections SET color = ? WHERE id = ?", [color, id]);
  persistDb();
}

export function addTrackToCollection(
  collectionId: number,
  trackId: number,
): void {
  const pos = selectRow(
    "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM collection_tracks WHERE collection_id = ?",
    [collectionId],
  )?.p as number;
  run(
    "INSERT OR IGNORE INTO collection_tracks (collection_id, track_id, position) VALUES (?, ?, ?)",
    [collectionId, trackId, pos],
  );
  persistDb();
}

export function addTracksToCollection(
  collectionId: number,
  trackIds: number[],
): void {
  let pos = selectRow(
    "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM collection_tracks WHERE collection_id = ?",
    [collectionId],
  )?.p as number;
  const ins = prep(
    "INSERT OR IGNORE INTO collection_tracks (collection_id, track_id, position) VALUES (?, ?, ?)",
  );
  for (const trackId of trackIds) {
    ins.run(collectionId, trackId, pos);
    pos++;
  }
  persistDb();
}

export function removeTrackFromCollection(
  collectionId: number,
  trackId: number,
): void {
  run(
    "DELETE FROM collection_tracks WHERE collection_id = ? AND track_id = ?",
    [collectionId, trackId],
  );
  persistDb();
}

// 드래그로 사용자가 지정한 새 순서를 position 컬럼에 그대로 기록
export function reorderCollectionTracks(
  collectionId: number,
  orderedTrackIds: number[],
): void {
  const upd = prep(
    "UPDATE collection_tracks SET position = ? WHERE collection_id = ? AND track_id = ?",
  );
  orderedTrackIds.forEach((trackId, position) => {
    upd.run(position, collectionId, trackId);
  });
  persistDb();
}

// 검색 ---------------------------------------------------------------------
//
// 렌더러가 51만 트랙 배열을 매번 훑는 대신 FTS5 인덱스에 물어본다. Track 객체가 아니라
// id만 돌려주는 이유: 렌더러는 이미 전체 트랙을 메모리에 들고 있으므로 id로 찾아 쓰면
// 되고, 그러면 결과가 8만 건이어도 IPC 페이로드가 숫자 배열 하나뿐이라 상한을 둘 필요가
// 없다(실측: 79,927건 6.5ms).
//
// trigram 토크나이저는 3글자 미만 질의를 인덱스로 처리하지 못한다. 1~2글자는 호출부
// (렌더러)가 기존 인메모리 스캔으로 처리하므로 여기서는 빈 배열을 돌려준다 —
// LIKE 전체 스캔으로 대신하면 드문 문자열에서 350ms까지 걸려 더 느리다.
export const FTS_MIN_QUERY_LENGTH = 3;

/** FTS5 문자열 리터럴로 감싼다. 큰따옴표로 감싸야 질의 전체가 하나의 구문으로 취급되어
 *  공백·하이픈 같은 문자가 연산자로 해석되지 않는다. 내부 큰따옴표는 겹쳐서 이스케이프. */
function ftsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

export function searchTrackIds(query: string): number[] {
  const q = query.trim().toLowerCase();
  if (q.length < FTS_MIN_QUERY_LENGTH) return [];
  try {
    return prep("SELECT rowid FROM tracks_fts WHERE blob MATCH ?")
      .pluck()
      .all(ftsPhrase(q)) as number[];
  } catch (err) {
    // 구두점만으로 된 질의처럼 trigram이 토큰을 못 만드는 입력은 FTS5가 예외를 던진다.
    // 검색 한 번 실패로 앱이 멈출 이유는 없으니 빈 결과로 처리한다.
    console.error("검색 실패:", (err as Error)?.message);
    return [];
  }
}
