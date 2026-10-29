// The GitHub App's rows (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9): which installations a person
// connected, and the credentials git asks for. Everything here runs on the server; no token is stored or returned.
import "server-only";
import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { githubAppConfigured, tokenForRepoUrl, type GitHubInstallation } from "./github-app";

export async function installationsOf(userId: string): Promise<GitHubInstallation[]> {
  const rows = await db
    .select({ installationId: schema.githubAppInstallations.installationId, accountLogin: schema.githubAppInstallations.accountLogin, accountType: schema.githubAppInstallations.accountType })
    .from(schema.githubAppInstallations)
    .where(eq(schema.githubAppInstallations.userId, userId))
    .orderBy(schema.githubAppInstallations.createdAt);
  return rows;
}

export async function saveInstallation(userId: string, inst: GitHubInstallation): Promise<void> {
  await db
    .insert(schema.githubAppInstallations)
    .values({ userId, ...inst })
    .onConflictDoUpdate({
      target: [schema.githubAppInstallations.userId, schema.githubAppInstallations.installationId],
      set: { accountLogin: inst.accountLogin, accountType: inst.accountType },
    });
}

/** Disconnecting forgets the installations here; the App stays installed on GitHub until the person uninstalls it there. */
export async function removeInstallations(userId: string): Promise<void> {
  await db.delete(schema.githubAppInstallations).where(eq(schema.githubAppInstallations.userId, userId));
}

export async function ownsProject(userId: string, projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/** The project's `origin`, as `git remote get-url origin` would say it; null without one. */
export async function originOf(projectId: string): Promise<string | null> {
  const [row] = await db.select({ remotes: schema.projectGitRepos.remotes }).from(schema.projectGitRepos).where(eq(schema.projectGitRepos.projectId, projectId)).limit(1);
  return row?.remotes?.origin?.url ?? null;
}

/**
 * git's credentials for a remote of a project owned by `ownerId` (GitRunInput.remoteAuth): the owner's installation
 * token for that one repository, as Basic "x-access-token:<token>", or null. Fail-soft: without the App, the table or
 * GitHub, git says what it says without credentials.
 */
export function githubCredentials(ownerId: string): (url: string) => Promise<string | null> {
  return async (url) => {
    if (!githubAppConfigured()) return null;
    try {
      const token = await tokenForRepoUrl(await installationsOf(ownerId), url);
      return token ? `x-access-token:${token}` : null;
    } catch (err) {
      console.warn("[github-app] no credentials for a remote", err);
      return null;
    }
  };
}
