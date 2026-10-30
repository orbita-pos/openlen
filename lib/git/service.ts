// git for the agent's routes and terminals (spec §4–5): the person's identity, a command over the
// project's repository in Postgres, and the status block at the start of a turn. Fail-soft: git
// is never what breaks a turn.
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { githubCredentials } from "@/lib/integrations/github-app-store";
import type { GitIdentity, GitRunResult } from "./command";
import { gitIdentity } from "./identity";
import { gitStoreFor } from "./postgres-store";
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
  /** A remote's credentials (GitRunInput.remoteAuth); by default the owner's GitHub App installation token. */
  readonly remoteAuth?: (url: string) => Promise<string | null>;
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
      {
        store: await gitStoreFor(p.projectId),
        files: p.files,
        cwd: p.cwd,
        identity,
        owner,
        now: () => new Date(),
        ...(p.undeletable ? { undeletable: p.undeletable } : {}),
        // GitHub (§9): the owner's installation token, the same whoever runs the command.
        remoteAuth: p.remoteAuth ?? githubCredentials(p.ownerId),
      },
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
  const input = { store: await gitStoreFor(p.projectId), files, cwd: "/", identity: who.identity, owner: who.owner, now: () => new Date() };
  const status = await runGit(input, ["--no-optional-locks", "status", "--short"]);
  const log = await runGit(input, ["--no-optional-locks", "log", "--oneline", "-n", "5"]);
  const branch = await runGit(input, ["--no-optional-locks", "branch", "--show-current"]);
  if (status.exitCode !== 0 || log.exitCode !== 0) return null;
  const mainBranch = await mainBranchOf(input);
  return formatGitStatusBlock({ branch: branch.stdout.trim() || "main", mainBranch, user: who.identity.name, status: status.stdout.trimEnd(), recentCommits: log.stdout.trimEnd() });
}

/**
 * With a remote, the branch pull requests usually go into, as Claude Code picks it: the remote's main or master,
 * else the local one; null without a remote (the status block then stays as it was).
 */
async function mainBranchOf(input: Parameters<typeof runGit>[0]): Promise<string | null> {
  const remotes = (await runGit(input, ["--no-optional-locks", "remote"])).stdout.split("\n").filter(Boolean);
  if (remotes.length === 0) return null;
  const remote = remotes.includes("origin") ? "origin" : remotes[0]!;
  const tracked = (await runGit(input, ["--no-optional-locks", "branch", "-r"])).stdout.split("\n").map((l) => l.trim());
  const local = (await runGit(input, ["--no-optional-locks", "branch"])).stdout.split("\n").map((l) => l.replace(/^[* ]\s*/, "").trim());
  for (const name of ["main", "master"]) if (tracked.includes(`${remote}/${name}`)) return name;
  for (const name of ["main", "master"]) if (local.includes(name)) return name;
  return null;
}

/** Whether the project's repository has a remote: bash then carries Claude Code's push and PR protocol. Fail-soft. */
export async function projectHasRemote(projectId: string): Promise<boolean> {
  try {
    const [row] = await db.select({ remotes: schema.projectGitRepos.remotes }).from(schema.projectGitRepos).where(eq(schema.projectGitRepos.projectId, projectId)).limit(1);
    return Object.keys(row?.remotes ?? {}).length > 0;
  } catch {
    return false;
  }
}
