import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SOUNDLIB_DIR = join(homedir(), ".soundlib");
export const ARTWORK_DIR = join(SOUNDLIB_DIR, "artwork");
const DB_PATH = join(SOUNDLIB_DIR, "soundlib.db");
// WAL 모드에서 DB는 세 파일이 한 세트다. 손상 파일을 치울 때 -wal/-shm을 남겨두면
// 새로 만든 빈 DB에 옛 WAL이 그대로 붙어 다시 손상되거나 아예 열리지 않는다.
const DB_SIDECARS = [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`];

let db: Database.Database | null = null;

function ensureDirs(): void {
  if (!existsSync(SOUNDLIB_DIR)) mkdirSync(SOUNDLIB_DIR, { recursive: true });
  if (!existsSync(ARTWORK_DIR)) mkdirSync(ARTWORK_DIR, { recursive: true });
}

// 손상된 DB(예: 비정상 종료/동시 쓰기)로 앱이 아예 안 켜지는 것을 방지 — 열기 실패는
// 물론이고 "열리기는 하는데 내용이 깨진" 경우까지 잡아야 해서 quick_check까지 본다.
// quick_check는 integrity_check와 달리 인덱스 정합성을 건너뛰어 대용량 DB에서도 빠르다.
function openWithRecovery(): Database.Database {
  let opened: Database.Database | null = null;
  try {
    opened = new Database(DB_PATH);
    const check = opened.pragma("quick_check", { simple: true });
    if (check !== "ok") throw new Error(`quick_check: ${String(check)}`);
    return opened;
  } catch (err) {
    try {
      opened?.close();
    } catch {
      /* 파일을 옮기기 전 최선의 정리 */
    }
    const suffix = `.corrupt-${Date.now()}`;
    for (const path of DB_SIDECARS) {
      if (!existsSync(path)) continue;
      try {
        renameSync(path, `${path}${suffix}`);
      } catch {
        /* noop */
      }
    }
    console.error("손상된 DB 감지 → 새 DB로 시작:", (err as Error)?.message);
    return new Database(DB_PATH);
  }
}

export async function initDb(): Promise<void> {
  if (db) return;
  ensureDirs();

  db = openWithRecovery();

  // better-sqlite3는 파일 기반 네이티브 SQLite라 sql.js와 달리 각 쓰기가 그 자리에서
  // 바로 디스크(WAL)에 반영된다 — WAL은 리더가 쓰기를 막지 않고, NORMAL 동기화는
  // 커밋마다 fsync하지 않아도 crash-safe하다(OS 크래시가 아닌 프로세스 크래시 기준).
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  // 쓰기가 겹쳐 SQLITE_BUSY로 즉시 실패하는 대신 잠깐 기다린다. 앱 안의 쓰기는 txLock으로
  // 직렬화하지만, 그 바깥(외부 도구, 남아 있던 이전 프로세스)까지 막아주지는 않는다.
  db.pragma("busy_timeout = 5000");

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
const COLUMN_MIGRATIONS: ReadonlyArray<
  [table: string, column: string, ddl: string]
> = [
  ["collections", "color", "ALTER TABLE collections ADD COLUMN color TEXT"],
  [
    "libraries",
    "monitor",
    "ALTER TABLE libraries ADD COLUMN monitor INTEGER DEFAULT 0",
  ],
  [
    "libraries",
    "analyzed_at",
    "ALTER TABLE libraries ADD COLUMN analyzed_at INTEGER",
  ],
  [
    "tracks",
    "similarity_key",
    "ALTER TABLE tracks ADD COLUMN similarity_key TEXT",
  ],
  ["tracks", "mtime_ms", "ALTER TABLE tracks ADD COLUMN mtime_ms REAL"],
  ["tracks", "file_size", "ALTER TABLE tracks ADD COLUMN file_size INTEGER"],
  ["tracks", "publisher", "ALTER TABLE tracks ADD COLUMN publisher TEXT"],
  [
    "tracks",
    "is_float",
    "ALTER TABLE tracks ADD COLUMN is_float INTEGER DEFAULT 0",
  ],
  ["tracks", "file_hash", "ALTER TABLE tracks ADD COLUMN file_hash TEXT"],
  ["tracks", "markers", "ALTER TABLE tracks ADD COLUMN markers TEXT"],
];

// 스키마를 실제로 건드리기 직전에만 한 벌 복사해 둔다. 마이그레이션이 없는 평상시 실행에서는
// 복사하지 않는다 — 수백 MB짜리 DB를 매번, 혹은 아무 일도 없는 시점에 스냅샷할 이유가 없다.
function backupBeforeMigration(): void {
  if (!existsSync(DB_PATH)) return;
  const dest = `${DB_PATH}.pre-migration-${Date.now()}.bak`;
  try {
    flushPersist(); // WAL을 본 파일로 접어 넣어야 복사본만으로 복구가 된다
    copyFileSync(DB_PATH, dest);
  } catch (err) {
    // 백업 실패로 앱이 안 켜지면 더 나쁘다 — 알리고 마이그레이션은 진행한다
    console.error("마이그레이션 전 백업 실패:", (err as Error)?.message);
  }
}

function runMigrations(): void {
  const d = getDb();

  function hasColumn(table: string, column: string): boolean {
    const rows = d.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    return rows.some((row) => row.name === column);
  }

  const pending = COLUMN_MIGRATIONS.filter(
    ([table, column]) => !hasColumn(table, column),
  );
  if (pending.length > 0) {
    backupBeforeMigration();
    for (const [, , ddl] of pending) d.exec(ddl);
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
