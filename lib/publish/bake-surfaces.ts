// Qué horneados existen SÓLO al publicar, y por qué.
//
// EL PROBLEMA QUE VIGILA. Un proyecto se pinta de tres maneras: el taller
// (inyectores de cliente sobre el iframe), el enlace de vista previa
// `/p/[id]` (`preview-bake.ts`) y la página publicada (`publishToDir`). Las
// tres tienen que diferir en algo —el taller es EDITABLE, no puede llevar la
// CSP sellada porque bloquearía a sus propios inyectores— pero hoy difieren
// por ACCIDENTE: añades un horneado al publicador y, sin que nadie decida
// nada, no existe en la vista previa. El valor por omisión es el silencio.
//
// De ese hueco salieron los dos peores fallos del 2026-08-24: el JavaScript
// del modelo que se veía muerto en el taller y estaba vivo en la publicada, y
// los correos que se veían perfectos en la vista previa y llegaban rotos al
// visitante. Ninguno era un fallo de la página. Los dos eran fallos del
// INSTRUMENTO con el que se mira la página, que es peor: no producen un error,
// producen que no encuentres los errores.
//
// Esto NO cierra el hueco — para eso haría falta una sola lista ordenada de
// horneados que los dos llamadores recorran. Lo que hace es volverlo RUIDOSO:
// el que añada el noveno tendrá que escribir aquí por qué, o la prueba lo para.
//
// `bake-surfaces.test.ts` lee los dos ficheros y comprueba que esta lista
// coincide EXACTAMENTE con la diferencia real. Sobra una entrada o falta una,
// y falla.

/** Horneado → por qué no está en la vista previa. */
export const PUBLISH_ONLY_BAKES: Readonly<Record<string, string>> = {
  // ── Deliberados: no pueden correr en una vista previa ────────────────────
  bakeGoogleFonts:
    "descarga las fuentes al disco del release. Toca la red; la vista previa " +
    "usa el CDN y se ve igual.",
  bakeResponsiveImages:
    "genera variantes de imagen en disco. Toca la red y el sistema de " +
    "ficheros; se ve la misma imagen, con otros bytes.",
  bakeMediaPreconnect:
    "sólo añade <link rel=preconnect>. No cambia lo que se ve, sólo cuándo " +
    "llega.",

  // ── Huecos de verdad: la vista previa enseña algo distinto ─────────
  bakeMotion:
    "🟡 HUECO PARCIAL. El taller lo simula con su propio inyector " +
    "(data-openlen-motion-preview); el enlace /p/[id] no lo tiene.",
  bakeMusic:
    "🟡 HUECO PARCIAL. Igual que el movimiento: simulado en el taller, " +
    "ausente en /p/[id].",
  bake3dScene:
    "🟡 HUECO. Inyecta la escena y su runtime; la vista previa enseña el " +
    "hueco. Escribe ficheros en el release, así que moverlo no es gratis.",

  // CUATRO ENTRADAS SE FUERON el 2026-08-26 con su horneado: carrusel, vídeo,
  // mapas y conductas. Los cuatro existían porque el JavaScript estaba
  // prohibido —los de vídeo y mapas devolvían el `<iframe>` que el saneador
  // acababa de quitar— y ninguno tenía interruptor en la interfaz, así que
  // retirarlos no deja nada mudo. Ahora lo escribe el modelo, va DENTRO del
  // documento, y las tres superficies enseñan lo mismo sin sincronizar nada.
  //
  // Los tres que quedan arriba SÍ tienen control en la interfaz. Se van cuando
  // se vaya su UI, en la misma pasada: quitarles el horneado antes dejaría al
  // usuario eligiendo un preset que no le hace nada a la página publicada.
};
