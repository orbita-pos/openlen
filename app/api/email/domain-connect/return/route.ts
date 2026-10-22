// /api/email/domain-connect/return — WHERE A DNS PROVIDER SENDS THE OWNER BACK after
// Domain Connect (spec local 2026-10-22-email-integration, 6.2). The `state`
// proves which project it was (signed by us), the owner is checked, the domain
// is checked at once, and the owner lands on the Correos tab.

import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const [{ dcStateProject }, { realPanelDeps }, { checkDomain }] = await Promise.all([
    import("@/lib/project-email/panel"),
    import("@/lib/project-email/real"),
    import("@/lib/project-email/domain"),
  ]);
  const deps = realPanelDeps();
  const projectId = dcStateProject(url.searchParams.get("state") ?? "", deps.stateSecret);
  if (!projectId) return new Response("Invalid state", { status: 400 });
  const userId = (await auth())?.user?.id;
  if (!userId) return new Response("Sign in first", { status: 401 });
  const access = await exigirAcceso(projectId, userId, "ver");
  if (access instanceof Response) return access;
  if (access.rol !== "dueno") return new Response("Only the owner connects a domain", { status: 403 });
  await checkDomain(projectId, deps).catch((e: unknown) => console.warn("[email] check after Domain Connect failed", projectId, e));
  return Response.redirect(new URL(`/new?project=${encodeURIComponent(projectId)}&view=database`, url.origin), 303);
}
