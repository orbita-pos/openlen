// GET /api/projects/[id]/ab/[expId]/preview?variant=a|b — sandboxed preview HTML
// for the side-by-side Control A vs Variant B comparator modal.
import { eq } from "drizzle-orm";

import { getExperimentById } from "@/lib/ab/store";
import { copySources, ensurePublishedSources } from "@/lib/ab/worktree";
import { db, schema } from "@/lib/db";
import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_CSP = "sandbox allow-scripts allow-popups allow-forms";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; expId: string }> },
): Promise<Response> {
  // Web session only (review item 27): the comparator is the workspace's; no phone key.
  const userId = (await auth())?.user?.id;
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { id, expId } = await params;
  const acceso = await exigirAcceso(id, userId, "ver");
  if (acceso instanceof Response) return acceso;

  const exp = await getExperimentById(expId);
  if (!exp || exp.projectId !== id) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const variant = url.searchParams.get("variant") === "b" ? "b" : "a";

  let html = "";
  if (variant === "b") {
    // No copy left (the experiment ended and its worktree was cleaned): there is no Variant B to show — never Control A
    // under B's name (review item 29).
    const src = exp.copyProjectId ? await copySources(exp.copyProjectId).catch(() => null) : null;
    if (!src) return new Response("Not found", { status: 404 });
    html =
      exp.targetPath === "/"
        ? src.data.html
        : (src.data.pages?.[exp.targetPath.slice(1)]?.html ?? src.data.html);
  } else {
    const control = await ensurePublishedSources(id, acceso.duenoId).catch(() => null);
    if (control) {
      html =
        exp.targetPath === "/"
          ? control.data.html
          : (control.data.pages?.[exp.targetPath.slice(1)]?.html ?? control.data.html);
    } else {
      const [proj] = await db
        .select({ publishedHtml: schema.projects.publishedHtml, data: schema.projects.data })
        .from(schema.projects)
        .where(eq(schema.projects.id, id))
        .limit(1);
      html = proj?.publishedHtml || proj?.data?.html || "";
    }
  }

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": PREVIEW_CSP,
    },
  });
}
