// Old boxes and those of deleted projects (spec local 2026-10-21-real-terminal-e2b, §9).
//
// A box paused for a week is killed: the next turn makes a new one from the project's files in
// Postgres, so only what lived in the box alone is lost (/tmp, what pip installed). A deleted
// project's box is killed at once. Both work with the key alone, even with the box switched off:
// switching it off must not leave boxes behind at E2B.

import { randomUUID } from "node:crypto";

import { SANDBOX_TEMPLATE } from "./config";
import type { SandboxDriver } from "./driver";
import { e2bDriver } from "./e2b-driver";
import * as rows from "./store";

export const REAP_AFTER_DAYS = 7;

export interface ReaperStore {
  idleBefore(cutoff: Date): Promise<rows.IdleSandbox[]>;
  get(projectId: string): Promise<rows.ProjectSandboxRow | null>;
  hold(projectId: string, turnId: string): Promise<boolean>;
  release(projectId: string, turnId: string): Promise<void>;
  /** Deletes the row only while `heldBy` holds it. */
  forget(projectId: string, heldBy: string): Promise<void>;
}

const postgresStore: ReaperStore = {
  idleBefore: rows.idleBefore,
  get: rows.getProjectSandbox,
  hold: rows.holdProjectSandbox,
  release: rows.releaseProjectSandbox,
  forget: rows.forgetProjectSandbox,
};

/** A driver to kill with: the key is enough. `null` without one. */
export function sandboxCleanupDriver(env: Readonly<Record<string, string | undefined>> = process.env): SandboxDriver | null {
  const apiKey = env.E2B_API_KEY?.trim();
  return apiKey ? e2bDriver({ apiKey, template: SANDBOX_TEMPLATE, dailyUsd: 0, onlyUsers: null }) : null;
}

/** E2B answers that it doesn't have the box (killed, reclaimed): there is nothing left to kill. */
export function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; message?: string; status?: number } | null;
  return err?.name === "NotFoundError" || err?.status === 404 || /not found|404/i.test(err?.message ?? "");
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function reapSandboxes(o: {
  readonly driver: SandboxDriver;
  readonly now: Date;
  readonly days?: number;
  readonly store?: ReaperStore;
  readonly log?: (line: string) => void;
}): Promise<{ killed: number; failed: number }> {
  const store = o.store ?? postgresStore;
  const log = o.log ?? ((line: string) => console.log(line));
  const cutoff = new Date(o.now.getTime() - (o.days ?? REAP_AFTER_DAYS) * 86_400_000);
  let killed = 0;
  let failed = 0;
  for (const { projectId, sandboxId, pausedAt } of await store.idleBefore(cutoff)) {
    // Held like a turn holds it, so no turn resumes the box while it is being killed.
    const reaperId = `${rows.REAPER_HOLD_PREFIX}${randomUUID()}`;
    if (!(await store.hold(projectId, reaperId))) continue;
    // A turn that used it between the list and the hold paused it again: a newer pausedAt.
    const now = await store.get(projectId);
    if (now?.sandboxId !== sandboxId || (now.pausedAt?.getTime() ?? null) !== (pausedAt?.getTime() ?? null)) {
      await store.release(projectId, reaperId);
      continue;
    }
    try {
      await o.driver.kill(sandboxId).catch((e: unknown) => {
        if (!isNotFound(e)) throw e;
      });
      await store.forget(projectId, reaperId);
      killed++;
    } catch (e) {
      failed++;
      log(`[sandbox-reaper] could not kill ${sandboxId} project=${projectId}: ${message(e)}`);
      await store.release(projectId, reaperId).catch(() => undefined);
    }
  }
  return { killed, failed };
}

/** The project's box, read BEFORE deleting it (its row goes with the project). Never throws. */
export async function sandboxOfProject(projectId: string): Promise<string | null> {
  try {
    return (await rows.getProjectSandbox(projectId))?.sandboxId ?? null;
  } catch {
    return null;
  }
}

/** Kills a deleted project's box. Never throws: deleting the project must not fail for E2B. */
export async function killSandboxOfDeletedProject(
  sandboxId: string,
  o: { readonly driver?: SandboxDriver | null; readonly log?: (line: string) => void } = {},
): Promise<void> {
  const log = o.log ?? ((line: string) => console.log(line));
  const driver = o.driver === undefined ? sandboxCleanupDriver() : o.driver;
  if (!driver) {
    log(`[sandbox] no E2B key to kill ${sandboxId} of a deleted project`);
    return;
  }
  try {
    await driver.kill(sandboxId);
  } catch (e) {
    if (!isNotFound(e)) log(`[sandbox] could not kill ${sandboxId} of a deleted project: ${message(e)}`);
  }
}
