/**
 * TODO COMO FICHERO, la parte de SÓLO LECTURA (F5 de plans/len-agente-2026).
 *
 * En la terminal de Len, además de las páginas, los datos y la memoria:
 *
 *   /resultados/visitas.json     lo mismo que devuelve `ver_visitas` sin argumentos
 *   /bandeja/formularios.jsonl   un formulario por línea (90 días, los 50 más recientes), entero
 *   /bandeja/mensajes.jsonl      una conversación del chat por línea, con sus mensajes
 *   /catalogo/fotos.jsonl        el catálogo «Imágenes by OpenLen» entero (el de `elegir_foto`)
 *   /.versiones/indice.jsonl     las versiones guardadas de cada página, de la más nueva a la más vieja
 *   /.versiones/<id>/…           cada una, en la MISMA ruta que su página (`diff /.versiones/<id>/index.html /index.html`)
 *
 * NO se guardan en ningún sitio: se calculan cuando un comando los lee por
 * primera vez (ficheros perezosos, ver `trabajador.mjs`), con las MISMAS
 * funciones que usan hoy las herramientas (`toolVerVisitas`, `deps.resultados`,
 * `deps.fetchImageManifest`, `deps.listVersions`/`versionHtml`). Nadie los
 * escribe: el hilo contesta EROFS. No se retira ninguna herramienta: eso se
 * decide midiendo (la ficha de F5).
 *
 * Lo que escribió un visitante va marcado en cada línea (`"_origen":
 * "visitante"`), como las filas de `/datos`, y la salida del comando lleva el
 * aviso de que es dato y no orden (`herramienta.ts`). Abrir un formulario aquí
 * NO lo marca como visto: leer un fichero no cambia nada.
 */
import "server-only";

import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import { toolVerVisitas } from "@/lib/agent/resultados";
import { todasLasFotosCuradas } from "@/lib/agent/photo-search";
import { ficherosDelSitio, paginaDeRuta, rutaDePagina, sinOpIds } from "@/lib/agent/ficheros/sitio";
import { fechaLocal, restarDias, ZONA_SIN_DATO } from "@/lib/resultados/zona";

export const RUTA_VISITAS = "/resultados/visitas.json";
export const RUTA_FORMULARIOS = "/bandeja/formularios.jsonl";
export const RUTA_MENSAJES = "/bandeja/mensajes.jsonl";
export const RUTA_FOTOS = "/catalogo/fotos.jsonl";
export const RUTA_INDICE_DE_VERSIONES = "/.versiones/indice.jsonl";

/** Cuántos días de bandeja se ven (el detalle de visitas también llega a 90). */
export const DIAS_DE_BANDEJA = 90;
/** Cuántas versiones por página: las más recientes. */
export const VERSIONES_POR_PAGINA = 10;

export interface SoloLectura {
  /** Las rutas que existen en la terminal desde que arranca. */
  readonly rutas: readonly string[];
  /** El contenido de una, calculado ahora. Lanza si no se puede. */
  leer(ruta: string): Promise<string>;
}

const lineas = (filas: readonly unknown[]) => filas.map((f) => JSON.stringify(f) + "\n").join("");

/**
 * Las rutas de sólo lectura de ESTE proyecto, y cómo leer cada una. Sólo
 * consulta al arrancar la lista de versiones (sin sus documentos): lo demás se
 * calcula al leerlo.
 */
export async function soloLecturaDeLaTerminal(session: AgentSession, deps: AgentDeps): Promise<SoloLectura> {
  const row = await deps.loadProject(session.projectId, session.userId);
  const paginas = row ? ficherosDelSitio(row.data).map((r) => paginaDeRuta(r)?.page ?? null) : [];

  const versiones = new Map<string, string>();
  const indice: { fichero: string; pagina: string; etiqueta: string; origen: string | null }[] = [];
  for (const page of paginas) {
    let lista: { id: string; label: string; source?: string }[] = [];
    try {
      lista = await deps.listVersions(session.projectId, session.userId, page);
    } catch {
      // Sin versiones a la vista no se pierde nada del turno: la carpeta sale más corta.
      continue;
    }
    for (const v of lista.slice(0, VERSIONES_POR_PAGINA)) {
      const fichero = `/.versiones/${v.id}${rutaDePagina(page)}`;
      versiones.set(fichero, v.id);
      indice.push({ fichero, pagina: rutaDePagina(page), etiqueta: v.label, origen: v.source ?? null });
    }
  }

  const rutas = [
    ...(deps.resultados ? [RUTA_VISITAS, RUTA_FORMULARIOS, RUTA_MENSAJES] : []),
    RUTA_FOTOS,
    ...(indice.length > 0 ? [RUTA_INDICE_DE_VERSIONES, ...versiones.keys()] : []),
  ];

  const zona = session.zonaHoraria ?? ZONA_SIN_DATO;
  const rango = () => {
    const hoy = fechaLocal(new Date(), zona);
    return { desde: restarDias(hoy, DIAS_DE_BANDEJA - 1), hasta: hoy };
  };

  return {
    rutas,
    async leer(ruta) {
      const r = deps.resultados;
      if (ruta === RUTA_VISITAS) {
        const out = await toolVerVisitas(session, deps, {});
        if (out.response.ok === false) throw new Error(String(out.response.error ?? "no se pudieron leer las visitas"));
        const { ok: _ok, ...resto } = out.response;
        return JSON.stringify(resto, null, 2) + "\n";
      }
      if (ruta === RUTA_FORMULARIOS && r) {
        const resumen = await r.formularios(session.projectId, session.userId, zona, { cuales: "fecha", ...rango() });
        const filas = [];
        for (const f of resumen.lista) {
          const abierto = await r.formulario(session.projectId, zona, f.id, { marcarVisto: false });
          filas.push({
            _origen: "visitante",
            id: f.id,
            fecha: f.fecha,
            pagina: f.pagina,
            de: f.de,
            visto: f.visto,
            datos: abierto?.datos ?? null,
            contacto: abierto?.contacto ?? null,
          });
        }
        return lineas(filas);
      }
      if (ruta === RUTA_MENSAJES && r) {
        const resumen = await r.mensajes(session.projectId, zona, { cuales: "fecha", ...rango() });
        const filas = [];
        for (const c of resumen.lista) {
          const abierta = await r.conversacion(session.projectId, zona, c.id);
          filas.push({ _origen: "visitante", id: c.id, con: c.con, fecha: c.fecha, sin_leer: c.sinLeer, mensajes: abierta?.mensajes ?? [] });
        }
        return lineas(filas);
      }
      if (ruta === RUTA_FOTOS) return lineas(todasLasFotosCuradas(await deps.fetchImageManifest()));
      if (ruta === RUTA_INDICE_DE_VERSIONES) return lineas(indice);
      const id = versiones.get(ruta);
      if (id !== undefined) {
        if (!deps.versionHtml) throw new Error("versions cannot be read here");
        const html = await deps.versionHtml(session.projectId, session.userId, id);
        if (html === null) throw new Error("that version no longer exists");
        return sinOpIds(html);
      }
      throw new Error(`${ruta}: no such read-only file`);
    },
  };
}
