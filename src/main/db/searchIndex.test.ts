import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// db/index.ts는 모듈 로드 시점에 homedir()로 DB 경로를 정하므로 임포트 전에 바꿔둔다.
const fakeHome = mkdtempSync(join(tmpdir(), "soundlib-search-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;

type Db = typeof import("./index");
type Queries = typeof import("./queries");
let db: Db;
let q: Queries;

/** 트랙 하나를 넣고 id를 돌려준다. tags/description은 upsertTrack이 다루지 않고
 *  메타데이터 편집(updateTrackMetadata)으로만 들어오므로 여기서도 그 경로를 쓴다. */
function addTrack(fields: {
  filePath: string;
  filename: string;
  category?: string | null;
  tags?: string[];
}): number {
  q.upsertTrack({
    libraryId: 1,
    filePath: fields.filePath,
    filename: fields.filename,
    durationMs: null,
    sampleRate: null,
    bitDepth: null,
    channels: null,
    category: fields.category ?? null,
    subcategory: null,
    artworkPath: null,
    artworkSource: null,
    mtimeMs: null,
    fileSize: null,
    publisher: null,
    isFloat: false,
    fileHash: null,
  });
  const id = q.getTrackByPath(fields.filePath)!.id;
  if (fields.tags) q.updateTrackMetadata(id, { tags: fields.tags });
  return id;
}

describe("검색 인덱스 (FTS5 trigram)", () => {
  beforeAll(async () => {
    db = await import("./index");
    q = await import("./queries");
    await db.initDb();
    q.upsertLibrary("/lib", "lib");
  });

  it("3글자 미만 질의는 빈 결과 — 렌더러가 인메모리로 처리하는 구간", () => {
    expect(q.searchTrackIds("ki")).toEqual([]);
    expect(q.searchTrackIds("")).toEqual([]);
  });

  it("부분문자열로 찾는다 (접두어가 아니라)", () => {
    const id = addTrack({
      filePath: "/lib/a.wav",
      filename: "BigKickDrum.wav",
    });
    // 'ick'는 단어 시작이 아니다 — unicode61 토크나이저였다면 못 찾는다
    expect(q.searchTrackIds("ick")).toContain(id);
    expect(q.searchTrackIds("kickdrum")).toContain(id);
    expect(q.searchTrackIds("zzz")).not.toContain(id);
  });

  it("파일명 외에 카테고리·태그도 색인한다", () => {
    const id = addTrack({
      filePath: "/lib/b.wav",
      filename: "b.wav",
      category: "Foley",
      tags: ["cloth", "rustle"],
    });
    expect(q.searchTrackIds("foley")).toContain(id);
    expect(q.searchTrackIds("rustle")).toContain(id);
  });

  it("태그끼리 이어붙어 매칭되지 않는다", () => {
    addTrack({
      filePath: "/lib/c.wav",
      filename: "c.wav",
      tags: ["kick", "drum"],
    });
    // JSON의 대괄호·따옴표를 공백으로 바꿔 넣으므로 'ck","dr' 같은 건 생기지 않는다
    expect(q.searchTrackIds('k","d')).toEqual([]);
  });

  it("트랙을 지우면 색인에서도 빠진다 (DELETE 트리거)", () => {
    const id = addTrack({ filePath: "/lib/d.wav", filename: "DeleteMe.wav" });
    expect(q.searchTrackIds("deleteme")).toContain(id);
    q.deleteTrackByPath("/lib/d.wav");
    expect(q.searchTrackIds("deleteme")).toEqual([]);
  });

  it("메타데이터를 고치면 색인이 따라온다 (UPDATE 트리거)", () => {
    const id = addTrack({ filePath: "/lib/e.wav", filename: "e.wav" });
    q.updateTrackMetadata(id, { category: "Ambience" });
    expect(q.searchTrackIds("ambience")).toContain(id);
  });

  it("구두점만 있는 질의에도 예외 없이 빈 결과를 준다", () => {
    expect(q.searchTrackIds('"""')).toEqual([]);
    expect(q.searchTrackIds("   ")).toEqual([]);
  });

  it("큰따옴표가 섞인 질의를 이스케이프한다", () => {
    const id = addTrack({ filePath: "/lib/f.wav", filename: 'say "hi".wav' });
    expect(q.searchTrackIds('"hi"')).toContain(id);
  });

  // 기존 사용자는 트랙이 51만 개 들어 있는 DB로 새 버전을 켠다. 그때 인덱스가 없는 걸
  // 발견하고 기존 행 전부를 채워 넣어야 한다 — 새로 만든 빈 DB만 테스트하면 이 경로가
  // 통째로 비어 있게 된다.
  it("이미 트랙이 있는 DB를 열면 기존 행까지 색인한다 (업그레이드 경로)", async () => {
    const id = addTrack({
      filePath: "/lib/legacy.wav",
      filename: "LegacyOrphan.wav",
    });

    // 인덱스가 없던 예전 DB 상태로 되돌린다
    const d = db.getDb();
    d.exec(`
      DROP TRIGGER tracks_fts_ai;
      DROP TRIGGER tracks_fts_ad;
      DROP TRIGGER tracks_fts_au;
      DROP TABLE tracks_fts;
    `);
    db.closeDb();

    // 새 버전으로 다시 켜기
    await db.initDb();
    expect(q.searchTrackIds("legacyorphan")).toContain(id);

    // 트리거도 함께 되살아났는지 — 재구축 후 새 트랙이 색인되는지로 확인한다
    const fresh = addTrack({
      filePath: "/lib/after.wav",
      filename: "AfterRebuild.wav",
    });
    expect(q.searchTrackIds("afterrebuild")).toContain(fresh);
  });
});
