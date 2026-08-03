import { describe, it, expect, beforeAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, unlinkSync, renameSync } from "fs";
import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// artwork.ts가 electron의 nativeImage를 쓰므로 노드 테스트 환경에서는 최소한으로 대체한다.
// (커버 이미지는 이 테스트의 관심사가 아니다.)
vi.mock("electron", () => ({
  nativeImage: {
    createFromBuffer: () => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
      resize: () => ({ toJPEG: () => Buffer.alloc(0) }),
      toJPEG: () => Buffer.alloc(0),
    }),
  },
}));

// 증분 스캔의 핵심은 "변경 없는 폴더의 파일에는 stat조차 하지 않는 것"이다(수십만 파일에서
// 재스캔 시간을 지배하던 비용). 실제로 생략되는지 확인하려고 stat 호출 횟수를 센다.
const statCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    stat: (...args: Parameters<typeof actual.stat>) => {
      statCalls.n++;
      return actual.stat(...args);
    },
  };
});

// db/index.ts는 모듈 로드 시점에 homedir()로 DB 경로를 정한다 — 실제 사용자 DB를 건드리지
// 않도록, 임포트 전에 홈 디렉터리를 임시 폴더로 바꿔둔다.
const fakeHome = mkdtempSync(join(tmpdir(), "soundlib-test-home-"));
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;

type Scanner = typeof import("./index");
type Db = typeof import("../db");
let scanner: Scanner;
let db: Db;

/** music-metadata가 실제로 파싱할 수 있는 최소 크기의 PCM WAV를 만든다. */
function wavBytes(sampleCount: number): Buffer {
  const dataSize = sampleCount * 2; // 16bit mono
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt 청크 크기
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // 채널 1
  buf.writeUInt32LE(44100, 24); // 샘플레이트
  buf.writeUInt32LE(44100 * 2, 28); // 바이트/초
  buf.writeUInt16LE(2, 32); // 블록 정렬
  buf.writeUInt16LE(16, 34); // 비트 뎁스
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  // 무음이 아닌 값을 조금 넣어 파일마다 내용이 다르게(=해시가 다르게) 만든다
  for (let i = 0; i < sampleCount; i++)
    buf.writeInt16LE((i * 37) % 3000, 44 + i * 2);
  return buf;
}

let libRoot: string;

beforeAll(async () => {
  db = await import("../db");
  scanner = await import("./index");
  await db.initDb();

  libRoot = mkdtempSync(join(tmpdir(), "soundlib-test-lib-"));
  mkdirSync(join(libRoot, "FX"), { recursive: true });
  writeFileSync(join(libRoot, "FX", "boom.wav"), wavBytes(100));
  writeFileSync(join(libRoot, "FX", "crash.wav"), wavBytes(200));
  writeFileSync(join(libRoot, "FX", "hit.wav"), wavBytes(300));
  // 인덱싱 대상이 아닌 것들 — 개수에 잡히면 안 된다
  writeFileSync(join(libRoot, "FX", "readme.txt"), "not audio");
  writeFileSync(join(libRoot, "FX", "pending.wav.tmp"), wavBytes(50));
});

describe("scanLibrary 증분 인덱싱", () => {
  it("최초 스캔은 지원 오디오 파일만 인덱싱한다", async () => {
    const { summary } = await scanner.scanLibrary(libRoot);
    // 임시 파일(.tmp)과 텍스트 파일은 제외되어야 한다
    expect(summary.added).toBe(3);
    expect(summary.updated).toBe(0);
    expect(summary.removed).toBe(0);
    expect(summary.errors).toEqual([]);
  });

  it("변경이 없으면 아무것도 다시 분석하지 않고, 파일별 stat도 하지 않는다", async () => {
    statCalls.n = 0;
    const { summary } = await scanner.scanLibrary(libRoot);
    expect(summary.added).toBe(0);
    expect(summary.updated).toBe(0);
    expect(summary.moved).toBe(0);
    expect(summary.removed).toBe(0);
    // 3개 모두 "기존 인덱스 그대로 사용"으로 처리돼야 한다
    expect(summary.skipped).toBe(3);
    // 폴더는 2개(루트, FX)뿐 — 폴더 mtime만 확인하고 파일 5개(오디오 3 + 기타 2)에 대한
    // stat은 한 번도 일어나지 않아야 한다. 이게 대용량 라이브러리 재스캔 속도를 좌우한다.
    expect(statCalls.n).toBe(2);
  });

  it("새로 추가된 파일만 인덱싱한다", async () => {
    writeFileSync(join(libRoot, "FX", "whoosh.wav"), wavBytes(400));
    const { summary } = await scanner.scanLibrary(libRoot);
    expect(summary.added).toBe(1);
    expect(summary.updated).toBe(0);
    expect(summary.removed).toBe(0);
    // 기존 3개는 재분석되지 않아야 한다
    expect(summary.skipped).toBe(3);
  });

  it("이름이 바뀐 파일은 기존 분석 데이터를 재사용한다(재분석 아님)", async () => {
    renameSync(
      join(libRoot, "FX", "whoosh.wav"),
      join(libRoot, "FX", "whoosh-renamed.wav"),
    );
    const { summary } = await scanner.scanLibrary(libRoot);
    expect(summary.moved).toBe(1);
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
  });

  it("삭제된 파일은 인덱스에서 제거한다", async () => {
    unlinkSync(join(libRoot, "FX", "whoosh-renamed.wav"));
    const { summary } = await scanner.scanLibrary(libRoot);
    expect(summary.removed).toBe(1);
    expect(summary.added).toBe(0);
  });

  it("deleteMissing:false면 사라진 파일을 인덱스에 남겨둔다", async () => {
    unlinkSync(join(libRoot, "FX", "hit.wav"));
    const { summary } = await scanner.scanLibrary(libRoot, {
      deleteMissing: false,
    });
    expect(summary.removed).toBe(0);
    // 다시 파일을 만들어 이후 테스트 상태를 원래대로 돌려놓는다
    writeFileSync(join(libRoot, "FX", "hit.wav"), wavBytes(300));
  });

  it("mode:'full'은 변경이 없어도 모든 파일을 다시 분석한다", async () => {
    // 앞 테스트에서 hit.wav를 새로 썼으므로 먼저 증분 스캔으로 상태를 맞춘다
    await scanner.scanLibrary(libRoot);
    const { summary } = await scanner.scanLibrary(libRoot, { mode: "full" });
    expect(summary.skipped).toBe(0);
    expect(summary.added + summary.updated).toBe(3);
  });
});

// macOS에서 복사된 라이브러리에는 파일마다 AppleDouble 사이드카가 딸려 온다. 이게 .wav
// 확장자를 달고 오디오로 색인되면 클릭해도 소리가 나지 않는다. 이름이 "._foo.wav"면
// isIgnoredFilename이 거르지만, 복사 과정에서 "__foo.wav"로 바뀐 것들은 내용을 봐야만 안다.
describe("오디오가 아닌 파일 걸러내기", () => {
  let junkRoot: string;

  /** AppleDouble 껍데기 — 매직 0x00051607 + "Mac ", 실제로도 4096바이트가 흔하다 */
  function appleDoubleBytes(): Buffer {
    const buf = Buffer.alloc(4096);
    buf.writeUInt32BE(0x00051607, 0);
    buf.write("Mac ", 8, "ascii");
    return buf;
  }

  /** 내용은 AIFF인데 이름은 .wav인 파일 (SoundMorph 일부 제품이 이렇다) */
  function aiffBytes(frames: number): Buffer {
    const dataSize = frames * 2 + 8;
    const buf = Buffer.alloc(12 + 8 + 18 + 8 + dataSize);
    let o = 0;
    buf.write("FORM", o, "ascii");
    buf.writeUInt32BE(buf.length - 8, (o += 4));
    buf.write("AIFF", (o += 4), "ascii");
    buf.write("COMM", (o += 4), "ascii");
    buf.writeUInt32BE(18, (o += 4));
    buf.writeUInt16BE(1, (o += 4)); // 채널
    buf.writeUInt32BE(frames, (o += 2)); // 프레임 수
    buf.writeUInt16BE(16, (o += 4)); // 비트
    // 80비트 확장 부동소수점으로 표현한 44100Hz
    buf.writeUInt16BE(0x400e, (o += 2));
    buf.writeUInt32BE(0xac440000, (o += 2));
    buf.writeUInt32BE(0, (o += 4));
    buf.write("SSND", (o += 4), "ascii");
    buf.writeUInt32BE(dataSize, (o += 4));
    return buf;
  }

  beforeAll(async () => {
    junkRoot = mkdtempSync(join(tmpdir(), "soundlib-test-junk-"));
    writeFileSync(join(junkRoot, "real.wav"), wavBytes(500));
    // 이름으로는 구분 안 되는 껍데기 — 여기가 핵심
    writeFileSync(join(junkRoot, "__ghost.wav"), appleDoubleBytes());
    writeFileSync(join(junkRoot, "empty.wav"), Buffer.alloc(0));
    writeFileSync(join(junkRoot, "actually_aiff.wav"), aiffBytes(4410));
    await scanner.scanLibrary(junkRoot);
  });

  function indexed(): string[] {
    return db
      .getDb()
      .prepare(
        "SELECT filename FROM tracks WHERE file_path LIKE ? ORDER BY filename",
      )
      .pluck()
      .all(`${junkRoot}%`) as string[];
  }

  it("AppleDouble 껍데기를 색인하지 않는다 (이름이 ._ 가 아니어도)", () => {
    expect(indexed()).not.toContain("__ghost.wav");
  });

  it("0바이트 파일을 색인하지 않는다", () => {
    expect(indexed()).not.toContain("empty.wav");
  });

  it("정상 WAV는 그대로 색인한다", () => {
    expect(indexed()).toContain("real.wav");
  });

  it(".wav 이름의 AIFF도 색인하고 메타데이터를 채운다", () => {
    expect(indexed()).toContain("actually_aiff.wav");
    const row = db
      .getDb()
      .prepare("SELECT sample_rate, channels FROM tracks WHERE filename = ?")
      .get("actually_aiff.wav") as { sample_rate: number; channels: number };
    // 확장자대로 WAV로 다루면 여기가 통째로 null이 된다
    expect(row.sample_rate).toBe(44100);
    expect(row.channels).toBe(1);
  });
});
