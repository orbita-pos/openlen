import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_ACTIVE_SUBAGENTS,
  forgetAllSubagents,
  liveCount,
  noticeTurnPending,
  queueNotice,
  release,
  reserve,
  setNoticeTurnPending,
  stop,
  stopProject,
  takeNotices,
  waitForNoticeOrIdle,
} from "./registry";
import { createTurnSpend } from "./spend";

afterEach(() => forgetAllSubagents());

describe("the live subagents of each project", () => {
  it("eight at once per project, no queue: the ninth is refused, and a slot frees on release", () => {
    expect(MAX_ACTIVE_SUBAGENTS).toBe(8);
    for (let i = 0; i < 8; i++) expect(reserve("p", `r${i}`, new AbortController())).toBe(true);
    expect(reserve("p", "r8", new AbortController())).toBe(false);
    expect(reserve("other", "o1", new AbortController())).toBe(true);
    release("p", "r0");
    expect(reserve("p", "r8", new AbortController())).toBe(true);
    expect(liveCount("p")).toBe(8);
  });

  it("registry.stop aborts only that run", () => {
    const a = new AbortController();
    const b = new AbortController();
    reserve("p", "r1", a);
    reserve("p", "r2", b);
    expect(stop("r1")).toBe(true);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(stop("nope")).toBe(false);
  });

  it("deleting the project stops all of its own", () => {
    const a = new AbortController();
    const b = new AbortController();
    const c = new AbortController();
    reserve("p", "r1", a);
    reserve("p", "r2", b);
    reserve("q", "r3", c);
    expect(stopProject("p")).toBe(2);
    expect([a.signal.aborted, b.signal.aborted, c.signal.aborted]).toEqual([true, true, false]);
  });

  it("notices wait in order and are taken once", () => {
    queueNotice("p", { id: "r1", text: "one" });
    queueNotice("p", { id: "r2", text: "two" });
    expect(takeNotices("p")).toEqual([{ id: "r1", text: "one" }, { id: "r2", text: "two" }]);
    expect(takeNotices("p")).toEqual([]);
  });

  it("waiting resolves with a notice, or when no child is left", async () => {
    reserve("p", "r1", new AbortController());
    const waiting = waitForNoticeOrIdle("p");
    queueNotice("p", { id: "r1", text: "done" });
    expect(await waiting).toBe("notice");
    takeNotices("p");
    const idle = waitForNoticeOrIdle("p");
    release("p", "r1");
    expect(await idle).toBe("idle");
    expect(await waitForNoticeOrIdle("p")).toBe("idle");
  });

  it("a waiting turn stops waiting with its ■", async () => {
    reserve("p", "r1", new AbortController());
    const stopTurn = new AbortController();
    const waiting = waitForNoticeOrIdle("p", stopTurn.signal);
    stopTurn.abort();
    expect(await waiting).toBe("idle");
  });

  it("knows when a notice turn is already queued", () => {
    expect(noticeTurnPending("p")).toBe(false);
    setNoticeTurnPending("p", true);
    expect(noticeTurnPending("p")).toBe(true);
    setNoticeTurnPending("p", false);
    expect(noticeTurnPending("p")).toBe(false);
  });
});

describe("the turn's spending limit, shared with its subagents", () => {
  it("counts Len's spend and the children's against the same cap", () => {
    let len = 10;
    const spend = createTurnSpend(30, () => len);
    expect(spend.over()).toBe(false);
    spend.addChildren(15);
    expect(spend.children()).toBe(15);
    expect(spend.over()).toBe(false);
    expect(spend.over(5)).toBe(true);
    len = 16;
    expect(spend.over()).toBe(true);
  });
});
