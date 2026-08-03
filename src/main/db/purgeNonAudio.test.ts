import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// db/index.ts는 모듈 로드 시점에 homedir()로 DB 경로를 정하므로 임포트 전에 바꿔둔다.
const fakeHome = mkdtempSync(join(tmpdir(), "soundlib-purge-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;

type Db = typeof import("./index");
type Queries = typeof import("./queries");
let db: Db;
let q: Queries;
let lib: string;

/** AppleDouble 껍데기 — 매직 0x00051607 + "Mac " */
function appleDoubleBytes(): Buffer {
  const b = Buffer.alloc(4096);
  b.writeUInt32BE(0x00051607, 0);
  b.write("Mac ", 8, "ascii");
  return b;
}

function riffBytes(): Buffer {
  const b = Buffer.alloc(64);
  b.write("RIFF", 0, "ascii");
  b.write("WAVE", 8, "ascii");
  return b;
}

/** 메타데이터가 비어 있는 트랙 행을 직접 넣는다(예전 버전이 색인해 둔 상태를 재현) */
function insertNullMetaTrack(filePath: string, size: number): number {
  q.upsertTrack({
    libraryId: 1,
    filePath,
    filename: filePath.split(/[\/]/).pop()!,
    durationMs: null,
    sampleRate: null,
    bitDepth: null,
    channels: null,
    category: null,
    subcategory: null,
    artworkPath: null,
    artworkSource: null,
    mtimeMs: null,
    fileSize: size,
    publisher: null,
    isFloat: false,
    fileHash: null,
  });
  return q.getTrackByPath(filePath)!.id;
}

// 스캐너는 "디스크에서 사라진 파일"만 인덱스에서 지운다. AppleDouble 껍데기는 디스크에
// 멀쩡히 있어서 재스캔해도 영원히 남으므로, 열 때 한 번 걷어내야 한다.
describe("오디오가 아닌 트랙 정리", () => {
  let ghostId: number, emptyId: number, aiffId: number, realId: number;

  beforeAll(async () => {
    db = await import("./index");
    q = await import("./queries");
    await db.initDb();
    q.upsertLibrary("/lib", "lib");

    lib = mkdtempSync(join(tmpdir(), "soundlib-purge-lib-"));
    mkdirSync(lib, { recursive: true });

    const ghost = join(lib, "__ghost.wav");
    const empty = join(lib, "empty.wav");
    const aiff = join(lib, "actually_aiff.wav");
    const real = join(lib, "real.wav");
    writeFileSync(ghost, appleDoubleBytes());
    writeFileSync(empty, Buffer.alloc(0));
    writeFileSync(
      aiff,
      Buffer.concat([
        Buffer.from("FORM"),
        Buffer.alloc(4),
        Buffer.from("AIFF"),
      ]),
    );
    writeFileSync(real, riffBytes());

    ghostId = insertNullMetaTrack(ghost, 4096);
    emptyId = insertNullMetaTrack(empty, 0);
    aiffId = insertNullMetaTrack(aiff, 12);
    realId = insertNullMetaTrack(real, 64);

    // 껍데기가 컬렉션에 들어가 있어도 같이 정리돼야 한다
    q.createCollection("c1");
    const c = q.getCollections()[0];
    q.addTrackToCollection(c.id, ghostId);

    // 앱을 다시 켠다
    db.closeDb();
    await db.initDb();
  });

  function alive(id: number): boolean {
    return !!db
      .getDb()
      .prepare("SELECT 1 FROM tracks WHERE id = ?")
      .pluck()
      .get(id);
  }

  it("AppleDouble 껍데기를 지운다", () => {
    expect(alive(ghostId)).toBe(false);
  });

  it("0바이트 파일을 지운다", () => {
    expect(alive(emptyId)).toBe(false);
  });

  it("AIFF는 지우지 않는다 — 확장자만 .wav일 뿐 진짜 오디오다", () => {
    expect(alive(aiffId)).toBe(true);
  });

  it("헤더가 정상인 트랙은 건드리지 않는다", () => {
    expect(alive(realId)).toBe(true);
  });

  it("지워진 트랙의 컬렉션 소속도 함께 정리한다", () => {
    const n = db
      .getDb()
      .prepare("SELECT count(*) FROM collection_tracks WHERE track_id = ?")
      .pluck()
      .get(ghostId);
    expect(n).toBe(0);
  });
});
