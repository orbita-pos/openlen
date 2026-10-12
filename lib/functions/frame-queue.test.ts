// @vitest-environment node
import { describe, expect, it } from "vitest";

import { FrameQueue } from "./frame-queue";

describe("FrameQueue", () => {
  it("entrega en orden, también a dos next() que esperan a la vez, y termina al cerrar", async () => {
    const q = new FrameQueue<number>();
    const it = q[Symbol.asyncIterator]();
    const a = it.next();
    const b = it.next();
    q.push(1);
    q.push(2);
    q.push(3);
    q.close();
    expect(await a).toEqual({ value: 1, done: false });
    expect(await b).toEqual({ value: 2, done: false });
    expect(await it.next()).toEqual({ value: 3, done: false });
    expect((await it.next()).done).toBe(true);
    q.push(4);
    expect((await it.next()).done).toBe(true);
  });
});
