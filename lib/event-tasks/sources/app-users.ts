// THE `app_users` SOURCE (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.4.2, §7.6.5): an app's new
// sign-ups — «avísame cuando se registre alguien de una empresa». Its production users, read apart from Len's read-only
// role (lib/backend/auth/live-users.ts), with their id, email, when, and their own metadata flattened so a condition can
// name its keys; never a password, a token or the app's metadata. Anonymous and deleted users are not sign-ups. Its
// channel: an email to the person, when they gave one and the project's email is ready.
import "server-only";

import type { z } from "zod";

import { readLiveAuthUsers } from "@/lib/backend/auth/live-users";
import { authUsersByIds, authUsersMatching, latestAuthUsers, newAuthUsersAfter, newestAuthUser, type NewAuthUser } from "@/lib/backend/auth/store";

import { appUsersParamsSchema } from "./declarations";
import { MATCHING_MAX, SourceError, type EventSource, type SourceChange } from "./types";

export interface AppUsersParams {
  readonly conditions?: readonly { readonly field: string; readonly op: "eq" | "neq" | "contains" | "gt" | "lt" | "exists"; readonly value?: string | number }[];
}

export interface AppUsersState {
  readonly cursor: { readonly at: string; readonly id: string };
}

/** GoTrue's audience of the app's users (lib/backend/dashboard.ts). */
const AUD = "authenticated";
const PAGE = 200;
const BEFORE = 20;
const START = { at: "-infinity", id: "" } as const;
const RESERVED = new Set(["id", "email", "created_at"]);

const paramsSchema = appUsersParamsSchema as unknown as z.ZodType<AppUsersParams>;

/** A sign-up as the judge reads it: who and when, then the metadata's own keys. */
function row(u: NewAuthUser): Record<string, unknown> {
  const meta = Object.fromEntries(Object.entries(u.metadata ?? {}).filter(([k]) => !RESERVED.has(k)));
  return { id: u.id, email: u.email, created_at: u.created_at, ...meta };
}

async function read<T>(projectId: string, work: Parameters<typeof readLiveAuthUsers<T>>[1]): Promise<T> {
  const out = await readLiveAuthUsers(projectId, work);
  if (out === null) throw new SourceError("no_live", "The app has no production base yet: it is created on its first publish.");
  return out;
}

export const appUsersSource: EventSource<AppUsersParams, AppUsersState> = {
  kind: "app_users",
  paramsSchema,
  // A sign-up is never changed by a card; the person can be written to.
  offers: { dataChange: false, replies: ["email"] },

  async validate(projectId) {
    // Wrapped: a base with no users yet is a newest of null, not a missing base.
    const out = await readLiveAuthUsers(projectId, async (q) => ({ newest: await newestAuthUser(q, AUD) }));
    if (out === null) return { ok: false, reason: "The app has no production base yet: publish it first, then create the task." };
    return { ok: true, initialState: { cursor: out.newest ? { at: out.newest.created_at, id: out.newest.id } : START } };
  },

  async observe(projectId, _params, state) {
    const users = await read(projectId, (q) => newAuthUsersAfter(q, AUD, state.cursor, PAGE));
    if (users.length === 0) return { state, changes: [] };
    const changes: SourceChange[] = users.map((u) => ({ subject: "users", summary: u.email ?? u.id, detail: row(u), link: u.id, at: u.created_at }));
    const last = users.at(-1)!;
    return { state: { cursor: { at: last.created_at, id: last.id } }, changes };
  },

  async read(projectId, _params, { keys, match }) {
    if (match && match.length > 1) throw new SourceError("column_missing", "app_users matches one field at a time.");
    return read(projectId, async (q) => {
      const items = (await authUsersByIds(q, AUD, keys)).map(row);
      const previous = (await latestAuthUsers(q, AUD, BEFORE)).map(row);
      if (!match?.length) return { items, previous };
      return { items, previous, matching: (await authUsersMatching(q, AUD, match[0]!.field, match[0]!.value, MATCHING_MAX)).map(row) };
    });
  },
};
