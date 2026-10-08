/**
 * CREAR, BORRAR Y RENOMBRAR A MANO, desde el explorador de la lente «Código»
 * (como el de VS Code: «Nuevo archivo», «Nueva carpeta», F2 y Supr).
 *
 * Va por el MISMO camino que tu terminal y que el editor (`editar-a-mano.ts`):
 * `guardarLoDeLaTerminal` con `autor: "usuario"` y `desde: "editor"`, así que
 * valen sus guardas —el manual y `/.openlen` son de sólo lectura, una página
 * pasa por su puerta, en una app no se crean páginas— y cada cambio queda como
 * versión a tu nombre («Code editor: …»), que es como Len sabe que no fue él.
 *
 * LO QUE NO HACE, y lo dice:
 *   · borrar una PÁGINA: eso es `DELETE /api/projects/[id]/pages/[slug]`, el de
 *     siempre, que también limpia su configuración de formularios. El cliente
 *     lo llama aparte (`motivo: "pagina"`);
 *   · renombrar una página o mover un fichero a una ruta de página: una página
 *     tiene su dirección publicada y sus enlaces, y moverla por debajo los
 *     rompería sin que nadie se entere.
 *
 * Una carpeta no existe por sí sola (la carpeta son sus ficheros, como en git):
 * renombrar o borrar una carpeta es hacerlo con cada fichero que tiene dentro.
 */
import "server-only";

import { realDeps, type AgentDeps, type AgentSession } from "@/lib/agent/tools";
import { cargarFicherosDeLaTerminal, guardarLoDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import { paginaDeRuta } from "@/lib/agent/ficheros/sitio";
import type { CambioDeLaTerminal } from "@/lib/agent/terminal/ficheros";

export type OperacionAMano =
  | { readonly tipo: "crear"; readonly ruta: string; readonly contenido?: string }
  /** Un fichero, o una carpeta con todo lo que tiene dentro. */
  | { readonly tipo: "borrar"; readonly ruta: string }
  /** Un fichero o una carpeta, a otra ruta. */
  | { readonly tipo: "renombrar"; readonly de: string; readonly a: string };

export type ResultadoAMano =
  | { readonly ok: true; readonly rutas: readonly string[] }
  | { readonly ok: false; readonly motivo: "existe"; readonly rutas: readonly string[] }
  | { readonly ok: false; readonly motivo: "no_existe" }
  /** Hay páginas: se borran con su propia ruta, y no se renombran. */
  | { readonly ok: false; readonly motivo: "pagina"; readonly rutas: readonly string[] }
  | { readonly ok: false; readonly motivo: "rechazado"; readonly detalle: string };

/** Los ficheros de `ruta`: el fichero mismo, o todo lo que cuelga de la carpeta. */
export function ficherosDe(ruta: string, todos: readonly string[]): string[] {
  const base = ruta.replace(/\/+$/, "");
  return todos.filter((r) => r === base || r.startsWith(`${base}/`)).sort();
}

/** Una página recién creada a mano: un documento mínimo, con el idioma de la portada. */
export function paginaVacia(ruta: string, portada: string | undefined): string {
  const lang = (portada && /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(portada)?.[1]) || "es";
  const slug = paginaDeRuta(ruta)?.page ?? "";
  const titulo = slug ? slug.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Inicio";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
</head>
<body>
</body>
</html>
`;
}

function sesionDelEditor(projectId: string, userId: string): AgentSession {
  return {
    projectId,
    userId,
    autor: "usuario",
    desde: "editor",
    page: null,
    ownerEmail: null,
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
    busquedasVaciasSeguidas: 0,
  };
}

export async function operarAMano(
  projectId: string,
  userId: string,
  op: OperacionAMano,
  deps: AgentDeps = realDeps(),
): Promise<ResultadoAMano> {
  const sesion = sesionDelEditor(projectId, userId);
  const ahora = await cargarFicherosDeLaTerminal(sesion, deps);
  const todas = Object.keys(ahora);
  const guardar = (cambios: CambioDeLaTerminal[]) => guardarLoDeLaTerminal(sesion, deps, cambios, ahora);

  if (op.tipo === "crear") {
    if (Object.hasOwn(ahora, op.ruta)) return { ok: false, motivo: "existe", rutas: [op.ruta] };
    // Una ruta que ya es carpeta (`/js` con `/js/app.js` dentro) no puede ser un fichero.
    if (todas.some((r) => r.startsWith(`${op.ruta}/`))) return { ok: false, motivo: "existe", rutas: [op.ruta] };
    const contenido = op.contenido ?? (paginaDeRuta(op.ruta) ? paginaVacia(op.ruta, ahora["/index.html"]) : "");
    const g = await guardar([{ tipo: "escrito", ruta: op.ruta, contenido, crea: true }]);
    if (g.rechazado) return { ok: false, motivo: "rechazado", detalle: g.notas.join("\n") };
    return { ok: true, rutas: [op.ruta] };
  }

  if (op.tipo === "borrar") {
    const rutas = ficherosDe(op.ruta, todas);
    if (rutas.length === 0) return { ok: false, motivo: "no_existe" };
    const paginas = rutas.filter((r) => paginaDeRuta(r));
    const resto = rutas.filter((r) => !paginaDeRuta(r));
    // Lo que no es página se borra aquí; las páginas, con su ruta de siempre.
    if (resto.length > 0) {
      const g = await guardar(resto.map((ruta) => ({ tipo: "borrado" as const, ruta })));
      if (g.rechazado) return { ok: false, motivo: "rechazado", detalle: g.notas.join("\n") };
    }
    if (paginas.length > 0) return { ok: false, motivo: "pagina", rutas: paginas };
    return { ok: true, rutas };
  }

  // RENOMBRAR: cada fichero a su ruta nueva y, sólo si todos se guardaron, fuera los viejos.
  const de = op.de.replace(/\/+$/, "");
  const a = op.a.replace(/\/+$/, "");
  const rutas = ficherosDe(de, todas);
  if (rutas.length === 0) return { ok: false, motivo: "no_existe" };
  if (a === de) return { ok: true, rutas: [] };
  if (a.startsWith(`${de}/`)) return { ok: false, motivo: "rechazado", detalle: `${a} is inside ${de}.` };
  const destino = (r: string) => a + r.slice(de.length);
  const conPagina = rutas.filter((r) => paginaDeRuta(r) || paginaDeRuta(destino(r)));
  if (conPagina.length > 0) return { ok: false, motivo: "pagina", rutas: conPagina };
  const ocupadas = rutas.map(destino).filter((r) => Object.hasOwn(ahora, r));
  if (ocupadas.length > 0) return { ok: false, motivo: "existe", rutas: ocupadas };
  const escritos = await guardar(rutas.map((r) => ({ tipo: "escrito" as const, ruta: destino(r), contenido: ahora[r]!, crea: true })));
  if (escritos.rechazado) {
    // Los que sí se crearon se quitan: un renombrado a medias deja dos copias.
    const creados = rutas.map(destino).filter((r) => escritos.enLaTerminal[r] != null);
    if (creados.length > 0) {
      const tras = await cargarFicherosDeLaTerminal(sesion, deps);
      await guardarLoDeLaTerminal(sesion, deps, creados.map((ruta) => ({ tipo: "borrado" as const, ruta })), tras);
    }
    return { ok: false, motivo: "rechazado", detalle: escritos.notas.join("\n") };
  }
  const tras = await cargarFicherosDeLaTerminal(sesion, deps);
  const borrados = await guardarLoDeLaTerminal(sesion, deps, rutas.map((ruta) => ({ tipo: "borrado" as const, ruta })), tras);
  if (borrados.rechazado) return { ok: false, motivo: "rechazado", detalle: borrados.notas.join("\n") };
  return { ok: true, rutas: rutas.map(destino) };
}
