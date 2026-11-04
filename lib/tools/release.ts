// A TOOL'S INSTALLED RELEASE, BUILT IN MEMORY (spec local 2026-11-04-herramientas-hechas-por-len, §4.2): the same
// production bundle a published app gets (`bundleApp`, invariant 6: the compiler is the only door, and a source
// that doesn't compile refuses the install), the shell through the same editor-marker gate as `publishToDir`
// (invariant 4), and what isn't a source as it is (`ficherosDeLaApp`). It skips the site bake on purpose: that
// writes into the public subdomain's folder and adds visitors' analytics, and a tool is private — its shell keeps
// the Tailwind CDN at runtime, as the canvas does. Nothing touches the disk.
import { createHash } from "node:crypto";

import type { AppBundle } from "@/lib/apps/bundler/bundle-app";
import { AppNoCompilaError } from "@/lib/apps/compilador";
import { BUNDLER_DID_NOT_ANSWER, ficherosDeLaApp } from "@/lib/apps/servir";
import { contentTypeFor, isCompileInputPath } from "@/lib/agent/ficheros/folder";
import type { AppDeProyecto } from "@/lib/projects/types";

import type { ToolReleaseFile } from "./types";

export interface ReleaseDeps {
  bundle(args: { carpeta: Record<string, string>; app: AppDeProyecto; entorno: Record<string, string>; modo: "produccion" }): Promise<AppBundle | null>;
  /** The shell without editor op-ids, or null when it carries the reserved `data-slot-path` marker. */
  gate(html: string): string | null;
}

async function realDeps(): Promise<ReleaseDeps> {
  const [{ bundleApp }, { gateReservedMarker, stripOpIds }] = await Promise.all([
    import("@/lib/apps/bundler/bundle-app"),
    import("@/lib/html-engine"),
  ]);
  return { bundle: (a) => bundleApp(a), gate: (html) => gateReservedMarker(stripOpIds(html)).html };
}

/** sha256 over every path and content, in path order: the same release twice is one row. */
function shaOf(files: Readonly<Record<string, ToolReleaseFile>>): string {
  const h = createHash("sha256");
  for (const path of Object.keys(files).sort()) h.update(`${path}\0${files[path]!.content}\0`);
  return h.digest("hex");
}

export async function buildToolRelease(
  p: {
    readonly html: string;
    readonly files: Readonly<Record<string, string>>;
    readonly app: AppDeProyecto;
    readonly entorno: Record<string, string>;
    /** The manifest's icon: always in the release, so the tools list can show it. */
    readonly iconPath: string;
  },
  deps?: ReleaseDeps,
): Promise<{ sha: string; files: Record<string, ToolReleaseFile> }> {
  const d = deps ?? (await realDeps());
  const shell = d.gate(p.html);
  if (shell === null) throw new Error("buildToolRelease: refusing a shell containing data-slot-path (editor mode leaked into install)");

  const carpeta = Object.fromEntries(Object.entries(p.files).filter(([path]) => isCompileInputPath(path)));
  if (!Object.hasOwn(carpeta, p.app.entrada)) {
    throw new AppNoCompilaError([{ ruta: p.app.entrada, linea: null, columna: null, mensaje: "the app's entry module does not exist" }]);
  }
  const paquete = await d.bundle({ carpeta, app: p.app, entorno: p.entorno, modo: "produccion" });
  if (!paquete) throw new Error(`buildToolRelease: ${BUNDLER_DID_NOT_ANSWER}`);
  if (!paquete.ok) throw new AppNoCompilaError(paquete.errores);

  const served = ficherosDeLaApp(carpeta, p.app, paquete.js);
  if (p.files[p.iconPath] !== undefined) served[p.iconPath] = p.files[p.iconPath]!;
  const files: Record<string, ToolReleaseFile> = { "/index.html": { content: shell, contentType: "text/html; charset=utf-8" } };
  for (const [path, content] of Object.entries(served)) {
    files[path] = { content, contentType: path === p.app.entrada ? "text/javascript; charset=utf-8" : contentTypeFor(path) };
  }
  return { sha: shaOf(files), files };
}
