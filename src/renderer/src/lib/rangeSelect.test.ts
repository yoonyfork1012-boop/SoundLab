import { describe, it, expect } from "vitest";
import { rangeBetween } from "./rangeSelect";

const list = [{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }, { id: 50 }];

describe("rangeBetween (Shift+클릭 범위 선택)", () => {
  it("기준점 아래로 끌면 양 끝을 포함한 구간을 준다", () => {
    expect(rangeBetween(list, 20, 3)).toEqual([
      { id: 20 },
      { id: 30 },
      { id: 40 },
    ]);
  });

  it("기준점 위로 끌어도 같은 구간을 준다", () => {
    expect(rangeBetween(list, 40, 1)).toEqual([
      { id: 20 },
      { id: 30 },
      { id: 40 },
    ]);
  });

  it("기준점을 그대로 다시 누르면 그 하나만 선택된다", () => {
    expect(rangeBetween(list, 30, 2)).toEqual([{ id: 30 }]);
  });

  it("전체 구간도 선택된다", () => {
    expect(rangeBetween(list, 10, 4)).toHaveLength(5);
  });

  it("기준점이 없으면 null (호출부가 단일 선택으로 처리)", () => {
    expect(rangeBetween(list, null, 2)).toBeNull();
  });

  // 검색어를 바꾸거나 정렬을 바꿔 기준 트랙이 현재 리스트에서 사라진 경우.
  // 인덱스 기반이었다면 엉뚱한 범위가 잡혔을 지점이다.
  it("기준 트랙이 현재 리스트에 없으면 null", () => {
    expect(rangeBetween(list, 999, 2)).toBeNull();
  });

  it("리스트 범위를 벗어난 목표 인덱스는 null", () => {
    expect(rangeBetween(list, 10, 5)).toBeNull();
    expect(rangeBetween(list, 10, -1)).toBeNull();
  });

  it("빈 리스트에서도 안전하다", () => {
    expect(rangeBetween([], 10, 0)).toBeNull();
  });
});
