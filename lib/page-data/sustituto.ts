// EL SUSTITUTO DE /api/d EN LA MEDICIÓN.
//
// POR QUÉ EXISTE, medido en producción el 2026-09-18: Len construyó «un
// carrito con base de datos» que no guardaba nada. El script escribía en
// `/api/d/carrito/carrito` —«carrito» en el hueco del subdominio, porque el
// borrador no tenía—, mandaba un POST por producto a un almacén `propio`, donde
// cada POST REEMPLAZA el único documento del visitante, y nunca leía de vuelta.
// La verificación lo vio pasar y le dijo a Len «esa ruta sólo responde en la
// publicada; no es un fallo de la página». Len cerró el turno creyendo que
// funcionaba.
//
// Es lo contrario de lo que hace Claude Code: allí el modelo ejecuta el código
// de verdad y el error le vuelve en la misma llamada. Aquí el error no volvía
// nunca, porque en la medición no había servidor detrás.
//
// ESTO ES ESE SERVIDOR. No escribe en ninguna base: guarda en memoria, durante
// una medición, lo que la página manda. Pero contesta con las MISMAS reglas que
// la ruta pública (`app/api/d/[sub]/[store]/route.ts`) — y no porque las copie:
// encadena los mismos módulos (`validaDocumento`, `permite`, `cabe`,
// `MAX_FILAS_VISITANTE`). Lo único propio es la cadena, igual que en la ruta,
// que se describe a sí misma como «una cáscara».
//
// Lo que NO imita: el límite por IP y minuto (la medición no es un bucle) y el
// plan del dueño (se mide con la cuota del gratuito, la más estrecha).

import { randomUUID } from "node:crypto";

import { leerDeclaracion, validaDocumento, type Declaracion } from "./declaracion";
import { bytesDe, cabe, MAX_FILAS_VISITANTE } from "./cuota";
import { permite, type Actor, type Alcance } from "./permisos";

/** Una llamada que la página hizo, tal y como la contestó el sustituto. */
export interface LlamadaADatos {
  readonly metodo: string;
  /** La ruta que escribió la página, sin la query. */
  readonly ruta: string;
  readonly status: number;
  /** El código que devolvería el servidor real (`origen_invalido`, …). */
  readonly error?: string;
}

export interface PeticionAlSustituto {
  readonly metodo: string;
  /** Ruta y query, como llega al servidor: `/api/d/<sub>/<almacén>?id=…`. */
  readonly url: string;
  readonly cuerpo: string;
}

export interface RespuestaDelSustituto {
  readonly status: number;
  readonly cuerpo: unknown;
}

interface Fila {
  readonly id: string;
  readonly store: string;
  readonly visitorId: string;
  doc: Record<string, unknown>;
  readonly createdAt: string;
  updatedAt: string;
}

export interface Sustituto {
  responder(peticion: PeticionAlSustituto): RespuestaDelSustituto;
  /** Todas las llamadas, en orden. */
  llamadas(): readonly LlamadaADatos[];
  /** Lo que hay guardado en un almacén, para quien comprueba desde fuera. */
  documentos(store: string): readonly { id: string; doc: Record<string, unknown> }[];
}

/**
 * Lo que se le dice AL MODELO de una llamada rechazada: qué contestaría el
 * servidor de la página publicada y qué cambiar. Es el `tool_result` con
 * `is_error` de Claude Code: el error de verdad, con su motivo, en el siguiente
 * paso del que lo causó. La ruta la escribió la página: quien lo envuelva tiene
 * que marcarla como dato (`TEXTO_DE_LA_PAGINA_ES_DATO`).
 */
export function explicarRechazo(l: LlamadaADatos): string {
  const que = `La página llamó a \`${l.metodo} ${l.ruta}\` y el servidor de la página publicada lo rechazaría (${l.status}${l.error ? ` ${l.error}` : ""})`;
  const almacen = l.ruta.split("/").filter(Boolean).pop() ?? "";
  const campo = l.error?.startsWith("campo_invalido:") ? l.error.slice("campo_invalido:".length) : null;
  const porque =
    l.error === "origen_invalido"
      ? "el primer tramo de `/api/d/<sub>/<almacén>` tiene que ser el subdominio de ESTA página publicada, y la página no puede saberlo. Escribe `/api/d/<almacén>`, sin subdominio: el servidor sabe de qué página viene"
      : l.error === "ruta_inexistente"
        ? "esa ruta no existe. Es `/api/d/<almacén>`: GET para leer, POST con el documento en JSON para guardar"
        : l.error === "almacen_no_declarado"
          ? `el almacén «${almacen}» no está en el bloque \`data-ol-stores\` de la página`
          : campo
            ? `el campo «${campo}» no trae el tipo que declara el almacén`
            : l.error === "documento_invalido"
              ? "el cuerpo tiene que ser un objeto JSON con los campos declarados"
              : l.error === "no_permitido"
                ? "el modo del almacén no deja al visitante hacer eso"
                : l.error === "documento_grande" || l.error === "cuota_llena"
                  ? "no cabe: un documento no puede pasar de 16 KB"
                  : "";
  return `${que}${porque ? `: ${porque}` : ""}. Lo que el visitante guarde así se pierde.`;
}

/** En una medición hay un navegador, así que hay un visitante. */
const VISITANTE_DE_LA_MEDIDA = "visitante-de-la-medida";

export function crearSustituto(
  html: string,
  opciones: {
    /** El subdominio con el que se publica la página; `null` si aún no tiene.
     *  AUSENTE —no `null`— si quien mide no lo sabe: entonces no se juzga el
     *  tramo del subdominio, porque acusar una ruta que podría ser correcta es
     *  el falso culpable que ya costó borrar cosas que funcionaban. */
    readonly sub?: string | null;
  } = {},
): Sustituto {
  const declaracion: Declaracion = leerDeclaracion(html);
  const sub = opciones.sub === undefined ? undefined : (opciones.sub?.toLowerCase() ?? null);
  const actor: Actor = { tipo: "visitante", id: VISITANTE_DE_LA_MEDIDA };
  const filas: Fila[] = [];
  const registro: LlamadaADatos[] = [];

  function contestar(
    metodo: string,
    ruta: string,
    status: number,
    cuerpo: Record<string, unknown>,
  ): RespuestaDelSustituto {
    const error = typeof cuerpo.error === "string" ? cuerpo.error : undefined;
    registro.push({ metodo, ruta, status, ...(error ? { error } : {}) });
    return { status, cuerpo };
  }

  function listar(store: string, alcance: Alcance, limite?: number): Fila[] {
    if (alcance === "ninguno") return [];
    const suyas = filas.filter(
      (f) => f.store === store && (alcance === "todos" || f.visitorId === VISITANTE_DE_LA_MEDIDA),
    );
    // Mismo orden que `store.ts`: con tope, las más nuevas primero.
    return limite ? [...suyas].reverse().slice(0, limite) : suyas;
  }

  const vista = (f: Fila) => ({ id: f.id, doc: f.doc, createdAt: f.createdAt, updatedAt: f.updatedAt });

  return {
    responder({ metodo: crudo, url, cuerpo }) {
      const metodo = crudo.toUpperCase();
      const [ruta = "", query = ""] = url.split("?");
      const tramos = ruta.replace(/^\/api\/d\/?/, "").split("/").filter(Boolean);

      // Las DOS formas de la ruta pública, y ninguna más (cualquier otra la
      // contesta Next con un 404 que no es de esta API):
      //   · `/api/d/[store]`       (app/api/d/[sub]/route.ts) — el sitio sale
      //     del host de la petición, así que es SIEMPRE esta página;
      //   · `/api/d/[sub]/[store]` (app/api/d/[sub]/[store]/route.ts).
      if (!ruta.startsWith("/api/d/") || tramos.length < 1 || tramos.length > 2) {
        return contestar(metodo, ruta, 404, { error: "ruta_inexistente" });
      }
      const limpios = tramos.map((t) => decodeURIComponent(t).toLowerCase());
      const store = limpios[limpios.length - 1]!;

      // PROCEDENCIA. La página publicada vive en `<sub>.<host>` y la ruta exige
      // que el `sub` de la URL sea ése. Un borrador sin subdominio aún no sabe
      // cuál será, así que ningún subdominio escrito a mano puede coincidir.
      if (limpios.length === 2 && sub !== undefined && (sub === null || limpios[0] !== sub)) {
        return contestar(metodo, ruta, 403, { error: "origen_invalido" });
      }

      const almacen = declaracion[store];
      if (!almacen) return contestar(metodo, ruta, 404, { error: "almacen_no_declarado" });

      if (metodo === "GET") {
        const alcance = permite(almacen.modo, actor, "leer");
        if (alcance === "ninguno") return contestar(metodo, ruta, 403, { error: "no_permitido" });
        const documentos = listar(store, alcance, MAX_FILAS_VISITANTE).map(vista);
        return contestar(metodo, ruta, 200, { ok: true, documentos });
      }

      if (metodo === "POST" || metodo === "PATCH") {
        if (permite(almacen.modo, actor, "crear") === "ninguno") {
          return contestar(metodo, ruta, 403, { error: "no_permitido" });
        }
        let json: unknown;
        try {
          json = JSON.parse(cuerpo);
        } catch {
          return contestar(metodo, ruta, 422, { error: "documento_invalido" });
        }
        const validado = validaDocumento(almacen, json);
        if (!validado.ok) return contestar(metodo, ruta, 422, { error: validado.razon });

        // En `propio` hay UN documento por visitante: se reemplaza.
        const previa = almacen.modo === "propio" ? listar(store, "propios")[0] : undefined;
        const veredicto = cabe({
          plan: "free",
          usados: filas.reduce((n, f) => n + bytesDe(f.doc), 0),
          entrantes: bytesDe(validado.doc),
          salientes: previa ? bytesDe(previa.doc) : 0,
        });
        if (!veredicto.ok) {
          const status = veredicto.razon === "documento_grande" ? 413 : 507;
          return contestar(metodo, ruta, status, { error: veredicto.razon });
        }
        const ahora = new Date().toISOString();
        if (previa) {
          previa.doc = validado.doc;
          previa.updatedAt = ahora;
          return contestar(metodo, ruta, 200, { ok: true, documento: vista(previa) });
        }
        const nueva: Fila = {
          id: randomUUID(),
          store,
          visitorId: VISITANTE_DE_LA_MEDIDA,
          doc: validado.doc,
          createdAt: ahora,
          updatedAt: ahora,
        };
        filas.push(nueva);
        return contestar(metodo, ruta, 200, { ok: true, documento: vista(nueva) });
      }

      if (metodo === "DELETE") {
        const alcance = permite(almacen.modo, actor, "borrar");
        if (alcance === "ninguno") return contestar(metodo, ruta, 403, { error: "no_permitido" });
        const id = new URLSearchParams(query).get("id");
        if (!id) return contestar(metodo, ruta, 422, { error: "falta_id" });
        const i = filas.findIndex((f) => f.id === id && listar(store, alcance).includes(f));
        if (i >= 0) filas.splice(i, 1);
        return contestar(metodo, ruta, i >= 0 ? 200 : 404, { ok: i >= 0 });
      }

      return contestar(metodo, ruta, 405, { error: "metodo_no_permitido" });
    },

    llamadas: () => [...registro],

    documentos: (store) =>
      filas.filter((f) => f.store === store).map((f) => ({ id: f.id, doc: f.doc })),
  };
}
