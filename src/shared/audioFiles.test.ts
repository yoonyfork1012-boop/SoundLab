import { describe, it, expect } from "vitest";
import {
  basenameOf,
  isIgnoredFilename,
  isIndexableAudioFile,
  isSkippedDir,
  sniffAudioContainer,
  isPlayableContainer,
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

describe("sniffAudioContainer", () => {
  /** 12바이트 헤더를 만든다: magic(4) + size(4) + form(4) */
  function head(magic: string, form: string): Uint8Array {
    const b = new Uint8Array(12);
    for (let i = 0; i < 4; i++) b[i] = magic.charCodeAt(i);
    for (let i = 0; i < 4; i++) b[8 + i] = form.charCodeAt(i);
    return b;
  }

  it("RIFF/WAVE를 riff로 본다", () => {
    expect(sniffAudioContainer(head("RIFF", "WAVE"))).toBe("riff");
  });

  it("FORM/AIFF와 FORM/AIFC를 aiff로 본다", () => {
    // 확장자가 .wav여도 내용이 AIFF인 파일이 실제로 있다
    expect(sniffAudioContainer(head("FORM", "AIFF"))).toBe("aiff");
    expect(sniffAudioContainer(head("FORM", "AIFC"))).toBe("aiff");
  });

  it("AppleDouble 매직을 알아본다 — 이름이 무엇이든 오디오가 아니다", () => {
    const b = new Uint8Array(12);
    b.set([0x00, 0x05, 0x16, 0x07]);
    b.set([0x4d, 0x61, 0x63, 0x20], 8); // "Mac "
    expect(sniffAudioContainer(b)).toBe("appledouble");
    expect(isPlayableContainer("appledouble")).toBe(false);
  });

  it("0바이트 파일을 empty로 본다", () => {
    expect(sniffAudioContainer(new Uint8Array(0))).toBe("empty");
    expect(sniffAudioContainer(head("RIFF", "WAVE"), 0)).toBe("empty");
    expect(isPlayableContainer("empty")).toBe(false);
  });

  it("헤더가 12바이트에 못 미치면 unknown", () => {
    expect(sniffAudioContainer(new Uint8Array([1, 2, 3]))).toBe("unknown");
  });

  it("모르는 헤더는 unknown이지만 색인은 막지 않는다", () => {
    // mp3/flac 등은 여기서 riff/aiff가 아니다 — 판별 실패로 버리면 안 된다
    expect(sniffAudioContainer(head("ID3\u0000", "xxxx"))).toBe("unknown");
    expect(isPlayableContainer("unknown")).toBe(true);
    expect(isPlayableContainer("riff")).toBe(true);
  });
});
