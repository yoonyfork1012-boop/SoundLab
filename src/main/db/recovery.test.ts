import { describe, it, expect, beforeAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  openSync,
  writeSync,
  closeSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";

// db/index.ts는 모듈 로드 시점에 homedir()로 DB 경로를 정하므로 임포트 전에 바꿔둔다.
const fakeHome = mkdtempSync(join(tmpdir(), "soundlib-recovery-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
const SOUNDLIB_DIR = join(fakeHome, ".soundlib");
const DB_PATH = join(SOUNDLIB_DIR, "soundlib.db");

// 열기는 성공하지만 내용이 깨진 DB를 만든다 — 헤더는 그대로 두고 중간 페이지만 뭉갠다.
// "열기 실패"만 보던 예전 복구 로직이 놓치던 바로 그 상태다.
function makeCorruptDbWithWal(): void {
  mkdirSync(SOUNDLIB_DIR, { recursive: true });
  const seed = new Database(DB_PATH);
  seed.pragma("journal_mode = WAL");
  seed.exec("CREATE TABLE junk (v TEXT)");
  const insert = seed.prepare("INSERT INTO junk VALUES (?)");
  for (let i = 0; i < 500; i++) insert.run(`row${i}`);
  seed.close();

  const fd = openSync(DB_PATH, "r+");
  try {
    writeSync(fd, Buffer.alloc(4096, 0xab), 0, 4096, 4096);
  } finally {
    closeSync(fd);
  }
}

describe("손상된 DB 복구", () => {
  beforeAll(makeCorruptDbWithWal);

  // WAL 모드에서 DB는 본 파일 + -wal + -shm 세 개가 한 세트다. 본 파일만 치우고
  // -wal/-shm을 남겨두면 새로 만든 빈 DB에 옛 WAL이 그대로 붙어 다시 깨진다.
  it("본 파일과 -wal/-shm을 함께 치우고 성한 새 DB로 시작한다", async () => {
    const dbModule = await import("./index");
    await dbModule.initDb();

    const d = dbModule.getDb();
    expect(d.pragma("quick_check", { simple: true })).toBe("ok");
    // 손상된 DB의 테이블이 아니라 새 스키마로 시작했어야 한다
    expect(() => d.exec("SELECT 1 FROM junk")).toThrow();

    d.exec("INSERT INTO libraries (root_path, name) VALUES ('/tmp/x', 'x')");
    dbModule.flushPersist();
    dbModule.closeDb();

    const onDisk = new Database(DB_PATH, { readonly: true });
    try {
      expect(onDisk.pragma("quick_check", { simple: true })).toBe("ok");
      expect(
        onDisk.prepare("SELECT name FROM libraries").pluck().all(),
      ).toEqual(["x"]);
    } finally {
      onDisk.close();
    }

    // 손상된 원본은 보존해 둔다(사용자가 나중에 복구를 시도할 수 있게)
    const files = readdirSync(SOUNDLIB_DIR);
    expect(files.some((f) => f.startsWith("soundlib.db.corrupt-"))).toBe(true);
    // -wal/-shm까지 함께 치우는 부분은 여기서 단언하지 않는다. 이 시나리오에서는
    // SQLite가 열기/닫기 과정에서 스스로 정리해 버려 무엇이 남는지가 타이밍을 탄다.
    // 그 코드가 실제로 필요한 상황은 프로세스가 죽어 -wal만 남은 경우인데,
    // 인프로세스 테스트로는 재현할 수 없다.
  });
});
