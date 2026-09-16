// Qué transformaciones existen SÓLO al publicar, y por qué.
//
// EL PROBLEMA QUE VIGILA. Un proyecto se pinta de tres maneras: el LIENZO del
// taller (`lib/lienzo/documento.ts`, que desde la spec del 2026-09-15 es
// también lo que MIDE el medidor), el enlace de vista previa `/p/[id]`
// (`preview-bake.ts`) y la página publicada (`publishToDir`). Las tres tienen
// que diferir en algo —al medir, por ejemplo, los `data-op-id` no se quitan
// porque son la dirección de cada defecto— pero hoy difieren por ACCIDENTE:
// añades una transformación al publicador y, sin que nadie decida nada, no
// existe en las otras dos. El valor por omisión es el silencio.
//
// De ese hueco salieron los dos peores fallos del 2026-08-24: el JavaScript
// del modelo que se veía muerto en el taller y estaba vivo en la publicada, y
// los correos que se veían perfectos en la vista previa y llegaban rotos al
// visitante. Ninguno era un fallo de la página. Los dos eran fallos del
// INSTRUMENTO con el que se mira la página, que es peor: no producen un error,
// producen que no encuentres los errores.
//
// Esto NO cierra el hueco — para eso haría falta una sola lista ordenada que
// los tres llamadores recorran. Lo que hace es volverlo RUIDOSO: el que añada
// la siguiente tendrá que escribir aquí por qué, o la prueba lo para.
//
// 🔴 AMPLIADO EL 2026-09-15, Y ERA MÁS GRAVE DE LO QUE PARECÍA. El extractor
// de la prueba buscaba `bake[A-Z0-9]`, y al publicar una página pasa además
// por `wirePublishedForms`, `applyLiveData`, tres `inject*`, el sello y cinco
// `strip/optimize/absolutize/consolidate/annotate`. Ninguno se llama `bake*`:
// este fichero prometía vigilar las diferencias entre superficies y vigilaba
// un tercio de ellas — y fuera quedaban justo las que más duelen (los
// formularios, la analítica, los op-id que el medidor necesita).
//
// `bake-surfaces.test.ts` lee los TRES ficheros y comprueba que estas listas
// coinciden EXACTAMENTE con la diferencia real. Sobra una entrada o falta una,
// y falla.

/** Transformación → por qué NO corre fuera de la publicación. */
export const SOLO_AL_PUBLICAR: Readonly<Record<string, string>> = {
  // ── Tocan la red o el disco ──────────────────────────────────────────────
  bakeGoogleFonts:
    "descarga las fuentes al disco del release. Toca la red; las demás " +
    "superficies usan el CDN y se ve igual.",
  bakeResponsiveImages:
    "genera variantes de imagen en disco. Toca la red y el sistema de " +
    "ficheros; se ve la misma imagen, con otros bytes.",
  optimizeHtmlForProduction:
    "compila el Tailwind del CDN a una hoja en disco. Toca la red y el " +
    "sistema de ficheros; la página se ve igual y pesa otra cosa.",
  absolutizeSocialMeta:
    "resuelve og:image contra la URL pública y sube la tarjeta. Sin dominio " +
    "publicado no hay URL absoluta que escribir.",

  // ── Escribirían en nombre del dueño ──────────────────────────────────────
  wirePublishedForms:
    "apunta cada <form> a /api/f/<sub>. Fuera de la publicada, cada envío de " +
    "prueba sería un lead de verdad en la bandeja del dueño.",
  injectAnalyticsSnippet:
    "el latido que cuenta visitas. Fuera de la publicada contaría al dueño " +
    "mirando su propia página como si fuera tráfico.",
  applyLiveData:
    "sustituye las filas de datos vivos leídas de la base. Se ve lo último " +
    "guardado, que es justo lo que el dueño está editando.",

  // ── No cambian lo que se ve ──────────────────────────────────────────────
  bakeMediaPreconnect:
    "sólo añade <link rel=preconnect>. No cambia lo que se ve, sólo cuándo " +
    "llega.",
  injectTrackingStrip:
    "limpia utm_/fbclid de la barra de direcciones al cargar. No cambia un " +
    "píxel: sólo el URL que el visitante copiaría.",
  optOutOfEmailObfuscation:
    "marca el HTML para que Cloudflare no ofusque los correos (su script lo " +
    "mata nuestra CSP). Sólo importa detrás de Cloudflare, o sea publicado.",
  consolidateUnsplashCredits:
    "junta la atribución de Unsplash al pie. Es requisito de la licencia de " +
    "lo PUBLICADO, no de lo que se está editando.",
  annotateLanguageCluster:
    "canonical, hreflang del clúster de idiomas y su selector. Necesita las " +
    "URLs públicas de cada variante, que sólo existen al publicar.",

  // ── Quitan lo que el editor NECESITA ─────────────────────────────────────
  stripDesignStash:
    "quita data-ol-was, la memoria de originales del inspector. Fuera de la " +
    "publicada hay que conservarla: es lo que hace que el reset funcione.",
  stripOpIds:
    "quita los data-op-id del editor. 🔴 Al medir son lo contrario de un " +
    "estorbo: son la DIRECCIÓN de cada defecto que se le entrega al modelo.",

  // ── Las hace el lienzo, pero no /p/ ──────────────────────────────────────
  injectLogoIntoHtml:
    "la vista previa no lo hornea: sólo toca el <head> (icono y og:image) y " +
    "ahí no hay pestaña que lo enseñe. El lienzo SÍ lo hace.",
  sealRelease:
    "la CSP sellada con los hashes de los scripts, el <base> fuera y el " +
    "noopener. /p/ se sirve con su propia CSP por cabecera; el lienzo sí sella.",

  // SIETE ENTRADAS SE FUERON el 2026-08-26 con su horneado: carrusel, vídeo,
  // mapas, conductas, motion, música y 3D. Los siete existían porque el
  // JavaScript estaba prohibido. Motion, música y 3D SÍ tenían control en la
  // interfaz, y por eso salieron JUNTOS con él: quitarle el horneado a un
  // control que sigue ahí deja al usuario eligiendo un preset que no le hace
  // nada a la página publicada — silent-dark, que es el modo de fallo que este
  // repo ya conoce con nombre propio.
};

/**
 * De las de arriba, las que el LIENZO sí hace — y por eso no le faltan.
 *
 * El lienzo (`lib/lienzo/documento.ts`, spec 2026-09-15) es la superficie que
 * el usuario mira mientras edita Y la que el medidor mide, así que su lista de
 * diferencias es la que más caro cuesta tener mal: un defecto que sólo existe
 * en la página publicada no lo ve nadie hasta que lo ve un visitante.
 *
 * Los widgets no aparecen escritos en su fichero: los hereda llamando a
 * `bakeModulesForPreviewHtml`, el mismo contenedor que usa /p/.
 */
export const TAMBIEN_EN_EL_LIENZO: readonly string[] = [
  "injectLogoIntoHtml",
  "sealRelease",
  "bakeAssistantWidget",
  "bakeChatWidget",
];
