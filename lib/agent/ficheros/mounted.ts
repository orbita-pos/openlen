// A PROJECT'S FILES UNDER A FOLDER (spec local 2026-11-06-asistente-propio, §8, phase 4B): as Claude Code reads an
// added working directory, the person's own assistant reads each project she serves under
// ~/.assistant/projects/<id>/. The view is the project's own (what Read sees there), every path with the folder in
// front, so Read, Glob and Grep run on it unchanged and show it by its absolute path.
//
// Pure.
import type { SitioBuscable } from "./grep";

/** `prefix` is resolved, with no trailing slash (`/home/user/.assistant/projects/p2`). */
export function mountedSite(prefix: string, site: SitioBuscable): SitioBuscable {
  const inside = `${prefix}/`;
  return {
    ficheros: site.ficheros.map((f) => `${prefix}${f}`),
    contenido: (ruta) => (ruta.startsWith(inside) ? site.contenido(ruta.slice(prefix.length)) : null),
    // What she wrote in this turn is her home's.
    recientes: [],
  };
}
