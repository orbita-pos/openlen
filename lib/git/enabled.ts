// The kill switch (spec §4): OPENLEN_GIT=0 turns git off — no status block, the bash description as
// before, and `git: command not found`. Like Claude Code's includeGitInstructions.
export function gitEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_GIT !== "0";
}
