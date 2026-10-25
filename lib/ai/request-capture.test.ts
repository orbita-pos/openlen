import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureRequest } from "./request-capture";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "capture-"));
  dirs.push(d);
  return d;
};

describe("captureRequest", () => {
  it("in development, each body is one line of <requestId>.jsonl", () => {
    const dir = tempDir();
    captureRequest("proj-1", { model: "m", messages: [1] }, { OPENLEN_CAPTURE_REQUESTS_DIR: dir, NODE_ENV: "development" });
    captureRequest("proj-1", { model: "m", messages: [1, 2] }, { OPENLEN_CAPTURE_REQUESTS_DIR: dir, NODE_ENV: "development" });
    expect(readFileSync(join(dir, "proj-1.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).messages.length)).toEqual([1, 2]);
  });

  it("in production it writes nothing and says so once", () => {
    const dir = tempDir();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    captureRequest("proj-1", { model: "m" }, { OPENLEN_CAPTURE_REQUESTS_DIR: dir, NODE_ENV: "production" });
    captureRequest("proj-1", { model: "m" }, { OPENLEN_CAPTURE_REQUESTS_DIR: dir, NODE_ENV: "production" });
    expect(existsSync(join(dir, "proj-1.jsonl"))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("without the variable it does nothing; a request id cannot climb out of the folder", () => {
    const dir = tempDir();
    captureRequest("../escape", { model: "m" }, { OPENLEN_CAPTURE_REQUESTS_DIR: dir, NODE_ENV: "development" });
    expect(existsSync(join(dir, "___escape.jsonl"))).toBe(true);
    captureRequest("x", { model: "m" }, {});
  });
});
