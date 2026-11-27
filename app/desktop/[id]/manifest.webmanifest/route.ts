// THE MANIFEST OF AN APP ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §4.3): `/desktop/<id>/manifest.webmanifest`.
// It asks what the window asks (`desktopWindow`), so another person's id, a removed app or a switch that is off is the same
// 404 as an id that never existed — and the name is never in it. A free plan still has one: the installed window opens
// to say a paid plan is needed. The page's `<link rel="manifest">` is `crossorigin="use-credentials"` (a manifest is
// fetched without cookies otherwise), which is how this sees the session.
import { auth } from "@/auth";
import { desktopManifest } from "@/lib/desktop-apps/manifest";
import { desktopWindow } from "@/lib/desktop-apps/page-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const session = await auth();
  const { state, row } = await desktopWindow({ id, sessionUserId: session?.user?.id ?? null, requestHost: req.headers.get("host") });
  if ((state.kind !== "ready" && state.kind !== "plan_required") || !row) return notFound();
  return new Response(JSON.stringify(desktopManifest({ id, name: state.name, iconPath: row.iconPath })), {
    status: 200,
    headers: { "content-type": "application/manifest+json", "cache-control": "no-store" },
  });
}
