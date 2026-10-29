// The git status block Len gets at the start of each turn: Claude Code's, read in its binary
// (2.1.296), with "conversation" said as "turn" — a conversation with Len lasts days (spec §5).
const MAX_STATUS = 2000;

export function formatGitStatusBlock(p: {
  readonly branch: string;
  /** With a remote, Claude Code's «Main branch (you will usually use this for PRs)»; null or absent without one. */
  readonly mainBranch?: string | null;
  readonly user: string;
  readonly status: string;
  readonly recentCommits: string;
}): string {
  const status =
    p.status.length > MAX_STATUS
      ? `${p.status.substring(0, MAX_STATUS)}\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using bash)`
      : p.status;
  return [
    "This is the git status at the start of this turn. Note that this status is a snapshot in time, and will not update during the turn.",
    `Current branch: ${p.branch}`,
    ...(p.mainBranch ? [`Main branch (you will usually use this for PRs): ${p.mainBranch}`] : []),
    ...(p.user ? [`Git user: ${p.user}`] : []),
    `Status:\n${status || "(clean)"}`,
    `Recent commits:\n${p.recentCommits}`,
  ].join("\n\n");
}
