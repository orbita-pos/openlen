// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HOME_PAGE_REFUSAL } from "./deletion-rule";
import { ghForTerminal, gitForTerminal } from "./git-option";
import { READ_ONLY_REFUSAL } from "./read-only-commands";

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
  it("in a read-only session, a commit answers the refusal and never reaches gitCli; a status still does", async () => {
    const seen: unknown[] = [];
    const git = gitForTerminal({ ...session, readOnly: true }, { gitCli: async (p) => (seen.push(p.args), { stdout: "clean", stderr: "", exitCode: 0 }) }, {});
    expect(await git!(["commit", "-m", "x"], "/", {})).toEqual({ stdout: "", stderr: `${READ_ONLY_REFUSAL}\n`, exitCode: 1 });
    expect(await git!(["status"], "/", {})).toMatchObject({ stdout: "clean", exitCode: 0 });
    expect(seen).toEqual([["status"]]);
  });
  it("in a read-only session, gh pr create never reaches ghCli", async () => {
    const seen: unknown[] = [];
    const gh = ghForTerminal({ ...session, readOnly: true }, { ghCli: async (p) => (seen.push(p.args), { stdout: "", stderr: "", exitCode: 0 }) }, {});
    expect((await gh!(["pr", "create"], "/", {})).exitCode).toBe(1);
    expect(seen).toEqual([]);
  });
  it("none with OPENLEN_GIT=0 or without gitCli", () => {
    expect(gitForTerminal(session, { gitCli: async () => ({ stdout: "", stderr: "", exitCode: 0 }) }, { OPENLEN_GIT: "0" })).toBeUndefined();
    expect(gitForTerminal(session, {}, {})).toBeUndefined();
  });
});
