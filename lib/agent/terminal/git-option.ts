// `git` in a terminal (spec local 2026-10-15-git-for-len): the option TerminalDeLen takes, or
// nothing when git is off (OPENLEN_GIT=0) or the deps have no git. The author is the person who
// speaks; the owner signs the "Initial commit". git gets the terminal's own deletion rule, so a
// revert never records as deleted a page the terminal would keep.
import { personOf } from "@/lib/agent/person";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import { gitEnabled } from "@/lib/git/enabled";
import { deletionRefusal } from "./deletion-rule";

export type TerminalGit = (
  args: readonly string[],
  cwd: string,
  files: Readonly<Record<string, string>>,
) => Promise<{ stdout: string; stderr: string; exitCode: number; write?: Readonly<Record<string, string | null>> }>;

export function gitForTerminal(
  session: Pick<AgentSession, "projectId" | "userId" | "personId">,
  deps: Pick<AgentDeps, "gitCli">,
  env: Readonly<Record<string, string | undefined>> = process.env,
): TerminalGit | undefined {
  const gitCli = deps.gitCli;
  if (!gitEnabled(env) || !gitCli) return undefined;
  return (args, cwd, files) =>
    gitCli({ projectId: session.projectId, ownerId: session.userId, personId: personOf(session), args, cwd, files, undeletable: deletionRefusal });
}

export type TerminalGh = (
  args: readonly string[],
  cwd: string,
  files: Readonly<Record<string, string>>,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/** `gh` (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9) wherever there is git: with the owner's GitHub App,
 *  run by whoever speaks — a turn of Len's is someone who can edit (the route lets no viewer start one). */
export function ghForTerminal(
  session: Pick<AgentSession, "projectId" | "userId" | "personId">,
  deps: Pick<AgentDeps, "ghCli">,
  env: Readonly<Record<string, string | undefined>> = process.env,
): TerminalGh | undefined {
  const ghCli = deps.ghCli;
  if (!gitEnabled(env) || !ghCli) return undefined;
  return (args, cwd, files) => ghCli({ projectId: session.projectId, ownerId: session.userId, personId: personOf(session), canEdit: true, args, cwd, files });
}
