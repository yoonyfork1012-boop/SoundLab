import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// db/index.ts는 모듈 로드 시점에 homedir()로 DB 경로를 정하므로 임포트 전에 바꿔둔다.
const fakeHome = mkdtempSync(join(tmpdir(), "soundlib-semantic-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;

type Db = typeof import("./index");
type Queries = typeof import("./queries");
type Embedder = typeof import("../embedder");
let db: Db;
let q: Queries;
let emb: Embedder;

// 모델을 테스트에 태우지 않는다 — 118MB를 받아야 하고 느리다. 임베딩 파이프라인의
// "저장 → KNN 조회" 부분만 고정 벡터로 검증한다.
function unitVector(dim: number, hot: number): Float32Array {
  const v = new Float32Array(dim);
  v[hot] = 1;
  return v;
}

describe("의미 검색 (sqlite-vec)", () => {
  beforeAll(async () => {
    db = await import("./index");
    q = await import("./queries");
    emb = await import("../embedder");
    await db.initDb();
  });

  it("sqlite-vec 확장이 로드된다", () => {
    // 확장이 없으면 의미 검색만 조용히 빠지고 키워드 검색은 동작해야 한다.
    expect(db.isVectorSearchAvailable()).toBe(true);
  });

  it("정규화 벡터를 int8로 양자화한다", () => {
    const buf = emb.quantize([1, -1, 0, 0.5]);
    expect(Array.from(new Int8Array(buf.buffer, buf.byteOffset, 4))).toEqual([
      127, -127, 0, 64,
    ]);
  });

  it("파일명을 임베딩용 텍스트로 풀어 쓴다", () => {
    // 언더스코어로 이어붙은 파일명은 낱말로 풀어야 모델이 제대로 읽는다
    expect(
      emb.embedText({
        filename: "footstep_a_mech-mega_01.wav",
        category: "FOOTSTEP",
        subcategory: null,
      }),
    ).toBe("footstep a mech mega 01 FOOTSTEP");
  });

  it("가까운 벡터부터 거리순으로 돌려준다", () => {
    const d = db.getDb();
    const ins = d.prepare(
      "INSERT INTO tracks_vec(rowid, embedding) VALUES (?, vec_int8(?))",
    );
    // 서로 직교하는 세 벡터 — 질의와 같은 축의 것이 1등이어야 한다
    ins.run(BigInt(101), emb.quantize(unitVector(emb.EMBED_DIM, 0)));
    ins.run(BigInt(102), emb.quantize(unitVector(emb.EMBED_DIM, 1)));
    ins.run(BigInt(103), emb.quantize(unitVector(emb.EMBED_DIM, 2)));

    const hits = q.semanticSearchIds(
      emb.quantize(unitVector(emb.EMBED_DIM, 1)),
      3,
    );
    expect(hits[0]).toBe(102);
    expect(hits).toHaveLength(3);
  });

  it("상한(k)을 지킨다", () => {
    expect(
      q.semanticSearchIds(emb.quantize(unitVector(emb.EMBED_DIM, 0)), 2),
    ).toHaveLength(2);
  });

  it("아직 임베딩되지 않은 트랙 수를 센다", () => {
    q.upsertLibrary("/lib", "lib");
    q.upsertTrack({
      libraryId: 1,
      filePath: "/lib/no-embedding-yet.wav",
      filename: "no-embedding-yet.wav",
      durationMs: null,
      sampleRate: 48000,
      bitDepth: 24,
      channels: 2,
      category: null,
      subcategory: null,
    });
    // 방금 넣은 트랙은 벡터가 없으므로 대기 목록에 잡혀야 한다
    expect(emb.pendingEmbedCount()).toBeGreaterThan(0);
  });

  // NOT IN을 LEFT JOIN으로 바꿨다(배치마다 35ms → 1ms). 같은 행을 고르는지 확인한다 —
  // 여기가 어긋나면 이미 임베딩된 트랙을 다시 돌리거나(무한 루프) 영영 건너뛴다.
  it("LEFT JOIN이 NOT IN과 같은 트랙을 고른다", () => {
    const d = db.getDb();
    const before = emb.pendingEmbedCount();
    const track = q.getTrackByPath("/lib/no-embedding-yet.wav")!;
    d.prepare(
      "INSERT INTO tracks_vec(rowid, embedding) VALUES (?, vec_int8(?))",
    ).run(BigInt(track.id), emb.quantize(unitVector(emb.EMBED_DIM, 3)));
    // 벡터를 넣었으니 정확히 하나 줄어야 한다
    expect(emb.pendingEmbedCount()).toBe(before - 1);

    const notIn = d
      .prepare(
        "SELECT count(*) FROM tracks WHERE id NOT IN (SELECT rowid FROM tracks_vec)",
      )
      .pluck()
      .get();
    expect(emb.pendingEmbedCount()).toBe(notIn);
  });

  // 백필은 몇 시간 걸리는 배경 작업이고 검색·재생은 사용자가 기다리는 작업이다. 사용자가
  // 뭔가 한 직후에는 백필이 새 배치를 시작하면 안 된다 — 이게 "검색·재생할 때마다 렉"의
  // 원인이었다. (배치를 실제로 돌리려면 모델이 필요해 테스트에 못 태운다. 판정 조건만 본다.)
  it("검색 직후에는 백필이 비켜준다", () => {
    const now = Date.now();
    emb.noteUserActivity();
    expect(emb.shouldYieldToUser(now)).toBe(true);
    // 조용해지면 다시 진행한다 — 아니면 백필이 영영 안 끝난다
    expect(emb.shouldYieldToUser(now + 3000)).toBe(false);
  });

  // 재생은 IPC가 돌아간 뒤부터가 진짜다 — 렌더러가 파일을 디코딩해 웨이브폼을 그린다.
  // 그 구간이 메인에서 안 보이므로 검색보다 길게 비켜줘야 한다.
  it("재생은 검색보다 오래 비켜준다 (웨이브폼 디코딩 구간)", () => {
    const now = Date.now();
    emb.noteUserPlayback();
    // 검색용 유휴(1.5초)를 지나서도 아직 비켜주고 있어야 한다
    expect(emb.shouldYieldToUser(now + 3000)).toBe(true);
    expect(emb.shouldYieldToUser(now + 6000)).toBe(false);
  });
});
