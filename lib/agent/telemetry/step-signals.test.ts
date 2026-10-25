import { describe, expect, it } from "vitest";
import { repeatSignals, summarizeBatch, toolErrorCode, type ToolOutcomeSummary } from "./step-signals";

const one = (name: string, args: Record<string, unknown>): ToolOutcomeSummary =>
  summarizeBatch([{ name, args }], [{ name, response: { ok: true } }])[0]!;

describe("toolErrorCode", () => {
  it("maps the production 'not read' error to not_read", () => {
    expect(
      toolErrorCode({
        ok: false,
        tool_result: "<tool_use_error>You have not read this file in this conversation. Read it before changing it.</tool_use_error>",
      }),
    ).toBe("not_read");
  });
  it("an ok response has no code; an explicit code wins; other failures are generic", () => {
    expect(toolErrorCode({ ok: true })).toBeUndefined();
    expect(toolErrorCode({ ok: false, code: "artifact_render_failed", error: "x" })).toBe("artifact_render_failed");
    expect(toolErrorCode({ ok: false, tool_result: "<tool_use_error>other</tool_use_error>" })).toBe("tool_use_error");
    expect(toolErrorCode({ ok: false, error: "boom" })).toBe("error");
  });
});

describe("summarizeBatch", () => {
  it("argument key order does not change argsHash", () => {
    const [a] = summarizeBatch([{ name: "Read", args: { file_path: "/a", limit: 5 } }], [{ name: "Read", response: { ok: true } }]);
    const [b] = summarizeBatch([{ name: "Read", args: { limit: 5, file_path: "/a" } }], [{ name: "Read", response: { ok: true } }]);
    expect(a!.argsHash).toBe(b!.argsHash);
    expect(a).toEqual({ name: "Read", argsHash: expect.stringMatching(/^[0-9a-f]{16}$/), ok: true });
  });
});

describe("repeatSignals", () => {
  it("the video loop: render/inspect alternating 4 times gives alternatingPair 4", () => {
    const R = one("render_artifact", {});
    const I = one("inspect_artifact", {});
    expect(repeatSignals([[R], [I], [R], [I], [R], [I], [R], [I]]).alternatingPair).toBe(4);
  });
  it("three identical calls in a row give identicalRun 3", () => {
    const B = one("bash", { command: "ls" });
    expect(repeatSignals([[one("Read", { file_path: "/x" })], [B], [B], [B]])).toEqual({ identicalRun: 3, alternatingPair: 0 });
  });
  it("nothing repeated gives zeros", () => {
    expect(repeatSignals([[one("Read", { file_path: "/a" })], [one("Read", { file_path: "/b" })]])).toEqual({ identicalRun: 1, alternatingPair: 0 });
    expect(repeatSignals([])).toEqual({ identicalRun: 0, alternatingPair: 0 });
  });
});
