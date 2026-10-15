// @vitest-environment node
import { describe, expect, it } from "vitest";
import { gitForTerminal } from "./git-option";

describe("git in a terminal", () => {
  const session = { projectId: "p", userId: "owner", personId: "member" };
  it("calls gitCli with the owner, the person who speaks, and the command", async () => {
    const seen: unknown[] = [];
    const git = gitForTerminal(session, { gitCli: async (p) => (seen.push(p), { stdout: "", stderr: "", exitCode: 0 }) }, {});
    await git!(["status"], "/", { "/index.html": "x" });
    expect(seen).toEqual([{ projectId: "p", ownerId: "owner", personId: "member", args: ["status"], cwd: "/", files: { "/index.html": "x" } }]);
  });
  it("none with OPENLEN_GIT=0 or without gitCli", () => {
    expect(gitForTerminal(session, { gitCli: async () => ({ stdout: "", stderr: "", exitCode: 0 }) }, { OPENLEN_GIT: "0" })).toBeUndefined();
    expect(gitForTerminal(session, {}, {})).toBeUndefined();
  });
});
