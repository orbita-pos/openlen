import { auth } from "@/auth";
import { functionsOverview } from "@/lib/functions/overview";
import { realOverviewDeps } from "@/lib/functions/overview-real";
import { exigirAcceso } from "@/lib/projects/acceso";

// ─────────────────────────────────────────────────────────────────────────────
// /api/projects/[id]/functions — LAS EDGE FUNCTIONS DE UN PROYECTO, para la
// vista Base de datos (spec local 2026-10-11, Parte 6): cada función y dónde
// está (borrador, producción), las llamadas del mes contra la cuota de su plan,
// los últimos errores (ya tapados al anotarse) y si tiene la marca de abuso.
//
//   GET (ver) → { available: false } sin motor; si no, el resumen.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const acceso = await exigirAcceso(id, userId, "ver");
  if (acceso instanceof Response) return acceso;
  const deps = realOverviewDeps();
  if (!deps) return json({ available: false }, 200);
  return json(await functionsOverview(id, deps), 200);
}
