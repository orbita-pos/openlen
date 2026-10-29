// git for the agent's routes and terminals (spec §4–5): the person's identity, a command over the
// project's repository in Postgres, and the status block at the start of a turn. Fail-soft: git
// is never what breaks a turn.
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { GitIdentity, GitRunResult } from "./command";
import { gitIdentity } from "./identity";
import { postgresStore } from "./postgres-store";
import { runGit } from "./run";
import { formatGitStatusBlock } from "./status-block";

export interface GitCliInput {
  readonly projectId: string;
  /** The project's owner: the author of the "Initial commit". */
  readonly ownerId: string;
  /** Who runs the command: the author of what it commits. */
  readonly personId: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly files: Readonly<Record<string, string>>;
  /** Why the terminal won't delete a file, or null: see GitRunInput.undeletable. */
  readonly undeletable?: (absolutePath: string) => string | null;
}

export async function identityOf(userId: string): Promise<GitIdentity> {
  const [u] = await db.select({ name: schema.users.name, handle: schema.users.handle }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return gitIdentity(userId, u ?? null);
}

async function identities(ownerId: string, personId: string): Promise<{ identity: GitIdentity; owner: GitIdentity }> {
  const identity = await identityOf(personId);
  return { identity, owner: ownerId === personId ? identity : await identityOf(ownerId) };
}

export async function gitCli(p: GitCliInput): Promise<GitRunResult> {
  try {
    const { identity, owner } = await identities(p.ownerId, p.personId);
    return await runGit(
      { store: postgresStore(p.projectId), files: p.files, cwd: p.cwd, identity, owner, now: () => new Date(), ...(p.undeletable ? { undeletable: p.undeletable } : {}) },
      p.args,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[git] the repository could not be read", err);
    return { stdout: "", stderr: "fatal: unable to read the repository\n", exitCode: 128 };
  }
}

/** Claude Code's git status block for this turn; null if git can't answer (the turn goes on without it). */
export async function gitStatusForTurn(p: {
  readonly projectId: string;
  readonly ownerId: string;
  readonly personId: string;
  readonly loadFiles: () => Promise<Record<string, string>>;
}): Promise<string | null> {
  const [files, who] = await Promise.all([p.loadFiles(), identities(p.ownerId, p.personId)]);
  const input = { store: postgresStore(p.projectId), files, cwd: "/", identity: who.identity, owner: who.owner, now: () => new Date() };
  const status = await runGit(input, ["--no-optional-locks", "status", "--short"]);
  const log = await runGit(input, ["--no-optional-locks", "log", "--oneline", "-n", "5"]);
  const branch = await runGit(input, ["--no-optional-locks", "branch", "--show-current"]);
  if (status.exitCode !== 0 || log.exitCode !== 0) return null;
  return formatGitStatusBlock({ branch: branch.stdout.trim() || "main", user: who.identity.name, status: status.stdout.trimEnd(), recentCommits: log.stdout.trimEnd() });
}
