import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
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

  // 손상된 DB(예: 비정상 종료/동시 쓰기)로 앱이 아예 안 켜지는 것을 방지 —
  // 로드 실패 시 손상 파일을 백업으로 옮기고 새 DB로 시작
  if (existsSync(DB_PATH)) {
    try {
      db = new SQL.Database(readFileSync(DB_PATH))
    } catch (err) {
      try {
        renameSync(DB_PATH, `${DB_PATH}.corrupt-${Date.now()}`)
      } catch {
        /* noop */
      }
      console.error('손상된 DB 감지 → 새 DB로 시작:', (err as Error)?.message)
      db = new SQL.Database()
    }
  } else {
    db = new SQL.Database()
  }

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

  runMigrations()
  persistDb()
}

// CREATE TABLE IF NOT EXISTS는 기존 DB에 새 컬럼을 추가해주지 않으므로,
// 이미 테이블이 있던 예전 DB에도 새 컬럼이 생기도록 직접 확인 후 ALTER TABLE
function runMigrations(): void {
  const d = getDb()

  function hasColumn(table: string, column: string): boolean {
    const stmt = d.prepare(`PRAGMA table_info(${table})`)
    let found = false
    while (stmt.step()) {
      const row = stmt.getAsObject()
      if (row.name === column) {
        found = true
        break
      }
    }
    stmt.free()
    return found
  }

  if (!hasColumn('collections', 'color')) {
    d.run('ALTER TABLE collections ADD COLUMN color TEXT')
  }
  if (!hasColumn('libraries', 'monitor')) {
    d.run('ALTER TABLE libraries ADD COLUMN monitor INTEGER DEFAULT 0')
  }
  if (!hasColumn('libraries', 'analyzed_at')) {
    d.run('ALTER TABLE libraries ADD COLUMN analyzed_at INTEGER')
  }
  if (!hasColumn('tracks', 'similarity_key')) {
    d.run('ALTER TABLE tracks ADD COLUMN similarity_key TEXT')
  }
  if (!hasColumn('tracks', 'mtime_ms')) {
    d.run('ALTER TABLE tracks ADD COLUMN mtime_ms REAL')
  }
  if (!hasColumn('tracks', 'file_size')) {
    d.run('ALTER TABLE tracks ADD COLUMN file_size INTEGER')
  }
  if (!hasColumn('tracks', 'publisher')) {
    d.run('ALTER TABLE tracks ADD COLUMN publisher TEXT')
  }
  if (!hasColumn('tracks', 'is_float')) {
    d.run('ALTER TABLE tracks ADD COLUMN is_float INTEGER DEFAULT 0')
  }
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
