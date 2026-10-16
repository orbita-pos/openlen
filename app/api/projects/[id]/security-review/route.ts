// POST /api/projects/[id]/security-review { locale? } → start the security
//   review of the project as it is now, or reuse the one with the same
//   fingerprint: { view }. `view` is null when the review is off.
// GET  …?fingerprint=<sha256 hex> → how that review goes: { view }, 404 if none.
// Whoever can publish (the owner and editors), like /publish.
// (spec local 2026-10-15-security-review-design, 4.1)

import { z } from "zod";

import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";
import { securityReviewer } from "@/lib/security-review/real";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const StartSchema = z.object({ locale: z.string().min(2).max(10).optional() });
const FINGERPRINT = /^[0-9a-f]{64}$/;

async function access(req: Request, id: string): Promise<Response | null> {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const acceso = await exigirAcceso(id, userId, "editar");
  return acceso instanceof Response ? acceso : null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const denied = await access(req, id);
  if (denied) return denied;
  const parsed = StartSchema.safeParse(await req.json().catch(() => ({})));
  const locale = parsed.success ? (parsed.data.locale ?? "en") : "en";
  try {
    return json({ view: await securityReviewer().start(id, locale) });
  } catch (err) {
    // The dialog then publishes as before; the publish route asks again.
    console.warn("[security-review] could not start", err);
    return json({ view: null });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const denied = await access(req, id);
  if (denied) return denied;
  const fingerprint = new URL(req.url).searchParams.get("fingerprint") ?? "";
  if (!FINGERPRINT.test(fingerprint)) return json({ error: "invalid" }, 400);
  const view = await securityReviewer().view(id, fingerprint);
  return view ? json({ view }) : json({ error: "not_found" }, 404);
}
