import { describe, it, expect } from "vitest";
import { hasKorean, synonymsOf, translateKoreanQuery } from "./koreanTerms";

describe("hasKorean", () => {
  it("한글이 섞여 있으면 참", () => {
    expect(hasKorean("발자국")).toBe(true);
    expect(hasKorean("metal 긁힘")).toBe(true);
  });

  it("영어·숫자만이면 거짓", () => {
    expect(hasKorean("gun reload")).toBe(false);
    expect(hasKorean("B00M_3DS06")).toBe(false);
  });
});

describe("translateKoreanQuery", () => {
  it("한글이 없으면 손대지 않는다", () => {
    // 영어 질의는 지금도 잘 되므로 건드리면 손해다
    expect(translateKoreanQuery("gun reload")).toBe("gun reload");
    expect(translateKoreanQuery("METLMvmt")).toBe("METLMvmt");
  });

  it("낱말을 영어 사운드 용어로 바꾼다", () => {
    expect(translateKoreanQuery("발자국")).toBe("footstep");
    expect(translateKoreanQuery("천둥")).toBe("thunder");
    expect(translateKoreanQuery("유리")).toBe("glass");
  });

  it("여러 낱말을 함께 옮긴다", () => {
    const out = translateKoreanQuery("긴 금속 긁힘");
    expect(out.split(" ").sort()).toEqual(["long", "metal", "scrape"]);
  });

  it("'소리' 같은 군더더기는 떨어낸다", () => {
    // 모든 파일이 소리라 검색에 아무 도움이 안 된다
    expect(translateKoreanQuery("물 흐르는 소리")).not.toContain("소리");
    const out = translateKoreanQuery("물 흐르는 소리").split(" ").sort();
    expect(out).toEqual(["flow", "water"]);
  });

  it("긴 표제어가 짧은 것보다 먼저 잡힌다", () => {
    // "발자국"이 "발"로 쪼개지면 안 되고, "총소리"가 "총"이 되면 안 된다
    expect(translateKoreanQuery("발자국")).toBe("footstep");
    expect(translateKoreanQuery("총소리")).toBe("gunshot");
    expect(translateKoreanQuery("자동차")).toBe("car");
  });

  it("한영 혼용 질의에서 영어 부분을 살린다", () => {
    const out = translateKoreanQuery("metal 긁힘").split(" ").sort();
    expect(out).toEqual(["metal", "scrape"]);
  });

  it("사전에 없는 한국어만 있으면 원본을 돌려준다", () => {
    // 아무것도 못 찾는 것보다는 낫고, 호출부가 실패를 따로 다루지 않아도 된다
    expect(translateKoreanQuery("괴상한말")).toBe("괴상한말");
  });

  it("Phase 1에서 실패했던 질의들이 이제 옳은 영어로 간다", () => {
    // 다국어 임베딩이 못 건넜던 바로 그 질의들
    expect(translateKoreanQuery("총 장전").split(" ").sort()).toEqual([
      "gun",
      "reload",
    ]);
    expect(translateKoreanQuery("문 여는 소리").split(" ").sort()).toEqual([
      "door",
      "open",
    ]);
    expect(translateKoreanQuery("유리 깨지는 소리").split(" ").sort()).toEqual([
      "break",
      "glass",
    ]);
  });
});

describe("synonymsOf", () => {
  it("같은 무리의 단어를 자기 자신과 함께 돌려준다", () => {
    expect(synonymsOf("car")).toContain("vehicle");
    expect(synonymsOf("car")).toContain("car");
    // 양방향이어야 한다 — 어느 쪽을 쳐도 같은 무리가 나온다
    expect(synonymsOf("vehicle")).toContain("car");
  });

  it("표에 없는 단어는 자기 자신만", () => {
    expect(synonymsOf("zzzunknown")).toEqual(["zzzunknown"]);
  });

  it("대소문자를 가리지 않는다", () => {
    expect(synonymsOf("Metal")).toContain("steel");
  });
});
