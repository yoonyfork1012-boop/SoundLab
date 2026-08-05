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

  it("여러 낱말은 붙어 있지 않아도 찾는다 (구문이 아니라 AND)", () => {
    const id = addTrack({
      filePath: "/lib/g.wav",
      filename: "Door_Metal_Heavy.wav",
    });
    expect(q.searchTrackIds("metal door")).toContain(id);
    // 순서를 바꿔도 같다 — 구문 매칭이었다면 둘 중 하나만 걸렸다
    expect(q.searchTrackIds("door metal")).toContain(id);
  });

  it("동의어로도 찾는다", () => {
    const id = addTrack({
      filePath: "/lib/h.wav",
      filename: "VehicleEngineIdle.wav",
    });
    expect(q.searchTrackIds("car")).toContain(id);
  });

  // 폴더 이름 검색 — 팩 이름은 폴더에만 있고 파일명에는 없는 경우가 많다.
  // 실제로 걸렸던 건: "Boom Library - Casual UI" 아래 파일들이 casual도 ui도 담고
  // 있지 않아 "casual ui"로 찾을 수 없었다. FTS 색인이 아니라 scan_dirs를 훑어 찾는다.
  describe("폴더 이름으로 찾기", () => {
    beforeAll(() => {
      addTrack({
        filePath: "/lib/Boom Library - Casual UI/CLOTHImpt_Backpack_CUCK.wav",
        filename: "CLOTHImpt_Backpack_CUCK.wav",
      });
      addTrack({
        filePath: "/lib/Big Room Sound - Footsteps/Walk_Wood_Casual_Shoes.wav",
        filename: "Walk_Wood_Casual_Shoes.wav",
      });
      // 폴더 목록은 스캐너가 채운다 — 테스트에서는 같은 API로 직접 넣는다.
      q.replaceDirSnapshot(
        1,
        new Map([
          ["/lib/Boom Library - Casual UI", 1],
          ["/lib/Big Room Sound - Footsteps", 1],
        ]),
      );
    });

    it("파일명에 없는 팩 이름을 폴더에서 찾는다", () => {
      const id = q.getTrackByPath(
        "/lib/Boom Library - Casual UI/CLOTHImpt_Backpack_CUCK.wav",
      )!.id;
      // 파일명에는 casual도 ui도 없다 — 폴더로만 찾을 수 있다
      expect(q.searchTrackIds("casual ui")).toContain(id);
    });

    it("낱말을 다 만족한 폴더가 일부만 맞은 파일명보다 앞에 온다", () => {
      const boom = q.getTrackByPath(
        "/lib/Boom Library - Casual UI/CLOTHImpt_Backpack_CUCK.wav",
      )!.id;
      const shoes = q.getTrackByPath(
        "/lib/Big Room Sound - Footsteps/Walk_Wood_Casual_Shoes.wav",
      )!.id;
      const ids = q.searchTrackIds("casual ui");
      // Walk_Wood_Casual_Shoes는 파일명에 casual이 있지만 ui가 어디에도 없다.
      // casual+ui를 모두 만족하는 Boom 쪽이 위여야 한다.
      expect(ids).toContain(boom);
      const shoesAt = ids.indexOf(shoes);
      if (shoesAt !== -1) expect(ids.indexOf(boom)).toBeLessThan(shoesAt);
    });
  });

  it("파일명에 든 것이 태그로만 걸린 것보다 앞에 온다 (관련도 정렬)", () => {
    const byTag = addTrack({
      filePath: "/lib/rank-a.wav",
      filename: "other.wav",
      tags: ["rankscrape"],
    });
    const byName = addTrack({
      filePath: "/lib/rank-b.wav",
      filename: "RankScrape.wav",
    });
    const ids = q.searchTrackIds("rankscrape");
    expect(ids.indexOf(byName)).toBeLessThan(ids.indexOf(byTag));
  });

  it("AND가 0건이면 OR로 넓힌다", () => {
    const id = addTrack({
      filePath: "/lib/i.wav",
      filename: "OnlyFallbackWord.wav",
    });
    // 'zzzmissing'은 어디에도 없다 — AND면 0건, OR면 이 트랙이 나온다
    expect(q.searchTrackIds("onlyfallbackword zzzmissing")).toContain(id);
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
      DROP TABLE tracks_vocab;
      DROP TABLE tracks_terms;
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
    // 자동완성 사전도 같이 재구축돼야 한다
    expect(q.suggestTerms("legacyorph")).toContain("legacyorphan");
    expect(q.suggestTerms("afterrebui")).toContain("afterrebuild");
  });
});

// 자동완성은 trigram이 아니라 unicode61 사전(tracks_terms + fts5vocab)을 쓴다.
// 인덱스가 둘로 나뉘어 있으므로 동기화가 어긋나기 쉬운 지점이고, 특히 contentless
// FTS5의 삭제 구문은 일반 DELETE와 달라 여기서 틀리면 조용히 색인이 남는다.
describe("검색 자동완성 (fts5vocab 사전)", () => {
  /** 같은 단어를 n번 넣어 빈도를 만든다 */
  function seed(word: string, times: number, tag = ""): void {
    for (let i = 0; i < times; i++) {
      addTrack({
        filePath: `/lib/seed-${tag}${word}-${i}.wav`,
        filename: `${word}_${i}.wav`,
      });
    }
  }

  beforeAll(() => {
    seed("whoosh", 5);
    seed("wood", 3);
    seed("water", 2);
    seed("wx", 4); // 3글자 미만 — 제안에 뜨면 안 된다
    seed("wonce", 1); // 1회짜리 — 빈도순이라 흔한 단어들 뒤로 밀려야 한다
  });

  it("접두어로 좁혀 빈도순으로 준다", () => {
    const out = q.suggestTerms("w");
    expect(out.slice(0, 3)).toEqual(["whoosh", "wood", "water"]);
  });

  it("확장자는 제안하지 않는다", () => {
    // 파일명이 전부 .wav라 wav는 압도적 1위지만 골라선 안 되는 단어다
    expect(q.suggestTerms("w")).not.toContain("wav");
    expect(q.suggestTerms("mp")).not.toContain("mp3");
  });

  it("3글자 미만 단어는 빼고 준다", () => {
    expect(q.suggestTerms("w")).not.toContain("wx");
  });

  it("드문 단어는 흔한 단어 뒤로 밀린다 (버리지는 않는다)", () => {
    const out = q.suggestTerms("w");
    // 트랙이 적은 라이브러리에서는 1회짜리가 전부이므로 빈도 하한을 두지 않는다.
    // 대신 순서로 눌린다 — whoosh(5회)가 wonce(1회)보다 앞이어야 한다.
    expect(out.indexOf("whoosh")).toBeLessThan(out.indexOf("wonce"));
  });

  it("개수 상한을 지킨다", () => {
    for (let i = 0; i < 20; i++) seed(`limitword${i}`, 2, "L");
    expect(q.suggestTerms("limitword").length).toBeLessThanOrEqual(10);
  });

  it("접두어가 단어 문자가 아니면 빈 배열", () => {
    expect(q.suggestTerms("")).toEqual([]);
    expect(q.suggestTerms("  ")).toEqual([]);
    expect(q.suggestTerms('"')).toEqual([]);
    expect(q.suggestTerms("-")).toEqual([]);
  });

  it("트랙을 지우면 사전에서도 빠진다 (contentless 삭제 구문 검증)", () => {
    addTrack({ filePath: "/lib/vanish.wav", filename: "Vanishing.wav" });
    expect(q.suggestTerms("vanish")).toContain("vanishing");
    q.deleteTrackByPath("/lib/vanish.wav");
    expect(q.suggestTerms("vanish")).not.toContain("vanishing");
  });

  it("메타데이터를 고치면 사전이 따라온다", () => {
    const id = addTrack({ filePath: "/lib/meta.wav", filename: "meta.wav" });
    q.updateTrackMetadata(id, { tags: ["cinematic", "cinematic"] });
    expect(q.suggestTerms("cinema")).toContain("cinematic");
  });
});
