// @vitest-environment node
// A SYSTEM RE-EMIT THAT ADDS OVERRIDES PURGES THEM (review of G4+G5, minor 9): the edge keeps an asset Variant B overrides for up
// to thirty days, so one that a re-emit newly puts in the manifest must be flushed like the ones the launch purged.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { recordAndPurgeReemit } = await import("./reemit");

const EXP = { id: "ab_1234abcd", targetPath: "/pricing", includeLocales: true };
const record = vi.fn();
const purge = vi.fn();
const takeDown = vi.fn();
const deps = { record, purge, takeDown };

beforeEach(() => {
  record.mockReset();
  purge.mockReset();
  purge.mockResolvedValue(undefined);
  takeDown.mockReset();
  takeDown.mockResolvedValue(true);
});

describe("recordAndPurgeReemit", () => {
  it("🔴 overrides the re-emit ADDED are purged (with the target page and its languages), through the same purge as the launch", async () => {
    record.mockResolvedValue({ recorded: true, added: ["/css/new.css", "/js/new.js"] });
    await recordAndPurgeReemit(EXP, "pan", { sha: "rel-2", abOverrides: ["/css/old.css", "/css/new.css", "/js/new.js"] }, ["es"], "u1", deps);
    expect(record).toHaveBeenCalledWith("ab_1234abcd", "rel-2", ["/css/old.css", "/css/new.css", "/js/new.js"]);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith("pan", { targetPath: "/pricing", includeLocales: true, overridePaths: ["/css/new.css", "/js/new.js"] }, ["es"]);
  });

  it("a re-emit that adds nothing purges nothing of its own (the publish's own purge covers the page)", async () => {
    record.mockResolvedValue({ recorded: true, added: [] });
    await recordAndPurgeReemit(EXP, "pan", { sha: "rel-2", abOverrides: ["/css/old.css"] }, [], "u1", deps);
    expect(purge).not.toHaveBeenCalled();
  });

  it("🔴 an experiment that was closed meanwhile TAKES ITS SPLIT DOWN right away (round 3, B): the re-emit just swapped a split release over a decision", async () => {
    record.mockResolvedValue({ recorded: false, added: [] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordAndPurgeReemit(EXP, "pan", { sha: "rel-2", abOverrides: [] }, [], "u1", deps);
    error.mockRestore();
    expect(takeDown).toHaveBeenCalledTimes(1);
    expect(takeDown).toHaveBeenCalledWith("ab_1234abcd", "u1", "pan");
  });

  it("a recorded re-emit takes nothing down; a take-down that throws never fails the publish", async () => {
    record.mockResolvedValue({ recorded: true, added: [] });
    await recordAndPurgeReemit(EXP, "pan", { sha: "rel-2", abOverrides: [] }, [], "u1", deps);
    expect(takeDown).not.toHaveBeenCalled();
    record.mockResolvedValue({ recorded: false, added: [] });
    takeDown.mockRejectedValue(new Error("publish failed"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordAndPurgeReemit(EXP, "pan", { sha: "rel-2", abOverrides: [] }, [], "u1", deps)).resolves.toBeUndefined();
    expect(error.mock.calls.flat().join(" ")).toMatch(/take its split down|taking the split down/i);
    error.mockRestore();
  });

  it("🔴 an experiment that was closed meanwhile isn't recorded, isn't purged, and says so", async () => {
    record.mockResolvedValue({ recorded: false, added: ["/css/new.css"] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordAndPurgeReemit(EXP, "pan", { sha: "rel-2", abOverrides: ["/css/new.css"] }, [], "u1", deps);
    expect(error.mock.calls.flat().join(" ")).toMatch(/closed meanwhile/);
    error.mockRestore();
    expect(purge).not.toHaveBeenCalled();
  });

  it("a record that throws never fails the publish (the release is live), and says so", async () => {
    record.mockRejectedValue(new Error("the database went away"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordAndPurgeReemit(EXP, "pan", { sha: "rel-2", abOverrides: [] }, [], "u1", deps)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
