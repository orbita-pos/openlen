// What the /api/tools/jobs routes share: the person (the workspace's session or the phone app's key, as the bridge and
// `data-change` — the route reads it with `usuarioDeLaPeticion`, phase 5, spec §4.14), the caller named like the bridge's (`installationId` or
// `draftProjectId`, `locale`, `timeZone`) from the body or the query, and each refusal's status.
import "server-only";

import { resolveBridgeCaller } from "@/lib/tools/bridge/caller";
import type { BridgeCaller } from "@/lib/tools/bridge/handlers";

import type { JobRefusal } from "./start";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const REFUSAL_STATUS: Readonly<Record<JobRefusal, number>> = {
  unknown_job: 404,
  bad_input: 400,
  bad_upload: 400,
  plan_required: 402,
  no_credits: 402,
  busy: 409,
  budget: 429,
  sandbox_off: 503,
  eyes_never_run: 403,
};

const CALLER_FIELDS = ["installationId", "draftProjectId", "locale", "timeZone"] as const;

/** The person and the tool asking, or the response that refuses them. */
export async function jobsCaller(userId: string | null, source: URLSearchParams | Record<string, unknown>): Promise<{ caller: BridgeCaller } | { response: Response }> {
  if (!userId) return { response: json({ error: "unauthorized" }, 401) };
  const read = (k: string) => (source instanceof URLSearchParams ? (source.get(k) ?? undefined) : source[k]);
  const who = await resolveBridgeCaller(userId, Object.fromEntries(CALLER_FIELDS.map((k) => [k, read(k)])));
  return "caller" in who ? { caller: who.caller } : { response: json(who.body, who.status) };
}
