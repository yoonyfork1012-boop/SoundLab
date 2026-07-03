import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const SOUNDLIB_DIR = join(homedir(), '.soundlib')
export const ARTWORK_DIR = join(SOUNDLIB_DIR, 'artwork')
const DB_PATH = join(SOUNDLIB_DIR, 'soundlib.db')

let db: Database | null = null

function ensureDirs(): void {
  if (!existsSync(SOUNDLIB_DIR)) mkdirSync(SOUNDLIB_DIR, { recursive: true })
  if (!existsSync(ARTWORK_DIR)) mkdirSync(ARTWORK_DIR, { recursive: true })
}

export async function initDb(): Promise<void> {
  if (db) return
  ensureDirs()

  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  const SQL: SqlJsStatic = await initSqlJs({ locateFile: () => wasmPath })

  db = existsSync(DB_PATH) ? new SQL.Database(readFileSync(DB_PATH)) : new SQL.Database()

  db.run(`
    CREATE TABLE IF NOT EXISTS libraries (
      id INTEGER PRIMARY KEY,
      root_path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY,
      library_id INTEGER REFERENCES libraries(id),
      file_path TEXT UNIQUE NOT NULL,
      filename TEXT NOT NULL,
      duration_ms INTEGER,
      sample_rate INTEGER,
      bit_depth INTEGER,
      channels INTEGER,
      category TEXT,
      subcategory TEXT,
      description TEXT,
      tags TEXT,
      starred INTEGER DEFAULT 0,
      artwork_path TEXT,
      artwork_source TEXT,
      added_at INTEGER,
      last_played_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      artwork_path TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS collection_tracks (
      collection_id INTEGER REFERENCES collections(id),
      track_id INTEGER REFERENCES tracks(id),
      position INTEGER,
      PRIMARY KEY (collection_id, track_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_category ON tracks(category);
    CREATE INDEX IF NOT EXISTS idx_tracks_filename ON tracks(filename);
    CREATE INDEX IF NOT EXISTS idx_tracks_library ON tracks(library_id);
  `)

  persistDb()
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized — call initDb() first')
  return db
}

export function persistDb(): void {
  if (!db) return
  writeFileSync(DB_PATH, Buffer.from(db.export()))
}

export function closeDb(): void {
  if (!db) return
  persistDb()
  db.close()
  db = null
}
