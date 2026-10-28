// A file the person uploads into the project's folder (spec local 2026-10-28-ficheros-al-nivel-de-claude-code,
// §6): dropped on the Code lens, or the image modal. Its bytes become what `projectFiles` stores —the text, or
// a blob pointer— and that goes in by the editor's own path (`operarAMano` / `guardarAMano`): the same guards,
// the same version per change, as a file created or edited by hand.

import { cargarFicherosDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import { guardarAMano } from "@/lib/agent/terminal/editar-a-mano";
import { operarAMano } from "@/lib/agent/terminal/operar-a-mano";
import { realDeps, type AgentSession } from "@/lib/agent/tools";

import { toStoredContent } from "./blob";
import { MAX_FILE_BYTES } from "./limits";

export type UploadResult = { readonly ok: true; readonly ruta: string } | { readonly ok: false; readonly motivo: string };

export const tooLarge = (ruta: string, size: number) =>
  `File too large: ${ruta} is ${(size / 1024 / 1024).toFixed(1)} MB, the maximum is ${MAX_FILE_BYTES / 1024 / 1024} MB.`;

export async function uploadProjectFile(p: {
  readonly projectId: string;
  /** Whose project it is: the files are saved with the owner's id (lib/projects/acceso.ts). */
  readonly ownerId: string;
  /** Who uploads, if not the owner. */
  readonly personId?: string;
  readonly ruta: string;
  readonly bytes: Uint8Array;
}): Promise<UploadResult> {
  if (p.bytes.byteLength > MAX_FILE_BYTES) return { ok: false, motivo: tooLarge(p.ruta, p.bytes.byteLength) };
  const contenido = await toStoredContent(p.bytes);
  const sesion: AgentSession = {
    projectId: p.projectId,
    userId: p.ownerId,
    ...(p.personId && p.personId !== p.ownerId ? { personId: p.personId } : {}),
    autor: "usuario",
    desde: "editor",
    page: null,
    ownerEmail: null,
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
    busquedasVaciasSeguidas: 0,
  };
  const ahora = await cargarFicherosDeLaTerminal(sesion, realDeps());
  if (Object.hasOwn(ahora, p.ruta)) {
    const g = await guardarAMano(p.projectId, p.ownerId, p.ruta, contenido, ahora[p.ruta]!, undefined, p.personId);
    if (g.ok) return { ok: true, ruta: p.ruta };
    return { ok: false, motivo: g.motivo === "rechazado" ? g.detalle : g.motivo === "cambio" ? `${p.ruta} changed while it was uploading.` : `${p.ruta} is gone.` };
  }
  const r = await operarAMano(p.projectId, p.ownerId, { tipo: "crear", ruta: p.ruta, contenido }, undefined, p.personId);
  if (r.ok) return { ok: true, ruta: p.ruta };
  if (r.motivo === "rechazado") return { ok: false, motivo: r.detalle };
  if (r.motivo === "existe") return { ok: false, motivo: `${p.ruta} already exists as a folder.` };
  if (r.motivo === "pagina") return { ok: false, motivo: `${p.ruta} is a page.` };
  return { ok: false, motivo: `${p.ruta} could not be saved.` };
}
