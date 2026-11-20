// @vitest-environment node
// A SYSTEM RE-EMIT THAT ADDS OVERRIDES PURGES THEM (review of G4+G5, minor 9): the edge keeps an asset Variant B overrides for up
// to thirty days, so one that a re-emit newly puts in the manifest must be flushed like the ones the launch purged.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { recordAndPurgeReemit } = await import("./reemit");

const EXP = { id: "ab_1234abcd", targetPath: "/pricing", includeLocales: true };
const record = vi.fn();
const purge = vi.fn();
const deps = { record, purge };

beforeEach(() => {
  record.mockReset();
  purge.mockReset();
  purge.mockResolvedValue(undefined);
});

describe("recordAndPurgeReemit", () => {
  it("🔴 overrides the re-emit ADDED are purged (with the target page and its languages), through the same purge as the launch", async () => {
    record.mockResolvedValue({ recorded: true, added: ["/css/new.css", "/js/new.js"] });
    await recordAndPurgeReemit(EXP, "pan", { sha: "rel-2", abOverrides: ["/css/old.css", "/css/new.css", "/js/new.js"] }, ["es"], deps);
    expect(record).toHaveBeenCalledWith("ab_1234abcd", "rel-2", ["/css/old.css", "/css/new.css", "/js/new.js"]);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith("pan", { targetPath: "/pricing", includeLocales: true, overridePaths: ["/css/new.css", "/js/new.js"] }, ["es"]);
  });

  it("a re-emit that adds nothing purges nothing of its own (the publish's own purge covers the page)", async () => {
    record.mockResolvedValue({ recorded: true, added: [] });
    await recordAndPurgeReemit(EXP, "pan", { sha: "rel-2", abOverrides: ["/css/old.css"] }, [], deps);
    expect(purge).not.toHaveBeenCalled();
  });

  it("🔴 an experiment that was closed meanwhile isn't recorded, isn't purged, and says so", async () => {
    record.mockResolvedValue({ recorded: false, added: ["/css/new.css"] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordAndPurgeReemit(EXP, "pan", { sha: "rel-2", abOverrides: ["/css/new.css"] }, [], deps);
    expect(error.mock.calls.flat().join(" ")).toMatch(/closed meanwhile/);
    error.mockRestore();
    expect(purge).not.toHaveBeenCalled();
  });

  it("a record that throws never fails the publish (the release is live), and says so", async () => {
    record.mockRejectedValue(new Error("the database went away"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordAndPurgeReemit(EXP, "pan", { sha: "rel-2", abOverrides: [] }, [], deps)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
