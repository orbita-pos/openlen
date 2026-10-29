import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { githubAppConfigured } from "@/lib/integrations/github-app";
import { installationsOf, originOf, ownsProject, removeInstallations } from "@/lib/integrations/github-app-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET    /api/integrations/github-app?project=<id> → whether the App exists here, the connected accounts and the
//        project's `origin` (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9: «Conectar GitHub» and which
//        repo is connected; no git buttons, like Claude Code).
// DELETE /api/integrations/github-app?project=<id> → forget the person's installations.
// Only the owner: the installation is theirs.

async function owner(req: NextRequest): Promise<string | NextResponse> {
  const userId = (await auth())?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("project") ?? "";
  if (!projectId || !(await ownsProject(userId, projectId))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return userId;
}

export async function GET(req: NextRequest): Promise<Response> {
  const who = await owner(req);
  if (typeof who !== "string") return who;
  const [installations, origin] = await Promise.all([installationsOf(who), originOf(req.nextUrl.searchParams.get("project")!)]);
  return NextResponse.json({
    configured: githubAppConfigured(),
    accounts: installations.map((i) => ({ login: i.accountLogin, type: i.accountType })),
    origin,
  });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const who = await owner(req);
  if (typeof who !== "string") return who;
  await removeInstallations(who);
  return new NextResponse(null, { status: 204 });
}
