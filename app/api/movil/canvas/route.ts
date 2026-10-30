import { lienzoApagado } from "@/lib/lienzo/host";
import { openCanvasDocument } from "@/lib/lienzo/open-document";
import { ORIGENES_DE_LA_APP, paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { accesoAlProyecto } from "@/lib/projects/acceso";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/movil/canvas — the phone app's preview: the project as it is saved, on its canvas host, the one the
// web workspace shows.
//
// The phone used to show the share link (/p/<id>?t=), which serves data.html as it is. For an app that is only
// the shell that starts it (`#root` + `/src/main.jsx`), and nothing answers `/src/main.jsx` there: an app runs
// only through the compiler (CLAUDE.md, invariant 6), and the canvas is where it does. A page gets its folder too
// (`/img/…`), which the share link doesn't serve.
//
// Body { projectId, page? } → { url }. The document may be framed by the phone app's origins, and only this one
// (`framedBy`). 401 without a key or a session; 404 for a project the person can't open or a page it doesn't
// have; 503 when there is no canvas host (`OPENLEN_LIENZO_ORIGEN=0`, no secret): the app falls back to the share
// link. Seeing is enough, like the web canvas: owner and members.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  if (lienzoApagado()) return json({ error: "apagado" }, 503);
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as { projectId?: unknown; page?: unknown } | null;
  if (!body || typeof body.projectId !== "string") return json({ error: "invalid_body" }, 400);

  const access = await accesoAlProyecto(body.projectId, userId);
  if (!access) return json({ error: "no_encontrado" }, 404);
  const opened = await openCanvasDocument({
    projectId: body.projectId,
    ownerId: access.duenoId,
    personId: userId,
    page: typeof body.page === "string" && body.page.length > 0 ? body.page : null,
    html: null,
    requestHost: req.headers.get("host"),
    framedBy: ORIGENES_DE_LA_APP,
  });
  return opened.ok ? json({ url: opened.url }, 200) : json({ error: opened.error }, opened.status);
});

export const OPTIONS = respuestaPrevia;
