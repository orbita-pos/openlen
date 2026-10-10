// «Reiniciar datos de prueba» del panel (spec local
// 2026-10-09-borrador-y-produccion-de-datos): lo mismo que `supabase db reset`
// en la terminal de Len — la base de pruebas se tira y se rehace con las
// migraciones de producción, las locales pendientes y `supabase/seed.sql`.
// Producción no se toca.
//
//   POST → { ok: true } | { ok: false, message }

import { resetDraftDatabase } from "@/lib/backend/draft";
import { getEnvironment } from "@/lib/backend/environments";
import { listProjectFiles } from "@/lib/backend/files";
import { json, ownedBackend } from "@/lib/backend/owner-access";
import { getBackendByProject } from "@/lib/backend/registry";
import { decryptToken } from "@/lib/integrations/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const ob = await ownedBackend(id, "draft");
  if (ob.kind === "unauthorized") return json({ error: "unauthorized" }, 401);
  if (ob.kind === "not_found") return json({ error: "not_found" }, 404);
  if (ob.kind !== "ready") return json({ ok: false, message: "no test database yet" }, 409);
  const rec = await getBackendByProject(id);
  const draft = await getEnvironment(id, "draft");
  if (!rec || !draft) return json({ ok: false, message: "no test database yet" }, 409);
  const live = await getEnvironment(id, "live");
  const password = decryptToken(rec.dbPasswordEncrypted);
  const r = await resetDraftDatabase({
    draft: { scope: draft.scope, ref: rec.ref, password },
    live: live?.provisionedAt ? { scope: live.scope, ref: rec.ref, password } : null,
    files: await listProjectFiles(id, "/supabase/"),
    includeLocal: true,
  });
  return r.ok ? json({ ok: true }) : json({ ok: false, message: `${r.name}: ${r.error.message}` }, 422);
}
