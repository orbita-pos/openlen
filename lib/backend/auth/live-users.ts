// AN APP'S USERS FOR AN EVENT TASK (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.6.5): its production
// base's `auth.users`, read the way the Database view lists them — as GoTrue's admin role — and only by the `app_users`
// source. Len's read-only role (`queryLive`, `db query --linked`) does not grow: it keeps not seeing `auth.users`. The
// transaction is READ ONLY before anything else runs in it, so nothing here can write.
import "server-only";

import type { TxQuery } from "../db";

/** Null without a production base. */
export async function readLiveAuthUsers<T>(projectId: string, work: (q: TxQuery) => Promise<T>): Promise<T | null> {
  const { liveBackendProject } = await import("@/lib/backend/owner-access");
  const project = await liveBackendProject(projectId);
  if (!project) return null;
  return project.db.transaction(async (q) => {
    await q("set transaction read only");
    // As `queryLive`'s read: a slow or locked read gives up instead of holding a connection the live app shares, or the
    // watcher's whole pass (final review I3).
    await q("set local statement_timeout = '10s'");
    await q("set local lock_timeout = '5s'");
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    return work(q);
  });
}
