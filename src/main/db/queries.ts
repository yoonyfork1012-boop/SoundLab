import { getDb, persistDb, schedulePersist } from "./index";
import type {
  Collection,
  Library,
  Track,
  TrackMetadataPatch,
} from "../../shared/types";

type SqlRow = Record<string, unknown>;

function selectRows(sql: string, params: unknown[] = []): SqlRow[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params as never);
  const rows: SqlRow[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
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
    loopStart: (row.loop_start as number) ?? null,
    loopEnd: (row.loop_end as number) ?? null,
    markers: row.markers ? (JSON.parse(row.markers as string) as number[]) : [],
  };
}

export function upsertLibrary(rootPath: string, name: string): Library {
  const db = getDb();
  const existing = selectRows("SELECT * FROM libraries WHERE root_path = ?", [
    rootPath,
  ]);

  if (existing.length > 0) {
    return rowToLibrary(existing[0]);
  }

  const createdAt = Date.now();
  db.run(
    "INSERT INTO libraries (root_path, name, created_at) VALUES (?, ?, ?)",
    [rootPath, name, createdAt],
  );
  const id = selectRows("SELECT last_insert_rowid() AS id")[0].id as number;
  persistDb();

  return { id, rootPath, name, createdAt, monitor: false, analyzedAt: null };
}

export function beginScanBatch(): void {
  getDb().run("BEGIN TRANSACTION");
}

export function endScanBatch(): void {
  getDb().run("COMMIT");
  persistDb();
}

export function rollbackScanBatch(): void {
  try {
    getDb().run("ROLLBACK");
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
  getDb().run(
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
  const rows = selectRows("SELECT * FROM tracks WHERE file_path = ?", [
    filePath,
  ]);
  return rows.length > 0 ? rowToTrack(rows[0]) : null;
}

// 같은 라이브러리 안에서 size+hash가 일치하는 트랙을 찾는다 — rename/move 후보 판별용.
// excludeFilePath는 방금 확인한 자기 자신(그대로 존재하는 파일)을 후보에서 제외하기 위함.
export function findRenameCandidate(
  libraryId: number,
  fileSize: number,
  fileHash: string,
  excludeFilePath: string,
): Track | null {
  const rows = selectRows(
    "SELECT * FROM tracks WHERE library_id = ? AND file_size = ? AND file_hash = ? AND file_path != ? LIMIT 1",
    [libraryId, fileSize, fileHash, excludeFilePath],
  );
  return rows.length > 0 ? rowToTrack(rows[0]) : null;
}

// 파일 삭제(unlink) 처리 — 컬렉션 소속 정리 후 트랙 제거. 아트워크 캐시 삭제는 호출부(watcher)에서
// getTrackByPath로 먼저 조회한 filePath를 이용해 별도로 처리한다.
// 감시 큐에서 대량 이벤트를 배치 처리할 때 매번 디스크에 전체 DB를 쓰지 않도록 persist는
// 호출부(watcher)가 배치 단위로 한 번만 수행한다.
export function deleteTrackByPath(filePath: string): void {
  const track = getTrackByPath(filePath);
  if (!track) return;
  const db = getDb();
  db.run("DELETE FROM collection_tracks WHERE track_id = ?", [track.id]);
  db.run("DELETE FROM tracks WHERE id = ?", [track.id]);
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
  getDb().run(
    "UPDATE tracks SET file_path = ?, filename = ?, mtime_ms = ?, file_size = ? WHERE id = ?",
    [filePath, filename, mtimeMs, fileSize, trackId],
  );
}

// 라이브러리의 기존 트랙 파일별 mtime/size 스냅샷 — 스캔 시 파일별 stat과 비교해
// 변경되지 않은 파일은 재파싱(메타데이터 재추출)을 건너뛰기 위한 증분 인덱싱 기반.
export function getTrackStatsByLibrary(
  libraryId: number,
): Map<string, { mtimeMs: number | null; fileSize: number | null }> {
  const rows = selectRows(
    "SELECT file_path, mtime_ms, file_size FROM tracks WHERE library_id = ?",
    [libraryId],
  );
  const map = new Map<
    string,
    { mtimeMs: number | null; fileSize: number | null }
  >();
  for (const row of rows) {
    map.set(row.file_path as string, {
      mtimeMs: (row.mtime_ms as number) ?? null,
      fileSize: (row.file_size as number) ?? null,
    });
  }
  return map;
}

export function deleteMissingTracks(
  libraryId: number,
  presentFilePaths: Set<string>,
): number {
  const stale = selectRows(
    "SELECT id, file_path FROM tracks WHERE library_id = ?",
    [libraryId],
  ).filter((row) => !presentFilePaths.has(row.file_path as string));
  const db = getDb();
  for (const row of stale) {
    const trackId = row.id as number;
    db.run("DELETE FROM collection_tracks WHERE track_id = ?", [trackId]);
    db.run("DELETE FROM tracks WHERE id = ?", [trackId]);
  }
  return stale.length;
}

export function hasTrackFilePath(filePath: string): boolean {
  return (
    selectRows("SELECT 1 FROM tracks WHERE file_path = ? LIMIT 1", [filePath])
      .length > 0
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
// 시작 시 사이드바를 즉시 그릴 수 있다. getAsObject 대신 exec를 써 대용량에서도 빠르다.
export function getTrackPathsByLibrary(): Map<number, string[]> {
  const res = getDb().exec(
    "SELECT library_id, file_path FROM tracks WHERE library_id IN (SELECT id FROM libraries)",
  );
  const byLib = new Map<number, string[]>();
  if (!res.length) return byLib;
  const rows = res[0].values;
  for (const [libId, filePath] of rows) {
    const id = libId as number;
    let arr = byLib.get(id);
    if (!arr) {
      arr = [];
      byLib.set(id, arr);
    }
    arr.push(filePath as string);
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
  getDb().run("UPDATE libraries SET name = ? WHERE id = ?", [name, id]);
  persistDb();
}

export function setLibraryMonitor(id: number, on: boolean): void {
  getDb().run("UPDATE libraries SET monitor = ? WHERE id = ?", [
    on ? 1 : 0,
    id,
  ]);
  persistDb();
}

export function markLibraryAnalyzed(id: number, at: number): void {
  getDb().run("UPDATE libraries SET analyzed_at = ? WHERE id = ?", [at, id]);
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
  const db = getDb();
  for (const row of tracks) {
    const durBucket = row.duration_ms
      ? Math.round((row.duration_ms as number) / 50)
      : 0;
    const key = `${durBucket}-${row.channels ?? 0}-${row.sample_rate ?? 0}-${row.bit_depth ?? 0}`;
    db.run("UPDATE tracks SET similarity_key = ? WHERE id = ?", [
      key,
      row.id as number,
    ]);
  }
  persistDb();
  return tracks.length;
}

// 트랙이 하나도 남지 않은 라이브러리를 정리한다. 폴더를 겹쳐 추가하면 겹치는 파일이
// 새로 추가한 라이브러리로 재귀속(upsertTrack의 ON CONFLICT library_id 갱신)되면서
// 예전 라이브러리가 빈 껍데기로 남을 수 있는데, 그것을 제거하기 위함.
// exceptLibraryId(방금 스캔한 라이브러리)는 오디오가 없는 폴더를 방금 추가했거나
// 네트워크 드라이브가 일시적으로 비어 보이는 경우 사용자의 폴더가 사라지지 않도록 보호한다.
export function deleteEmptyLibraries(exceptLibraryId?: number): number[] {
  const ids = selectRows(
    `SELECT id FROM libraries
     WHERE id NOT IN (SELECT DISTINCT library_id FROM tracks WHERE library_id IS NOT NULL)`,
  )
    .map((row) => row.id as number)
    .filter((id) => id !== exceptLibraryId);
  const db = getDb();
  for (const id of ids) {
    db.run("DELETE FROM libraries WHERE id = ?", [id]);
  }
  if (ids.length > 0) persistDb();
  return ids;
}

export function deleteLibrary(libraryId: number): void {
  const db = getDb();
  db.run(
    "DELETE FROM collection_tracks WHERE track_id IN (SELECT id FROM tracks WHERE library_id = ?)",
    [libraryId],
  );
  db.run("DELETE FROM tracks WHERE library_id = ?", [libraryId]);
  db.run("DELETE FROM libraries WHERE id = ?", [libraryId]);
  persistDb();
}

export function toggleStarred(trackId: number): boolean {
  const rows = selectRows("SELECT starred FROM tracks WHERE id = ?", [trackId]);
  const next = rows[0]?.starred === 1 ? 0 : 1;
  getDb().run("UPDATE tracks SET starred = ? WHERE id = ?", [next, trackId]);
  schedulePersist();
  return next === 1;
}

// 트랙을 클릭할 때마다 호출되는 가장 뜨거운 쓰기 경로 — 여기서 DB 전체를 동기 저장하면
// 같은 메인 스레드의 file:getAudioAccess IPC가 밀리고, 그 IPC를 기다리는 플레이어의
// ws.load() 호출이 늦어져 이전 사운드가 계속 재생된다. 반드시 디바운스 저장을 쓸 것.
export function updateLastPlayed(trackId: number): void {
  getDb().run("UPDATE tracks SET last_played_at = ? WHERE id = ?", [
    Date.now(),
    trackId,
  ]);
  schedulePersist();
}

// "Remove" (컨텍스트 메뉴) — 실제 파일은 건드리지 않고 라이브러리 인덱스에서만 제거.
// 다시 스캔하면 그대로 재인덱싱되므로 되돌릴 수 있는 안전한 동작이다.
export function removeTrack(trackId: number): void {
  const db = getDb();
  db.run("DELETE FROM collection_tracks WHERE track_id = ?", [trackId]);
  db.run("DELETE FROM tracks WHERE id = ?", [trackId]);
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
  const current = selectRows("SELECT * FROM tracks WHERE id = ?", [trackId]);
  if (current.length === 0) return null;
  const row = current[0];
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

  getDb().run(
    "UPDATE tracks SET category = ?, subcategory = ?, description = ?, tags = ? WHERE id = ?",
    [
      nextCategory,
      nextSubcategory,
      nextDescription,
      JSON.stringify(nextTags),
      trackId,
    ],
  );
  const updated = selectRows("SELECT * FROM tracks WHERE id = ?", [trackId]);
  return updated.length > 0 ? rowToTrack(updated[0]) : null;
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
  const rows = selectRows("SELECT * FROM tracks WHERE id = ?", [trackId]);
  return rows.length > 0 ? rowToTrack(rows[0]) : null;
}

// 웨이브폼에서 드래그한 A-B 구간을 트랙에 저장(자동저장) — null을 넘기면 구간 해제
export function updateTrackLoopRegion(
  trackId: number,
  start: number | null,
  end: number | null,
): Track | null {
  getDb().run("UPDATE tracks SET loop_start = ?, loop_end = ? WHERE id = ?", [
    start,
    end,
    trackId,
  ]);
  schedulePersist();
  return getTrackById(trackId);
}

// 포인트 마커(초 단위) 목록 전체를 교체 저장
export function updateTrackMarkers(
  trackId: number,
  markers: number[],
): Track | null {
  getDb().run("UPDATE tracks SET markers = ? WHERE id = ?", [
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
  getDb().run("UPDATE tracks SET file_path = ?, filename = ? WHERE id = ?", [
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
  getDb().run("INSERT INTO collections (name, created_at) VALUES (?, ?)", [
    name,
    Date.now(),
  ]);
  persistDb();
}

export function deleteCollection(id: number): void {
  const db = getDb();
  db.run("DELETE FROM collection_tracks WHERE collection_id = ?", [id]);
  db.run("DELETE FROM collections WHERE id = ?", [id]);
  persistDb();
}

export function renameCollection(id: number, name: string): void {
  getDb().run("UPDATE collections SET name = ? WHERE id = ?", [name, id]);
  persistDb();
}

export function setCollectionColor(id: number, color: string | null): void {
  getDb().run("UPDATE collections SET color = ? WHERE id = ?", [color, id]);
  persistDb();
}

export function addTrackToCollection(
  collectionId: number,
  trackId: number,
): void {
  const db = getDb();
  const pos = selectRows(
    "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM collection_tracks WHERE collection_id = ?",
    [collectionId],
  )[0].p as number;
  db.run(
    "INSERT OR IGNORE INTO collection_tracks (collection_id, track_id, position) VALUES (?, ?, ?)",
    [collectionId, trackId, pos],
  );
  persistDb();
}

export function addTracksToCollection(
  collectionId: number,
  trackIds: number[],
): void {
  const db = getDb();
  let pos = selectRows(
    "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM collection_tracks WHERE collection_id = ?",
    [collectionId],
  )[0].p as number;
  for (const trackId of trackIds) {
    db.run(
      "INSERT OR IGNORE INTO collection_tracks (collection_id, track_id, position) VALUES (?, ?, ?)",
      [collectionId, trackId, pos],
    );
    pos++;
  }
  persistDb();
}

export function removeTrackFromCollection(
  collectionId: number,
  trackId: number,
): void {
  getDb().run(
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
  const db = getDb();
  orderedTrackIds.forEach((trackId, position) => {
    db.run(
      "UPDATE collection_tracks SET position = ? WHERE collection_id = ? AND track_id = ?",
      [position, collectionId, trackId],
    );
  });
  persistDb();
}
