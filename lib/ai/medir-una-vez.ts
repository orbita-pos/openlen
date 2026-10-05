// UNA MEDIDA POR DOCUMENTO, NO POR LLAMADOR.
//
// Un turno del Agente que edita renderizaba DOS VECES el mismo documento: la
// medición que vuelve al modelo tras editar y la de los ojos al cerrar. +2,16 s
// en caliente (el arranque de Chromium ya se comparte por el pool del turno;
// esto es el render en sí).
//
// 🔴 LA CLAVE ES EL DOCUMENTO ENTERO, NO UN HASH. Es lo que hace que esto no
// pueda equivocarse de página: dos documentos que difieran en un byte son dos
// claves, y se renderizan los dos. Un hash abriría la puerta a devolver la
// medida de otra página por una colisión; aquí la comparación ES la identidad.
// El coste de memoria es el documento, que el llamador ya tiene en la mano.
//
// 🔴 VISTO EN UN LOG DE VERDAD, 2026-09-06. Hasta entonces esto sólo tenía la
// prueba del handler y la del documento; el ahorro nunca se había observado en
// un turno real, y un ahorro invisible es indistinguible de uno que no ocurre.
// Turno completo por `/api/agent` del dev server, proyecto real, navegador real:
//
//   [agent] deepseek-v4-pro-0813 — in 42205 (cached 33803, 80%) / out 99 / vueltas=2
//   [agent] 1 render(s) ahorrado(s) por documento ya medido
//
// Dos llamadores —la medición que vuelve al modelo y los ojos al cerrar—, un
// render. Que es justo lo que el motivo caducado decía que era imposible.
//
// LA CARPETA ENTRA EN LA CLAVE (pieza 9 de Len 2.5). El mismo documento con
// otro `js/app.js` es otra página: la clave es el documento más la carpeta
// entera, por la misma razón que arriba —la comparación es la identidad—, y la
// carpeta llega al medidor. Sin carpeta se le llama con el documento solo,
// como siempre.
//
// NO SE CACHEA EL FALLO. Una medida ausente se borra de la tabla para que el
// siguiente llamador lo intente de verdad — si no, un Chromium que tropieza una
// vez dejaría el turno entero sin medir, y el fusible del bucle contaría ecos
// en vez de intentos.

import type { OpcionesDelDocumento } from "@/lib/ai/origen-de-medida";

type Medidor<T> = (
  html: string,
  internals?: Record<string, never>,
  opts?: { carpeta?: OpcionesDelDocumento },
) => Promise<T | null>;

function claveDe(html: string, carpeta: OpcionesDelDocumento | undefined): string {
  if (!carpeta) return html;
  const files = Object.entries(carpeta.files ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${html}\u0000${JSON.stringify([carpeta.pagina ?? null, files])}`;
}

/**
 * Envuelve un medidor para que cada documento se mida UNA vez por la vida del
 * envoltorio (un request).
 *
 * Devuelve la MISMA promesa a los llamadores concurrentes: los ojos miden en
 * paralelo con la foto, así que dos llamadas a la vez sobre el mismo documento
 * son el caso normal, no el raro.
 */
export function medirUnaVezPorDocumento<T>(
  medir: Medidor<T>,
): {
  medir: Medidor<T>;
  /** Cuántas veces se devolvió una medida ya hecha. Para poder DECIR que esto
   *  acierta en producción en vez de suponerlo. */
  reusos: () => number;
  olvidar: () => void;
} {
  const enCurso = new Map<string, Promise<T | null>>();
  let reusos = 0;
  return {
    medir: (html, internals, opts) => {
      const carpeta = opts?.carpeta;
      const clave = claveDe(html, carpeta);
      const ya = enCurso.get(clave);
      if (ya) {
        reusos += 1;
        return ya;
      }
      const medida = carpeta ? medir(html, internals ?? {}, { carpeta }) : medir(html);
      enCurso.set(clave, medida);
      void medida.then(
        (v) => {
          if (v === null || v === undefined) enCurso.delete(clave);
        },
        () => enCurso.delete(clave),
      );
      return medida;
    },
    reusos: () => reusos,
    olvidar: () => enCurso.clear(),
  };
}
