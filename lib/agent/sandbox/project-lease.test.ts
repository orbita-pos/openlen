// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import type { TurnSandbox } from "./choose";
import { boxHolders, forgetAllBoxes, joinBox, leaveBox, lockBox, withBoxLock } from "./project-lease";

const box = (name: string) => ({ name }) as unknown as TurnSandbox;

afterEach(() => forgetAllBoxes());

describe("one box per project, shared by the turn and its subagents", () => {
  it("opens once for two holders", async () => {
    let opened = 0;
    const open = async () => {
      opened++;
      return box("b1");
    };
    const [a, b] = await Promise.all([joinBox("p", "turn-1", open), joinBox("p", "sub-1", open, { subagent: true })]);
    expect(opened).toBe(1);
    expect(a).toBe(b);
    expect(boxHolders("p")).toEqual(["turn-1", "sub-1"]);
  });

  it("closes on the last leave", async () => {
    const closed: string[] = [];
    const close = async (b: TurnSandbox) => void closed.push((b as unknown as { name: string }).name);
    await joinBox("p", "turn-1", async () => box("b1"));
    await joinBox("p", "sub-1", async () => box("never"), { subagent: true });
    await leaveBox("p", "turn-1", close);
    expect(closed).toEqual([]);
    expect(boxHolders("p")).toEqual(["sub-1"]);
    await leaveBox("p", "sub-1", close);
    expect(closed).toEqual(["b1"]);
    expect(boxHolders("p")).toEqual([]);
  });

  it("joins the box another holder keeps open", async () => {
    const first = await joinBox("p", "sub-1", async () => box("b1"), { subagent: true });
    await leaveBox("p", "turn-1", async () => {
      throw new Error("turn-1 never joined: nothing to close");
    });
    const later = await joinBox("p", "turn-2", async () => box("never"));
    expect(later).toBe(first);
  });

  it("only one person's holders share it: another person's turn or subagent doesn't join", async () => {
    const first = await joinBox("p", "sub-1", async () => box("b1"), { subagent: true, person: "owner" });
    expect(await joinBox("p", "turn-2", async () => box("never"), { person: "member" })).toBeNull();
    expect(await joinBox("p", "sub-2", async () => box("never"), { subagent: true, person: "member" })).toBeNull();
    expect(await joinBox("p", "turn-3", async () => box("never"), { person: "owner" })).toBe(first);
    expect(boxHolders("p")).toEqual(["sub-1", "turn-3"]);
  });

  it("two plain turns of one project still don't share it", async () => {
    await joinBox("p", "turn-1", async () => box("b1"));
    expect(await joinBox("p", "turn-2", async () => box("never"))).toBeNull();
    expect(boxHolders("p")).toEqual(["turn-1"]);
  });

  it("a box that could not open is not kept, and the next holder tries again", async () => {
    expect(await joinBox("p", "turn-1", async () => null)).toBeNull();
    expect(boxHolders("p")).toEqual([]);
    expect(await joinBox("p", "turn-1", async () => box("b2"))).not.toBeNull();
  });

  it("serializes commands on one box", async () => {
    const b = box("b1");
    const marks: string[] = [];
    const slow = (n: string, ms: number) =>
      withBoxLock(b, async () => {
        marks.push(`in ${n}`);
        await new Promise((r) => setTimeout(r, ms));
        marks.push(`out ${n}`);
      });
    await Promise.all([slow("a", 20), slow("b", 1)]);
    expect(marks).toEqual(["in a", "out a", "in b", "out b"]);
  });

  it("lockBox holds the box until it is released", async () => {
    const b = box("b1");
    const release = await lockBox(b);
    const marks: string[] = [];
    const next = withBoxLock(b, async () => void marks.push("next ran"));
    await new Promise((r) => setTimeout(r, 5));
    expect(marks).toEqual([]);
    release();
    await next;
    expect(marks).toEqual(["next ran"]);
  });

  it("a failed command does not keep the box locked", async () => {
    const b = box("b1");
    await expect(withBoxLock(b, async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await withBoxLock(b, async () => "next")).toBe("next");
  });
});
