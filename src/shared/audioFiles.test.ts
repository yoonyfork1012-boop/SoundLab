import { describe, it, expect } from "vitest";
import {
  basenameOf,
  isIgnoredFilename,
  isIndexableAudioFile,
  isSkippedDir,
} from "./audioFiles";

describe("basenameOf", () => {
  it("Windows 경로와 POSIX 경로 모두에서 파일명을 뽑는다", () => {
    expect(basenameOf("C:\\Sounds\\FX\\boom.wav")).toBe("boom.wav");
    expect(basenameOf("/home/me/sfx/boom.wav")).toBe("boom.wav");
    expect(basenameOf("boom.wav")).toBe("boom.wav");
  });
});

describe("isIgnoredFilename", () => {
  it("숨김 파일과 macOS 부산물을 제외한다", () => {
    expect(isIgnoredFilename(".DS_Store")).toBe(true);
    expect(isIgnoredFilename("._boom.wav")).toBe(true);
    expect(isIgnoredFilename(".hidden.wav")).toBe(true);
  });

  it("복사가 끝나지 않은 임시 파일을 제외한다", () => {
    expect(isIgnoredFilename("boom.wav.tmp")).toBe(true);
    expect(isIgnoredFilename("boom.wav.part")).toBe(true);
    expect(isIgnoredFilename("boom.wav.crdownload")).toBe(true);
    expect(isIgnoredFilename("~$session.wav")).toBe(true);
  });

  it("정상 파일명은 통과시킨다", () => {
    expect(isIgnoredFilename("boom.wav")).toBe(false);
    // 이름 중간에 temp가 들어갔을 뿐인 정상 파일을 잘못 걸러선 안 된다
    expect(isIgnoredFilename("temperature sweep.wav")).toBe(false);
  });
});

describe("isIndexableAudioFile", () => {
  it("지원 확장자만 받아들인다", () => {
    expect(isIndexableAudioFile("boom.wav")).toBe(true);
    expect(isIndexableAudioFile("boom.AIFF")).toBe(true);
    expect(isIndexableAudioFile("boom.flac")).toBe(true);
    expect(isIndexableAudioFile("cover.jpg")).toBe(false);
    expect(isIndexableAudioFile("readme.txt")).toBe(false);
    expect(isIndexableAudioFile("noextension")).toBe(false);
  });

  it("전체 경로를 넘겨도 동작한다", () => {
    expect(isIndexableAudioFile("C:\\Sounds\\FX\\boom.wav")).toBe(true);
    expect(isIndexableAudioFile("C:\\Sounds\\FX\\.hidden.wav")).toBe(false);
  });

  it("임시 파일은 지원 확장자를 포함해도 제외한다", () => {
    // 복사 중인 파일을 인덱싱하면 반쪽짜리 오디오가 라이브러리에 남는다
    expect(isIndexableAudioFile("boom.wav.tmp")).toBe(false);
    expect(isIndexableAudioFile("._boom.wav")).toBe(false);
  });
});

describe("isSkippedDir", () => {
  it("시스템/숨김 폴더는 순회하지 않는다", () => {
    expect(isSkippedDir("$RECYCLE.BIN")).toBe(true);
    expect(isSkippedDir("System Volume Information")).toBe(true);
    expect(isSkippedDir(".git")).toBe(true);
    expect(isSkippedDir("Boom Library")).toBe(false);
  });
});
