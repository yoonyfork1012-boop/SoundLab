import { getDb, persistDb } from './index'
import type { Library, Track } from '../../shared/types'

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
    lastPlayedAt: (row.last_played_at as number) ?? null
  }
}

export function upsertLibrary(rootPath: string, name: string): Library {
  const db = getDb()
  const existing = selectRows('SELECT * FROM libraries WHERE root_path = ?', [rootPath])

  if (existing.length > 0) {
    const row = existing[0]
    return {
      id: row.id as number,
      rootPath: row.root_path as string,
      name: row.name as string,
      createdAt: row.created_at as number
    }
  }

  const createdAt = Date.now()
  db.run('INSERT INTO libraries (root_path, name, created_at) VALUES (?, ?, ?)', [
    rootPath,
    name,
    createdAt
  ])
  const id = selectRows('SELECT last_insert_rowid() AS id')[0].id as number
  persistDb()

  return { id, rootPath, name, createdAt }
}

export function beginScanBatch(): void {
  getDb().run('BEGIN TRANSACTION')
}

export function endScanBatch(): void {
  getDb().run('COMMIT')
  persistDb()
}

export function upsertTrack(track: {
  libraryId: number
  filePath: string
  filename: string
  durationMs: number | null
  sampleRate: number | null
  bitDepth: number | null
  channels: number | null
}): void {
  getDb().run(
    `INSERT INTO tracks (library_id, file_path, filename, duration_ms, sample_rate, bit_depth, channels, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       duration_ms = excluded.duration_ms,
       sample_rate = excluded.sample_rate,
       bit_depth = excluded.bit_depth,
       channels = excluded.channels`,
    [
      track.libraryId,
      track.filePath,
      track.filename,
      track.durationMs,
      track.sampleRate,
      track.bitDepth,
      track.channels,
      Date.now()
    ]
  )
}

export function getTracksByLibrary(libraryId: number): Track[] {
  return selectRows('SELECT * FROM tracks WHERE library_id = ? ORDER BY filename', [
    libraryId
  ]).map(rowToTrack)
}

export function getAllTracks(): Track[] {
  return selectRows('SELECT * FROM tracks ORDER BY filename').map(rowToTrack)
}

export function getAllLibraries(): Library[] {
  return selectRows('SELECT * FROM libraries ORDER BY created_at').map((row) => ({
    id: row.id as number,
    rootPath: row.root_path as string,
    name: row.name as string,
    createdAt: row.created_at as number
  }))
}

export function deleteLibrary(libraryId: number): void {
  const db = getDb()
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
