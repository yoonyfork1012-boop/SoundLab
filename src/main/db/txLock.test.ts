import { describe, it, expect } from "vitest";
import { runExclusive } from "./txLock";

describe("runExclusive", () => {
  it("동시에 제출된 작업들이 겹치지 않고 직렬로 실행된다", async () => {
    let active = 0;
    let maxConcurrent = 0;
    const op = (): Promise<void> =>
      runExclusive(async () => {
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        // 이벤트 루프를 여러 번 양보해 겹칠 기회를 준다(스캔의 await 구간 흉내)
        await Promise.resolve();
        await Promise.resolve();
        active--;
      });
    await Promise.all([op(), op(), op()]);
    expect(maxConcurrent).toBe(1);
  });

  it("제출 순서대로 실행된다(FIFO)", async () => {
    const order: number[] = [];
    const tasks = [0, 1, 2, 3].map((i) =>
      runExclusive(async () => {
        await Promise.resolve();
        order.push(i);
      }),
    );
    await Promise.all(tasks);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("한 작업이 throw해도 큐가 막히지 않고 다음 작업이 실행된다", async () => {
    const order: string[] = [];
    const p1 = runExclusive(async () => {
      order.push("a");
      throw new Error("boom");
    }).catch(() => {
      /* 삼킨다 */
    });
    const p2 = runExclusive(async () => {
      order.push("b");
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual(["a", "b"]);
  });

  it("작업의 반환값을 그대로 돌려준다", async () => {
    const result = await runExclusive(async () => 42);
    expect(result).toBe(42);
  });
});
