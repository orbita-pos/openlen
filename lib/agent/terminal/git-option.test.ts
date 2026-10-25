// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HOME_PAGE_REFUSAL } from "./deletion-rule";
import { gitForTerminal } from "./git-option";

describe("git in a terminal", () => {
  const session = { projectId: "p", userId: "owner", personId: "member" };
  it("calls gitCli with the owner, the person who speaks, the command, and the terminal's deletion rule", async () => {
    const seen: { undeletable?: (path: string) => string | null }[] = [];
    const git = gitForTerminal(session, { gitCli: async (p) => (seen.push(p), { stdout: "", stderr: "", exitCode: 0 }) }, {});
    await git!(["status"], "/", { "/index.html": "x" });
    expect(seen).toEqual([{ projectId: "p", ownerId: "owner", personId: "member", args: ["status"], cwd: "/", files: { "/index.html": "x" }, undeletable: expect.any(Function) }]);
    expect(seen[0]!.undeletable!("/index.html")).toBe(HOME_PAGE_REFUSAL);
    expect(seen[0]!.undeletable!("/menu/index.html")).toBeNull();
    expect(seen[0]!.undeletable!("/src/App.tsx")).toBeNull();
  });
  it("none with OPENLEN_GIT=0 or without gitCli", () => {
    expect(gitForTerminal(session, { gitCli: async () => ({ stdout: "", stderr: "", exitCode: 0 }) }, { OPENLEN_GIT: "0" })).toBeUndefined();
    expect(gitForTerminal(session, {}, {})).toBeUndefined();
  });
});
