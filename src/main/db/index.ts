import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";

const SOUNDLIB_DIR = join(homedir(), ".soundlib");
export const ARTWORK_DIR = join(SOUNDLIB_DIR, "artwork");
const DB_PATH = join(SOUNDLIB_DIR, "soundlib.db");

let db: Database | null = null;

function ensureDirs(): void {
  if (!existsSync(SOUNDLIB_DIR)) mkdirSync(SOUNDLIB_DIR, { recursive: true });
  if (!existsSync(ARTWORK_DIR)) mkdirSync(ARTWORK_DIR, { recursive: true });
}

export async function initDb(): Promise<void> {
  if (db) return;
  ensureDirs();

  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  const SQL: SqlJsStatic = await initSqlJs({ locateFile: () => wasmPath });

  // 손상된 DB(예: 비정상 종료/동시 쓰기)로 앱이 아예 안 켜지는 것을 방지 —
  // 로드 실패 시 손상 파일을 백업으로 옮기고 새 DB로 시작
  if (existsSync(DB_PATH)) {
    try {
      db = new SQL.Database(readFileSync(DB_PATH));
    } catch (err) {
      try {
        renameSync(DB_PATH, `${DB_PATH}.corrupt-${Date.now()}`);
      } catch {
        /* noop */
      }
      console.error("손상된 DB 감지 → 새 DB로 시작:", (err as Error)?.message);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
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
  persistDb();
}

// CREATE TABLE IF NOT EXISTS는 기존 DB에 새 컬럼을 추가해주지 않으므로,
// 이미 테이블이 있던 예전 DB에도 새 컬럼이 생기도록 직접 확인 후 ALTER TABLE
function runMigrations(): void {
  const d = getDb();

  function hasColumn(table: string, column: string): boolean {
    const stmt = d.prepare(`PRAGMA table_info(${table})`);
    let found = false;
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.name === column) {
        found = true;
        break;
      }
    }
    stmt.free();
    return found;
  }

  if (!hasColumn("collections", "color")) {
    d.run("ALTER TABLE collections ADD COLUMN color TEXT");
  }
  if (!hasColumn("libraries", "monitor")) {
    d.run("ALTER TABLE libraries ADD COLUMN monitor INTEGER DEFAULT 0");
  }
  if (!hasColumn("libraries", "analyzed_at")) {
    d.run("ALTER TABLE libraries ADD COLUMN analyzed_at INTEGER");
  }
  if (!hasColumn("tracks", "similarity_key")) {
    d.run("ALTER TABLE tracks ADD COLUMN similarity_key TEXT");
  }
  if (!hasColumn("tracks", "mtime_ms")) {
    d.run("ALTER TABLE tracks ADD COLUMN mtime_ms REAL");
  }
  if (!hasColumn("tracks", "file_size")) {
    d.run("ALTER TABLE tracks ADD COLUMN file_size INTEGER");
  }
  if (!hasColumn("tracks", "publisher")) {
    d.run("ALTER TABLE tracks ADD COLUMN publisher TEXT");
  }
  if (!hasColumn("tracks", "is_float")) {
    d.run("ALTER TABLE tracks ADD COLUMN is_float INTEGER DEFAULT 0");
  }
  if (!hasColumn("tracks", "file_hash")) {
    d.run("ALTER TABLE tracks ADD COLUMN file_hash TEXT");
  }
  if (!hasColumn("tracks", "loop_start")) {
    d.run("ALTER TABLE tracks ADD COLUMN loop_start REAL");
  }
  if (!hasColumn("tracks", "loop_end")) {
    d.run("ALTER TABLE tracks ADD COLUMN loop_end REAL");
  }
  if (!hasColumn("tracks", "markers")) {
    d.run("ALTER TABLE tracks ADD COLUMN markers TEXT");
  }
  // 이름변경/이동 후보 탐색(size+hash) 성능을 위한 인덱스 — 대용량 라이브러리에서 매 add 이벤트마다
  // 풀스캔하지 않도록 함
  d.run(
    "CREATE INDEX IF NOT EXISTS idx_tracks_hash ON tracks(file_hash, file_size)",
  );
}

export function getDb(): Database {
  if (!db) throw new Error("Database not initialized — call initDb() first");
  return db;
}

// sql.js는 메모리 DB라 저장할 때마다 DB 전체를 직렬화해(db.export()) 파일에 통째로 쓴다.
// 수천 트랙 라이브러리에서는 이 한 번이 수십~수백 ms가 걸리고, 그동안 메인 스레드가 멈춰
// 같은 스레드에서 처리되는 IPC(file:getAudioAccess 등)까지 함께 지연된다. 트랙을 클릭할
// 때마다 호출되는 last_played 같은 고빈도 쓰기는 schedulePersist()로 묶어 유휴 시점에
// 한 번만 저장한다. 스캔/컬렉션/메타데이터 편집처럼 드물고 중요한 쓰기는 persistDb()로 즉시.
const PERSIST_DEBOUNCE_MS = 800;
let persistTimer: NodeJS.Timeout | null = null;

// 쓰는 도중 프로세스가 죽어도 기존 DB가 반쪽짜리로 남지 않도록 임시 파일에 쓴 뒤 교체한다
function writeDbFile(): void {
  if (!db) return;
  const tmpPath = `${DB_PATH}.tmp`;
  writeFileSync(tmpPath, Buffer.from(db.export()));
  renameSync(tmpPath, DB_PATH);
}

export function persistDb(): void {
  if (!db) return;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  writeDbFile();
}

// 고빈도 쓰기용 — 마지막 호출로부터 PERSIST_DEBOUNCE_MS 동안 조용하면 그때 한 번만 저장.
// 저장 전에 앱이 강제 종료되면 그 사이의 변경(마지막 재생 시각 등)은 유실될 수 있다.
export function schedulePersist(): void {
  if (!db) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeDbFile();
  }, PERSIST_DEBOUNCE_MS);
  // 저장 대기 타이머 때문에 앱 종료가 지연되지 않게 함
  persistTimer.unref?.();
}

// 종료 직전 등, 예약된 저장이 남아 있으면 지금 즉시 기록
export function flushPersist(): void {
  if (!persistTimer) return;
  persistDb();
}

export function closeDb(): void {
  if (!db) return;
  persistDb();
  db.close();
  db = null;
}
