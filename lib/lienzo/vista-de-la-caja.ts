// THE DRAFT, AS LEN'S BOX SEES IT (plan local 2026-10-21-playwright-in-the-box).
//
// The canvas answers the owner's open editor: a document in memory, `?__lienzo=<docId>`. Tests in the box
// go anywhere (`page.goto('/menu')`) with no editor open, so with the box's marker the canvas host serves
// the SAVED draft: each page at its published path, built as Len's eyes build it (`vistaParaMedir` →
// `documentoDeVista`: no forms wired, no analytics), the folder, and the sources compiled as the canvas
// compiles them (`carpetaServida`). Anything else, the canvas's one 404.

import "server-only";

import { contentTypeFor, isCompileInputPath } from "@/lib/agent/ficheros/folder";
import { esFuenteCompilable } from "@/lib/apps/compilador";
import { PAGE_PERMISSIONS_POLICY } from "@/lib/publish/permissions-policy";
import { isBlobPointer } from "@/lib/files/blob-pointer";

import { carpetaServida, documentoDeVista, vistaParaMedir } from "./documento";
import { frameAncestors } from "./host";
import { loadSavedProject } from "./proyecto-guardado";

/** `/`, `/index.html` → the home (null); `/menu`, `/menu/`, `/menu/index.html` → "menu"; else undefined. */
function pageOf(ruta: string): string | null | undefined {
  if (ruta === "/" || ruta === "/index.html") return null;
  const m = /^\/([A-Za-z0-9._-]+)(?:\/(?:index\.html)?)?$/.exec(ruta);
  return m ? m[1]! : undefined;
}

const html = (body: string) =>
  new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": `frame-ancestors ${frameAncestors()}`,
      "permissions-policy": PAGE_PERMISSIONS_POLICY,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });

/** The box's answer for `ruta` of `projectId`, or `null` (the caller's 404). */
export async function servirVistaDeLaCaja(projectId: string, ruta: string): Promise<Response | null> {
  const project = await loadSavedProject(projectId);
  if (!project?.data) return null;
  const app = project.data.app ?? null;

  // The folder and the sources, as the canvas serves them (a page's .tsx compiled, an app's bundle).
  const { listProjectFiles } = await import("@/lib/backend/files");
  const all = await listProjectFiles(projectId).catch(() => null);
  const inputs = Object.fromEntries(Object.entries(all ?? {}).filter(([r]) => isCompileInputPath(r)));
  if (ruta !== "/" && Object.keys(inputs).length > 0) {
    const entorno = app ? await (await import("@/lib/apps/entorno")).entornoPublicoDeLaApp(projectId, "draft").catch(() => undefined) : undefined;
    const served = (await carpetaServida(inputs, app, entorno)).files;
    const guardado = served[ruta];
    if (guardado !== undefined) {
      // Un binario (spec local 2026-10-28): sus bytes, nunca el texto de su puntero.
      const body = isBlobPointer(guardado) ? new Uint8Array(await (await import("@/lib/files/blob")).getBlob(guardado)) : guardado;
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": esFuenteCompilable(ruta, Boolean(app)) ? "text/javascript; charset=utf-8" : contentTypeFor(ruta),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        },
      });
    }
  }

  const page = pageOf(ruta);
  if (page === undefined) return null;
  const source = page === null ? project.data.html : project.data.pages?.[page]?.html;
  if (typeof source !== "string") return null;
  const fila = { title: project.title, subdomain: project.subdomain, data: { settings: project.data.settings, app } };
  return html(documentoDeVista(source, vistaParaMedir(projectId, fila, page)));
}
