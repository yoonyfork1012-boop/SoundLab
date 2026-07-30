import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";

// better-sqlite3는 파일 기반 네이티브 SQLite라 매 쓰기가 그 자리에서 디스크(WAL)에
// 반영된다 — sql.js 시절의 "DB 전체 재직렬화 후 파일 교체" 파이프라인이 없어졌다.
// 그래도 persistDb/schedulePersist/flushPersist가 예전과 같은 시그니처로 호출부와
// 계속 호환되는지, 그리고 실제로 디스크에서 다시 읽었을 때 값이 보이는지를 고정해둔다.

// db/index.ts는 모듈 로드 시점에 homedir()로 DB 경로를 정하므로 임포트 전에 바꿔둔다.
const fakeHome = mkdtempSync(join(tmpdir(), "soundlib-persist-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
const DB_PATH = join(fakeHome, ".soundlib", "soundlib.db");

type Db = typeof import("./index");
type Queries = typeof import("./queries");
let db: Db;
let queries: Queries;

/** 디스크에 저장된 DB 파일을 별도 연결로 열어 라이브러리 이름 목록을 읽는다 */
function readLibraryNamesFromDisk(): string[] {
  const onDisk = new Database(DB_PATH, { readonly: true });
  try {
    const rows = onDisk
      .prepare("SELECT name FROM libraries ORDER BY name")
      .all() as {
      name: string;
    }[];
    return rows.map((r) => r.name);
  } finally {
    onDisk.close();
  }
}

beforeAll(async () => {
  db = await import("./index");
  queries = await import("./queries");
  await db.initDb();
});

afterAll(() => {
  // 다른 테스트 파일과 격리돼 있으므로 여기서 닫아도 안전하다
  if (existsSync(DB_PATH)) db.closeDb();
});

describe("DB 영속화", () => {
  it("쓰기가 실제로 디스크 파일에 반영된다", () => {
    queries.upsertLibrary("C:/persist-test/alpha", "alpha");
    db.persistDb();

    expect(readLibraryNamesFromDisk()).toContain("alpha");
  });

  it("schedulePersist를 호출해도(호환용 no-op) 이미 반영된 값이 그대로 보인다", () => {
    queries.upsertLibrary("C:/persist-test/beta", "beta");
    db.schedulePersist();

    expect(readLibraryNamesFromDisk()).toContain("beta");
  });

  it("flushPersist(WAL 체크포인트)가 예외 없이 동작하고 데이터가 유지된다", () => {
    queries.upsertLibrary("C:/persist-test/gamma", "gamma");
    db.flushPersist();

    const names = readLibraryNamesFromDisk();
    expect(names).toContain("gamma");
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });
});
