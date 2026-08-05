import { describe, it, expect } from "vitest";
import { DEFAULT_VOLUME, MAX_VOLUME, mediaVolumeOf, boostOf } from "./volume";

describe("볼륨 분배 (media element + 게인)", () => {
  it("기본은 100%, 최대는 120%", () => {
    expect(DEFAULT_VOLUME).toBe(1);
    expect(MAX_VOLUME).toBe(1.2);
  });

  // 이 파일이 존재하는 이유. 두 갈래의 곱이 사용자가 고른 값과 정확히 같아야 한다 —
  // 양쪽에 같은 값을 다 주면 144%가 되고, 한쪽만 주면 증폭이 사라진다.
  it("media 볼륨 × 게인 = 사용자가 고른 값", () => {
    for (let v = 0; v <= MAX_VOLUME + 1e-9; v += 0.01) {
      expect(mediaVolumeOf(v) * boostOf(v)).toBeCloseTo(v, 10);
    }
  });

  it("100% 이하에서는 게인을 건드리지 않는다 (그래프가 없어도 동작해야 한다)", () => {
    expect(boostOf(0)).toBe(1);
    expect(boostOf(0.5)).toBe(1);
    expect(boostOf(1)).toBe(1);
    expect(mediaVolumeOf(0.5)).toBe(0.5);
  });

  it("100%를 넘으면 media는 1로 고정되고 나머지를 게인이 낸다", () => {
    expect(mediaVolumeOf(1.2)).toBe(1);
    expect(boostOf(1.2)).toBeCloseTo(1.2, 10);
  });
});
