import { getDb, persistDb } from './index'
import type { Collection, Library, Track } from '../../shared/types'

type SqlRow = Record<string, unknown>

function selectRows(sql: string, params: unknown[] = []): SqlRow[] {
  const db = getDb()
  const stmt = db.prepare(sql)
  stmt.bind(params as never)
  const rows: SqlRow[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
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
    artworkSource: (row.artwork_source as Track['artworkSource']) ?? null,
    addedAt: row.added_at as number,
    lastPlayedAt: (row.last_played_at as number) ?? null,
    fileSize: (row.file_size as number) ?? null,
    publisher: (row.publisher as string) ?? null,
    isFloat: row.is_float === 1
  }
}

export function upsertLibrary(rootPath: string, name: string): Library {
  const db = getDb()
  const existing = selectRows('SELECT * FROM libraries WHERE root_path = ?', [rootPath])

  if (existing.length > 0) {
    return rowToLibrary(existing[0])
  }

  const createdAt = Date.now()
  db.run('INSERT INTO libraries (root_path, name, created_at) VALUES (?, ?, ?)', [
    rootPath,
    name,
    createdAt
  ])
  const id = selectRows('SELECT last_insert_rowid() AS id')[0].id as number
  persistDb()

  return { id, rootPath, name, createdAt, monitor: false, analyzedAt: null }
}

export function beginScanBatch(): void {
  getDb().run('BEGIN TRANSACTION')
}

export function endScanBatch(): void {
  getDb().run('COMMIT')
  persistDb()
}

export function rollbackScanBatch(): void {
  try {
    getDb().run('ROLLBACK')
  } catch {
    /* noop */
  }
}

export function upsertTrack(track: {
  libraryId: number
  filePath: string
  filename: string
  durationMs: number | null
  sampleRate: number | null
  bitDepth: number | null
  channels: number | null
  category: string | null
  subcategory: string | null
  artworkPath?: string | null
  artworkSource?: string | null
  mtimeMs?: number | null
  fileSize?: number | null
  publisher?: string | null
  isFloat?: boolean
}): void {
  getDb().run(
    `INSERT INTO tracks (library_id, file_path, filename, duration_ms, sample_rate, bit_depth, channels, category, subcategory, artwork_path, artwork_source, mtime_ms, file_size, publisher, is_float, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
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
       is_float = excluded.is_float`,
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
      Date.now()
    ]
  )
}

// 라이브러리의 기존 트랙 파일별 mtime/size 스냅샷 — 스캔 시 파일별 stat과 비교해
// 변경되지 않은 파일은 재파싱(메타데이터 재추출)을 건너뛰기 위한 증분 인덱싱 기반.
export function getTrackStatsByLibrary(
  libraryId: number
): Map<string, { mtimeMs: number | null; fileSize: number | null }> {
  const rows = selectRows('SELECT file_path, mtime_ms, file_size FROM tracks WHERE library_id = ?', [
    libraryId
  ])
  const map = new Map<string, { mtimeMs: number | null; fileSize: number | null }>()
  for (const row of rows) {
    map.set(row.file_path as string, {
      mtimeMs: (row.mtime_ms as number) ?? null,
      fileSize: (row.file_size as number) ?? null
    })
  }
  return map
}

export function deleteMissingTracks(libraryId: number, presentFilePaths: Set<string>): number {
  const stale = selectRows('SELECT id, file_path FROM tracks WHERE library_id = ?', [libraryId]).filter(
    (row) => !presentFilePaths.has(row.file_path as string)
  )
  const db = getDb()
  for (const row of stale) {
    const trackId = row.id as number
    db.run('DELETE FROM collection_tracks WHERE track_id = ?', [trackId])
    db.run('DELETE FROM tracks WHERE id = ?', [trackId])
  }
  return stale.length
}

export function hasTrackFilePath(filePath: string): boolean {
  return selectRows('SELECT 1 FROM tracks WHERE file_path = ? LIMIT 1', [filePath]).length > 0
}

export function getAllTracks(): Track[] {
  return selectRows('SELECT * FROM tracks ORDER BY filename').map(rowToTrack)
}

function rowToLibrary(row: SqlRow): Library {
  return {
    id: row.id as number,
    rootPath: row.root_path as string,
    name: row.name as string,
    createdAt: row.created_at as number,
    monitor: row.monitor === 1,
    analyzedAt: (row.analyzed_at as number) ?? null
  }
}

export function getAllLibraries(): Library[] {
  return selectRows('SELECT * FROM libraries ORDER BY created_at').map(rowToLibrary)
}

export function renameLibrary(id: number, name: string): void {
  getDb().run('UPDATE libraries SET name = ? WHERE id = ?', [name, id])
  persistDb()
}

export function setLibraryMonitor(id: number, on: boolean): void {
  getDb().run('UPDATE libraries SET monitor = ? WHERE id = ?', [on ? 1 : 0, id])
  persistDb()
}

export function markLibraryAnalyzed(id: number, at: number): void {
  getDb().run('UPDATE libraries SET analyzed_at = ? WHERE id = ?', [at, id])
  persistDb()
}

// "Analyze for Find Similar" — 실제 오디오 콘텐츠 분석(핑거프린팅) 대신, 이미 갖고 있는
// 메타데이터(길이/채널/샘플레이트/비트뎁스)로 근사 유사도 키를 만들어 저장한다.
// 추후 진짜 오디오 지문 분석으로 교체 가능하도록 similarity_key 컬럼만 사용.
export function computeSimilarityKeys(libraryId: number): number {
  const tracks = selectRows(
    'SELECT id, duration_ms, channels, sample_rate, bit_depth FROM tracks WHERE library_id = ?',
    [libraryId]
  )
  const db = getDb()
  for (const row of tracks) {
    const durBucket = row.duration_ms ? Math.round((row.duration_ms as number) / 50) : 0
    const key = `${durBucket}-${row.channels ?? 0}-${row.sample_rate ?? 0}-${row.bit_depth ?? 0}`
    db.run('UPDATE tracks SET similarity_key = ? WHERE id = ?', [key, row.id as number])
  }
  persistDb()
  return tracks.length
}

export function deleteLibrary(libraryId: number): void {
  const db = getDb()
  db.run('DELETE FROM collection_tracks WHERE track_id IN (SELECT id FROM tracks WHERE library_id = ?)', [
    libraryId
  ])
  db.run('DELETE FROM tracks WHERE library_id = ?', [libraryId])
  db.run('DELETE FROM libraries WHERE id = ?', [libraryId])
  persistDb()
}

export function toggleStarred(trackId: number): boolean {
  const rows = selectRows('SELECT starred FROM tracks WHERE id = ?', [trackId])
  const next = rows[0]?.starred === 1 ? 0 : 1
  getDb().run('UPDATE tracks SET starred = ? WHERE id = ?', [next, trackId])
  persistDb()
  return next === 1
}

export function updateLastPlayed(trackId: number): void {
  getDb().run('UPDATE tracks SET last_played_at = ? WHERE id = ?', [Date.now(), trackId])
  persistDb()
}

// ── Collections ──
export function getCollections(): Collection[] {
  return selectRows('SELECT * FROM collections ORDER BY created_at').map((row) => {
    const id = row.id as number
    const trackIds = selectRows(
      'SELECT track_id FROM collection_tracks WHERE collection_id = ? ORDER BY position',
      [id]
    ).map((r) => r.track_id as number)
    return {
      id,
      name: row.name as string,
      trackIds,
      createdAt: (row.created_at as number) ?? 0,
      color: (row.color as string) ?? null
    }
  })
}

export function createCollection(name: string): void {
  getDb().run('INSERT INTO collections (name, created_at) VALUES (?, ?)', [name, Date.now()])
  persistDb()
}

export function deleteCollection(id: number): void {
  const db = getDb()
  db.run('DELETE FROM collection_tracks WHERE collection_id = ?', [id])
  db.run('DELETE FROM collections WHERE id = ?', [id])
  persistDb()
}

export function renameCollection(id: number, name: string): void {
  getDb().run('UPDATE collections SET name = ? WHERE id = ?', [name, id])
  persistDb()
}

export function setCollectionColor(id: number, color: string | null): void {
  getDb().run('UPDATE collections SET color = ? WHERE id = ?', [color, id])
  persistDb()
}

export function addTrackToCollection(collectionId: number, trackId: number): void {
  const db = getDb()
  const pos = selectRows(
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM collection_tracks WHERE collection_id = ?',
    [collectionId]
  )[0].p as number
  db.run(
    'INSERT OR IGNORE INTO collection_tracks (collection_id, track_id, position) VALUES (?, ?, ?)',
    [collectionId, trackId, pos]
  )
  persistDb()
}

export function addTracksToCollection(collectionId: number, trackIds: number[]): void {
  const db = getDb()
  let pos = selectRows(
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM collection_tracks WHERE collection_id = ?',
    [collectionId]
  )[0].p as number
  for (const trackId of trackIds) {
    db.run(
      'INSERT OR IGNORE INTO collection_tracks (collection_id, track_id, position) VALUES (?, ?, ?)',
      [collectionId, trackId, pos]
    )
    pos++
  }
  persistDb()
}

export function removeTrackFromCollection(collectionId: number, trackId: number): void {
  getDb().run('DELETE FROM collection_tracks WHERE collection_id = ? AND track_id = ?', [
    collectionId,
    trackId
  ])
  persistDb()
}

// 드래그로 사용자가 지정한 새 순서를 position 컬럼에 그대로 기록
export function reorderCollectionTracks(collectionId: number, orderedTrackIds: number[]): void {
  const db = getDb()
  orderedTrackIds.forEach((trackId, position) => {
    db.run(
      'UPDATE collection_tracks SET position = ? WHERE collection_id = ? AND track_id = ?',
      [position, collectionId, trackId]
    )
  })
  persistDb()
}
