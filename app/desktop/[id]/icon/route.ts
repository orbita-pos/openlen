// THE ICON OF AN APP ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §4.5): `/desktop/<id>/icon`, what the
// manifest and the window's tab point at. The letter of an ordinary app is drawn from its name, so it is as private as
// the name: it answers what the page answers, and everything but the person's own live app is a 404.
import { auth } from "@/auth";
import { desktopIconResponse } from "@/lib/desktop-apps/icon";
import { desktopWindow } from "@/lib/desktop-apps/page-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const session = await auth();
  const { state, row } = await desktopWindow({ id, sessionUserId: session?.user?.id ?? null, requestHost: req.headers.get("host") });
  if ((state.kind !== "ready" && state.kind !== "plan_required") || !row) return notFound();
  return desktopIconResponse(row);
}
