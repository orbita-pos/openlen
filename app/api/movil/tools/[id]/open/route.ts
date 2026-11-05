// ─────────────────────────────────────────────────────────────────────────────
// POST /api/movil/tools/[id]/open — the phone app opens one of the person's installed tools (spec local
// 2026-11-04-herramientas-hechas-por-len, §4.14): its frame URL on the phone's OWN private label, which only the
// phone app may frame and whose bridge answers only the app — the workspace's label stays framed only by
// openlen.com, as `/api/movil/canvas` keeps `framedBy` to its own document.
//
// → 200 { url, origin } · 401 without a key or a session · 404 `tools_off` · 404 `not_found` (not the person's,
// switched off or removed) · 402 `plan_required` (§4.13) · 409 `broken` (its release is gone) · 503 `no_frame_host`
// (the canvas origin is off, or there is no secret to make a label). The label is written on the row the first
// time; it is an HMAC of the id, so it never changes.
// ─────────────────────────────────────────────────────────────────────────────
import { getUserPlan } from "@/lib/limits";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { toolsEnabled } from "@/lib/tools/enabled";
import { toolFrameUrl, toolPhoneHostLabel } from "@/lib/tools/host";
import { installationById, releaseExists, setPhoneHostLabel } from "@/lib/tools/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const POST = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!toolsEnabled()) return json({ error: "tools_off" }, 404);
  const { id } = await params;
  const row = await installationById(id);
  if (!row || row.personId !== userId || !row.enabled || row.removedAt) return json({ error: "not_found" }, 404);
  if ((await getUserPlan(userId)) === "free") return json({ error: "plan_required" }, 402);
  if (!(await releaseExists(row.releaseSha))) return json({ error: "broken" }, 409);
  const label = toolPhoneHostLabel(row.id);
  const url = label ? toolFrameUrl({ hostLabel: label, releaseSha: row.releaseSha, requestHost: req.headers.get("host") }) : null;
  if (!label || !url) return json({ error: "no_frame_host" }, 503);
  if (row.phoneHostLabel !== label) await setPhoneHostLabel(row.id, label);
  return json({ url, origin: new URL(url).origin });
});

export const OPTIONS = respuestaPrevia;
