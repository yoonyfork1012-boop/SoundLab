import Database from "better-sqlite3";
import { existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SOUNDLIB_DIR = join(homedir(), ".soundlib");
export const ARTWORK_DIR = join(SOUNDLIB_DIR, "artwork");
const DB_PATH = join(SOUNDLIB_DIR, "soundlib.db");

let db: Database.Database | null = null;

function ensureDirs(): void {
  if (!existsSync(SOUNDLIB_DIR)) mkdirSync(SOUNDLIB_DIR, { recursive: true });
  if (!existsSync(ARTWORK_DIR)) mkdirSync(ARTWORK_DIR, { recursive: true });
}

export async function initDb(): Promise<void> {
  if (db) return;
  ensureDirs();

  // 손상된 DB(예: 비정상 종료/동시 쓰기)로 앱이 아예 안 켜지는 것을 방지 —
  // 열기 실패 시 손상 파일을 백업으로 옮기고 새 DB로 시작
  try {
    db = new Database(DB_PATH);
  } catch (err) {
    if (existsSync(DB_PATH)) {
      try {
        renameSync(DB_PATH, `${DB_PATH}.corrupt-${Date.now()}`);
      } catch {
        /* noop */
      }
    }
    console.error("손상된 DB 감지 → 새 DB로 시작:", (err as Error)?.message);
    db = new Database(DB_PATH);
  }

  // better-sqlite3는 파일 기반 네이티브 SQLite라 sql.js와 달리 각 쓰기가 그 자리에서
  // 바로 디스크(WAL)에 반영된다 — WAL은 리더가 쓰기를 막지 않고, NORMAL 동기화는
  // 커밋마다 fsync하지 않아도 crash-safe하다(OS 크래시가 아닌 프로세스 크래시 기준).
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
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

    -- 증분 인덱싱용 디렉터리 스냅샷. 폴더의 mtime이 지난 스캔 때와 같으면 그 폴더
    -- 직속 파일들은 추가/삭제/이름변경이 없었다는 뜻이라 파일별 stat을 통째로 건너뛴다.
    -- (수십만 파일 라이브러리에서 재스캔 시간을 지배하던 것이 이 stat 호출이었다.)
    CREATE TABLE IF NOT EXISTS scan_dirs (
      library_id INTEGER NOT NULL,
      dir_path TEXT NOT NULL,
      mtime_ms REAL,
      PRIMARY KEY (library_id, dir_path)
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_category ON tracks(category);
    CREATE INDEX IF NOT EXISTS idx_tracks_filename ON tracks(filename);
    CREATE INDEX IF NOT EXISTS idx_tracks_library ON tracks(library_id);
  `);

  runMigrations();
}

// CREATE TABLE IF NOT EXISTS는 기존 DB에 새 컬럼을 추가해주지 않으므로,
// 이미 테이블이 있던 예전 DB에도 새 컬럼이 생기도록 직접 확인 후 ALTER TABLE
function runMigrations(): void {
  const d = getDb();

  function hasColumn(table: string, column: string): boolean {
    const rows = d.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    return rows.some((row) => row.name === column);
  }

  if (!hasColumn("collections", "color")) {
    d.exec("ALTER TABLE collections ADD COLUMN color TEXT");
  }
  if (!hasColumn("libraries", "monitor")) {
    d.exec("ALTER TABLE libraries ADD COLUMN monitor INTEGER DEFAULT 0");
  }
  if (!hasColumn("libraries", "analyzed_at")) {
    d.exec("ALTER TABLE libraries ADD COLUMN analyzed_at INTEGER");
  }
  if (!hasColumn("tracks", "similarity_key")) {
    d.exec("ALTER TABLE tracks ADD COLUMN similarity_key TEXT");
  }
  if (!hasColumn("tracks", "mtime_ms")) {
    d.exec("ALTER TABLE tracks ADD COLUMN mtime_ms REAL");
  }
  if (!hasColumn("tracks", "file_size")) {
    d.exec("ALTER TABLE tracks ADD COLUMN file_size INTEGER");
  }
  if (!hasColumn("tracks", "publisher")) {
    d.exec("ALTER TABLE tracks ADD COLUMN publisher TEXT");
  }
  if (!hasColumn("tracks", "is_float")) {
    d.exec("ALTER TABLE tracks ADD COLUMN is_float INTEGER DEFAULT 0");
  }
  if (!hasColumn("tracks", "file_hash")) {
    d.exec("ALTER TABLE tracks ADD COLUMN file_hash TEXT");
  }
  if (!hasColumn("tracks", "markers")) {
    d.exec("ALTER TABLE tracks ADD COLUMN markers TEXT");
  }
  // 이름변경/이동 후보 탐색(size+hash) 성능을 위한 인덱스 — 대용량 라이브러리에서 매 add 이벤트마다
  // 풀스캔하지 않도록 함
  d.exec(
    "CREATE INDEX IF NOT EXISTS idx_tracks_hash ON tracks(file_hash, file_size)",
  );
}

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized — call initDb() first");
  return db;
}

// better-sqlite3는 매 쓰기가 즉시 파일(WAL)에 반영되는 네이티브 SQLite라, sql.js 시절
// DB 전체를 재직렬화해 통째로 파일에 다시 쓰던 persistDb/schedulePersist/flushPersist
// 파이프라인이 더 이상 필요 없다. 호출부(queries.ts, ipc.ts 전역)를 전부 고치는 대신
// 이 함수들의 시그니처만 유지하고, WAL 체크포인트로 내용을 단순화했다.
export function persistDb(): void {
  if (!db) return;
  db.pragma("wal_checkpoint(PASSIVE)");
}

export function schedulePersist(): void {
  // better-sqlite3는 매 UPDATE가 이미 WAL에 반영되어 있으므로 디바운스로 미룰 저장이 없다.
}

export function flushPersist(): void {
  if (!db) return;
  db.pragma("wal_checkpoint(TRUNCATE)");
}

export function closeDb(): void {
  if (!db) return;
  flushPersist();
  db.close();
  db = null;
}
