import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { open, type FileHandle } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import {
  isPlayableContainer,
  sniffAudioContainer,
} from "../../shared/audioFiles";

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
  ensureSearchIndex();
  await purgeNonAudioTracks();
}

// 오디오가 아닌 트랙 정리 (1회성) -------------------------------------------
//
// macOS에서 복사된 라이브러리에는 파일마다 AppleDouble 사이드카(4KB 껍데기)가 딸려 오고,
// 그게 .wav 확장자를 달고 트랙으로 색인돼 있다. 클릭해도 소리가 날 수 없다.
//
// 스캐너는 "디스크에서 사라진 파일"만 인덱스에서 지우는데(scanner/index.ts) 이 껍데기들은
// 디스크에 멀쩡히 있으므로 재스캔해도 영원히 남는다. 그래서 여기서 한 번 걷어낸다.
//
// 전 트랙을 훑지 않는다 — 메타데이터가 비어 있는 행만 후보다. 정상 파일은 sample_rate가
// 채워져 있으므로 이 검사에 걸리지 않는다.
async function purgeNonAudioTracks(): Promise<void> {
  const d = getDb();
  const candidates = d
    .prepare(
      "SELECT id, file_path, file_size FROM tracks WHERE sample_rate IS NULL",
    )
    .all() as { id: number; file_path: string; file_size: number | null }[];
  if (candidates.length === 0) return;

  const doomed: number[] = [];
  for (const row of candidates) {
    let handle: FileHandle | null = null;
    try {
      handle = await open(row.file_path, "r");
      const head = new Uint8Array(12);
      const { bytesRead } = await handle.read(head, 0, 12, 0);
      const kind = sniffAudioContainer(
        head.subarray(0, bytesRead),
        row.file_size ?? undefined,
      );
      // AIFF는 지우지 않는다 — 확장자만 .wav일 뿐 진짜 오디오이고, 스캐너가 고쳐지면
      // 다음 스캔에서 메타데이터가 채워진다.
      if (!isPlayableContainer(kind)) doomed.push(row.id);
    } catch {
      // 못 읽는 파일은 건드리지 않는다 — 드라이브가 잠깐 빠졌을 수도 있다.
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  if (doomed.length === 0) return;

  // 수천 행을 지우는 작업이라 되돌릴 수단을 남긴다.
  backupBeforeMigration();
  const del = d.prepare("DELETE FROM tracks WHERE id = ?");
  const delMembership = d.prepare(
    "DELETE FROM collection_tracks WHERE track_id = ?",
  );
  d.transaction(() => {
    for (const id of doomed) {
      delMembership.run(id);
      del.run(id);
    }
  })();
  console.log(`오디오가 아닌 트랙 ${doomed.length}건을 인덱스에서 제거했다.`);
}

// 검색 인덱스(FTS5 trigram) ------------------------------------------------
//
// 51만 트랙에서 검색어 한 글자마다 렌더러가 전체 배열을 훑던 것을 대체한다. trigram
// 토크나이저를 쓰는 이유는 기존 동작이 부분문자열 매칭(includes)이기 때문 — 기본
// unicode61은 토큰 접두어만 찾아서 "ick"으로 "kick"을 못 찾는다.
//
// 색인 문자열은 렌더러의 buildSearchBlob과 같은 필드 구성이다(파일명/카테고리/
// 서브카테고리/설명/태그). tags는 JSON 텍스트로 저장돼 있어 대괄호·따옴표를 공백으로
// 바꿔 태그끼리 이어붙지 않게 한다.
// 트리거 본문에서는 컬럼을 new.로 한정해야 하고(그냥 filename이라 쓰면 "no such column"),
// 최초 채우기의 SELECT에서는 한정자가 없어야 한다 — 접두어를 받아 양쪽을 만든다.
function ftsBlobExpr(prefix: "" | "new." | "old."): string {
  return `
  lower(
    ${prefix}filename || ' ' ||
    COALESCE(${prefix}category, '') || ' ' ||
    COALESCE(${prefix}subcategory, '') || ' ' ||
    COALESCE(${prefix}description, '') || ' ' ||
    replace(replace(replace(COALESCE(${prefix}tags, ''), '[', ' '), ']', ' '), '"', ' ')
  )
`;
}

function tableExists(name: string): boolean {
  return !!getDb()
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .pluck()
    .get(name);
}

function ensureSearchIndex(): void {
  const d = getDb();

  // (1) 검색 인덱스 — 51만 트랙 기준 최초 구축 3.5초, 117MB(실측).
  if (!tableExists("tracks_fts")) {
    d.exec(
      `CREATE VIRTUAL TABLE tracks_fts USING fts5(blob, tokenize = 'trigram')`,
    );
    d.exec(
      `INSERT INTO tracks_fts(rowid, blob) SELECT id, ${ftsBlobExpr("")} FROM tracks`,
    );
  }

  // (2) 자동완성 사전 — 같은 blob을 unicode61로 한 번 더 색인한다. trigram은 3글자
  // 단위로 쪼개 색인해서 "w로 시작하는 단어" 같은 접두어 질의를 할 수 없기 때문이다.
  // content=''(contentless)라 원문을 저장하지 않아 19MB로 끝난다(실측, 구축 1초).
  // 단어 목록은 fts5vocab이 (term, cnt)로 그대로 내주므로 집계 코드가 필요 없다.
  if (!tableExists("tracks_terms")) {
    d.exec(
      `CREATE VIRTUAL TABLE tracks_terms USING fts5(blob, tokenize = 'unicode61', content = '')`,
    );
    d.exec(
      `INSERT INTO tracks_terms(rowid, blob) SELECT id, ${ftsBlobExpr("")} FROM tracks`,
    );
    d.exec(
      `CREATE VIRTUAL TABLE tracks_vocab USING fts5vocab(tracks_terms, 'row')`,
    );
  }

  // (3) 동기화 트리거. 쓰기 경로가 스캐너/워처/메타데이터 편집/배치 편집/폴더 리네임으로
  // 넓게 퍼져 있어 호출부마다 손으로 갱신하면 반드시 빠뜨린다 — DB에 붙여 둔다.
  //
  // 두 인덱스를 한 트리거에서 함께 갱신한다. 따로 두면 색인 대상 컬럼 목록이 두 곳으로
  // 갈라져 언젠가 어긋난다. UPDATE는 그 컬럼들에만 건다 — last_played_at은 트랙을 고를
  // 때마다 바뀌는데 그때까지 색인을 지웠다 넣을 이유가 없다.
  //
  // 정의가 바뀌어도 기존 사용자에게 반영되도록 매번 다시 만든다(트리거 생성은 즉시 끝난다).
  // 조건부로 두면 인덱스가 이미 있는 DB는 낡은 트리거를 그대로 쓰게 된다.
  //
  // contentless FTS5는 일반 DELETE를 쓸 수 없고, 지울 때 넣었던 값을 그대로 다시 줘야
  // 한다 — 그래서 old. 로 blob을 다시 만들어 'delete' 명령에 넘긴다.
  const termsDelete = `INSERT INTO tracks_terms(tracks_terms, rowid, blob) VALUES ('delete', old.id, ${ftsBlobExpr("old.")})`;
  const termsInsert = `INSERT INTO tracks_terms(rowid, blob) VALUES (new.id, ${ftsBlobExpr("new.")})`;

  d.exec(`
    DROP TRIGGER IF EXISTS tracks_fts_ai;
    DROP TRIGGER IF EXISTS tracks_fts_ad;
    DROP TRIGGER IF EXISTS tracks_fts_au;

    CREATE TRIGGER tracks_fts_ai AFTER INSERT ON tracks BEGIN
      INSERT INTO tracks_fts(rowid, blob) VALUES (new.id, ${ftsBlobExpr("new.")});
      ${termsInsert};
    END;

    CREATE TRIGGER tracks_fts_ad AFTER DELETE ON tracks BEGIN
      DELETE FROM tracks_fts WHERE rowid = old.id;
      ${termsDelete};
    END;

    CREATE TRIGGER tracks_fts_au
    AFTER UPDATE OF filename, category, subcategory, description, tags ON tracks
    BEGIN
      DELETE FROM tracks_fts WHERE rowid = old.id;
      INSERT INTO tracks_fts(rowid, blob) VALUES (new.id, ${ftsBlobExpr("new.")});
      ${termsDelete};
      ${termsInsert};
    END;
  `);
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
