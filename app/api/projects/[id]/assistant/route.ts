import { auth } from "@/auth";
import { getProject } from "@/lib/projects";
import { getAssistantUsage } from "@/lib/site-assistant/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ⚰️ AQUÍ VIVÍA UN `PATCH`, y era la segunda puerta a los ajustes.
//
// Se retiró el 2026-09-16: toda escritura de ajustes pasa por
// `lib/projects/settings-patch.ts`, que es el embudo que comparten el botón y
// Len. Dos formas de escribir lo mismo es como se crean las averías donde una
// se queda atrás — ver el comentario del `objetivo` en ese fichero.
//
// El GET se queda porque sirve algo que el embudo NO: `used`/`cap`, el consumo
// mensual del plan.

// GET /api/projects/[id]/assistant — current assistant settings + monthly
// usage for the panel.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const project = await getProject(id, session.user.id);
  if (!project) return json({ error: "not_found" }, 404);
  const a = project.data?.settings?.assistant ?? {};
  const usage = await getAssistantUsage(id, session.user.id);
  return json(
    {
      enabled: a.enabled ?? false,
      facts: a.facts ?? "",
      tone: a.tone ?? "",
      used: usage.used,
      cap: usage.cap,
    },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
