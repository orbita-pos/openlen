// OPENING A CANVAS DOCUMENT — what POST /api/lienzo does once it knows who asks and that they may see the
// project, shared with the phone app's preview (POST /api/movil/canvas).
//
// The document is kept in memory (`almacen.ts`) and served on the project's `lienzo-<label>` host by
// /api/lienzo/site, where an app runs through the compiler, as it does in the web workspace (CLAUDE.md,
// invariant 6). The workspace sends the document it has on screen; the phone shows what is saved.

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { entornoPublicoDeLaApp } from "@/lib/apps/entorno";
import { validatePageSlug } from "@/lib/projects/site-pages";
import { guardarDocumento } from "./almacen";
import { documentoDeVista } from "./documento";
import { urlDelDocumento } from "./host";

export type OpenDocumentResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly status: 404; readonly error: "no_encontrado" }
  | { readonly ok: false; readonly status: 503; readonly error: "sin_host" };

export async function openCanvasDocument(input: {
  readonly projectId: string;
  /** The project's owner (`lib/projects/acceso.ts`): the row is read as theirs. */
  readonly ownerId: string;
  /** Who opens it: the document counts against their own cap in the store. */
  readonly personId: string;
  /** A site page's slug, or null for the home page. */
  readonly page: string | null;
  /** The document to show; null = what is saved. */
  readonly html: string | null;
  /** The request's Host: in development only its port is used. */
  readonly requestHost: string | null;
  /** Origins besides the workspace that may frame this document. */
  readonly framedBy?: readonly string[];
}): Promise<OpenDocumentResult> {
  const [row] = await db
    .select({
      data: schema.projects.data,
      title: schema.projects.title,
      subdomain: schema.projects.subdomain,
      logoUrl: schema.projects.logoUrl,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.userId, input.ownerId)))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: "no_encontrado" };

  let page: string | null = null;
  if (input.page) {
    const check = validatePageSlug(input.page);
    if (!check.ok || !row.data?.pages?.[check.slug]) return { ok: false, status: 404, error: "no_encontrado" };
    page = check.slug;
  }

  // With nowhere to serve it, nothing is baked or stored: it says so. The URL is built from the REAL id, so the
  // pure function checks first, before any work is spent, and the final result is checked again.
  const build = (docId: string) =>
    urlDelDocumento({ projectId: input.projectId, docId, pagina: page, hostDeLaPeticion: input.requestHost });
  if (build("check") === null) return { ok: false, status: 503, error: "sin_host" };

  // A WEB APP (local spec 2026-10-07-apps): the store remembers the app and its `import.meta.env`, which is what
  // /api/lienzo/site needs to bundle its modules. The draft's, never production's.
  const app = row.data?.app ?? null;
  const env = app ? await entornoPublicoDeLaApp(input.projectId, "draft") : undefined;
  const saved = page ? (row.data?.pages?.[page]?.html ?? "") : (row.data?.html ?? "");
  const html = documentoDeVista(input.html ?? saved, {
    projectId: input.projectId,
    title: row.title ?? null,
    sub: row.subdomain ?? null,
    pagina: page,
    settings: row.data?.settings,
    logoUrl: row.logoUrl ?? null,
    app,
  });
  const docId = guardarDocumento({
    html,
    projectId: input.projectId,
    userId: input.personId,
    pagina: page,
    app,
    ...(env ? { entorno: env } : {}),
    ...(input.framedBy?.length ? { framedBy: input.framedBy } : {}),
  });
  const url = build(docId);
  // ⚠️ THIS `null` CANNOT HAPPEN, and is left on purpose. `urlDelDocumento` depends only on the projectId and the
  // environment, not on the docId, so if the check above passed this one does too: it is defense in depth against
  // a future change that makes the URL depend on the id, not a live branch.
  return url === null ? { ok: false, status: 503, error: "sin_host" } : { ok: true, url };
}
