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
// NO SE CACHEA EL FALLO. Una medida ausente se borra de la tabla para que el
// siguiente llamador lo intente de verdad — si no, un Chromium que tropieza una
// vez dejaría el turno entero sin medir, y el fusible del bucle contaría ecos
// en vez de intentos.

/**
 * Envuelve un medidor para que cada documento se mida UNA vez por la vida del
 * envoltorio (un request).
 *
 * Devuelve la MISMA promesa a los llamadores concurrentes: los ojos miden en
 * paralelo con la foto, así que dos llamadas a la vez sobre el mismo documento
 * son el caso normal, no el raro.
 */
export function medirUnaVezPorDocumento<T>(
  medir: (html: string) => Promise<T | null>,
): {
  medir: (html: string) => Promise<T | null>;
  /** Cuántas veces se devolvió una medida ya hecha. Para poder DECIR que esto
   *  acierta en producción en vez de suponerlo. */
  reusos: () => number;
  olvidar: () => void;
} {
  const enCurso = new Map<string, Promise<T | null>>();
  let reusos = 0;
  return {
    medir: (html: string) => {
      const ya = enCurso.get(html);
      if (ya) {
        reusos += 1;
        return ya;
      }
      const medida = medir(html);
      enCurso.set(html, medida);
      void medida.then(
        (v) => {
          if (v === null || v === undefined) enCurso.delete(html);
        },
        () => enCurso.delete(html),
      );
      return medida;
    },
    reusos: () => reusos,
    olvidar: () => enCurso.clear(),
  };
}
