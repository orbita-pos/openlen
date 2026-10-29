// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatGitStatusBlock } from "./status-block";

describe("the git status block of a turn (Claude Code's, per turn)", () => {
  it("is Claude Code's text, with (clean) when there's nothing", () => {
    expect(formatGitStatusBlock({ branch: "main", user: "Ana", status: "", recentCommits: "a1b2c3d Initial commit" })).toBe(
      "This is the git status at the start of this turn. Note that this status is a snapshot in time, and will not update during the turn.\n\n" +
        "Current branch: main\n\nGit user: Ana\n\nStatus:\n(clean)\n\nRecent commits:\na1b2c3d Initial commit",
    );
  });
  it("🔴 with a remote, Claude Code's «Main branch» line after the current one; without, nothing changes", () => {
    expect(formatGitStatusBlock({ branch: "nueva", mainBranch: "main", user: "Ana", status: "", recentCommits: "a" })).toBe(
      "This is the git status at the start of this turn. Note that this status is a snapshot in time, and will not update during the turn.\n\n" +
        "Current branch: nueva\n\nMain branch (you will usually use this for PRs): main\n\nGit user: Ana\n\nStatus:\n(clean)\n\nRecent commits:\na",
    );
    expect(formatGitStatusBlock({ branch: "main", mainBranch: null, user: "Ana", status: "", recentCommits: "a" })).toBe(
      formatGitStatusBlock({ branch: "main", user: "Ana", status: "", recentCommits: "a" }),
    );
  });
  it("cuts the status at 2,000 characters with Claude Code's note", () => {
    const status = " M x.html\n".repeat(400).trimEnd();
    const block = formatGitStatusBlock({ branch: "main", user: "Ana", status, recentCommits: "a" });
    expect(block).toContain(`${status.substring(0, 2000)}\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using bash)`);
  });
});
