// lib/librerias.ts — las librerías que una página publicada puede cargar.
//
// UNA SOLA FUENTE PARA LAS TRES LISTAS. Decidir «¿puede esta página usar
// Chart.js?» ocurre en tres sitios que no se hablan entre sí:
//
//   1. EL SANEADOR — `crates/html-engine/src/sanitize/scripts.rs`. ¿Sobrevive
//      la etiqueta al publicar? Está en Rust, así que su copia del host es
//      inevitablemente aparte; `lib/ai/librerias-acuerdo.test.ts` comprueba
//      contra el binding REAL que las dos dicen lo mismo.
//   2. LAS OPS DE CABEZA — `nodoDeCabezaPermitido` en
//      `lib/ai-stream/document-ops.ts`. ¿Puede el modelo AÑADIRLA a una página
//      que no nació con ella? Sin esto, abrir el saneador no sirve de nada para
//      una página que ya existe: Len no tiene por dónde meter el `<script>`.
//   3. EL PROMPT — las cinco superficies. Si no se le cuenta al modelo que
//      existen, no las usa. Es la lección medida de `js-clause.ts`: una
//      capacidad que el prompt no nombra es una capacidad que no existe.
//
// POR QUÉ SE AUTO-HOSPEDAN Y NO SE USA UN CDN PÚBLICO. jsDelivr o unpkg serían
// una línea menos, pero meten un tercero en la ruta de carga de TODAS las
// páginas publicadas: si se cae, se caen; si le cambian los bytes a una
// versión, se los cambian a todas. Estos ficheros se congelan en R2 bajo
// `libs.openlen.com`, con la versión en la ruta y SRI en la etiqueta.
//
// 🔴 CONGELADO SIGNIFICA CONGELADO: una ruta ya publicada NUNCA se vuelve a
// subir con bytes distintos. El SRI está en las páginas de los usuarios; cambiar
// los bytes bajo una ruta viva les rompe la librería a todas a la vez. Versión
// nueva = ruta nueva.

/** El host, y nada más que el host. Ver el bloque de arriba. */
export const LIBRERIAS_HOST = "libs.openlen.com";

/**
 * ¿Manda el origen `Access-Control-Allow-Origin`? HOY NO, y por eso esto existe.
 *
 * EL FALLO, medido el 2026-09-04 en un navegador real desde `https://example.com`:
 *
 *   con integrity+crossorigin → no carga, `typeof Chart === "undefined"`
 *   sin integrity+crossorigin → carga, `typeof Chart === "function"`
 *
 * La causa es de la especificación, no del bucket: **SRI sobre un origen ajeno
 * EXIGE CORS**, y `crossorigin="anonymous"` lo exige por su cuenta. Cualquiera
 * de los dos atributos convierte la petición en CORS, y R2 servido por dominio
 * propio no manda `Access-Control-Allow-Origin` mientras el bucket no tenga
 * política de CORS. Sin esa cabecera el navegador BLOQUEA el script — en la
 * página publicada y en el render que la mide, igual.
 *
 * POR QUÉ NO LO VIO NADIE. Las tres listas —saneador, ops de cabeza, prompt—
 * estaban de acuerdo, y `librerias-acuerdo.test.ts` lo comprobaba contra el
 * binding REAL. Pero las tres contestan a «¿sobrevive la etiqueta?», y ninguna
 * a «¿la ejecuta un navegador?». Había una CUARTA lista, el origen, y no
 * hablaba con las otras tres. `librerias:subir` tampoco: comprueba la ruta con
 * `fetch` desde Node, que no tiene origen y por tanto no hace CORS nunca.
 *
 * CÓMO SE VUELVE A PONER EL SRI. Se le pone al bucket una política de CORS que
 * permita `GET` desde cualquier origen (`npm run librerias:cors -- --aplicar`),
 * se comprueba con `npm run librerias:comprobar`, y ENTONCES esto pasa a `true`.
 * En ese orden: al revés se rompen otra vez todas las páginas a la vez.
 */
export const ORIGEN_MANDA_CORS = false;

const BASE = `https://${LIBRERIAS_HOST}`;

export interface Libreria {
  /** Identificador corto, el que se usa en la ruta. */
  readonly id: string;
  readonly nombre: string;
  readonly version: string;
  /** Para qué sirve, en una línea — es lo que lee el modelo. */
  readonly para: string;
  /** El global que deja en `window` una vez cargada. */
  readonly global: string;
  /**
   * Los ficheros JS, EN ORDEN DE CARGA. Casi todas traen uno; PhotoSwipe trae
   * dos (el núcleo y el lightbox) y el segundo necesita al primero, así que el
   * orden del array es el orden de las etiquetas.
   */
  readonly scripts: readonly { readonly url: string; readonly sri: string }[];
  /** Las que traen CSS propio. `null` cuando no hace falta ninguna hoja. */
  readonly css: string | null;
  readonly cssSri: string | null;
  /** Lo que el modelo NO puede adivinar de su API. Va tal cual al prompt. */
  readonly nota?: string;
}

/**
 * El catálogo. Lista CORTA Y CERRADA a propósito — cada entrada es código de
 * terceros que corre en la página de un visitante, así que entra por decisión
 * explícita de Jesús y no por conveniencia.
 *
 * Las dos son MIT, y las dos dejan un GLOBAL con una etiqueta clásica. Eso
 * último no es un detalle: el JavaScript del modelo es un `<script>` clásico al
 * final del body y `extractModelRuntime` RECHAZA `type="module"`
 * (`lib/ai-stream/model-runtime.ts`). Una librería sólo-ESM no la puede usar.
 *
 * ⚠️ CÓMO SE COMPRUEBA QUE UNA LIBRERÍA SIRVE, porque aquí ya se falló una vez.
 * El 2026-08-31 PhotoSwipe se dejó fuera por «sólo publica .esm.js, su `exports`
 * no ofrece otra cosa». FALSO, y el error fue de método: `exports` gobierna la
 * resolución POR ESPECIFICADOR (lo que hace un bundler con `import "x"`), no lo
 * que hay dentro del paquete — y aquí no se resuelve un módulo, se sirve un
 * fichero por HTTP. El tarball SÍ trae `dist/umd/`, comprobado el 2026-09-01 con
 * `npm pack` + `tar -tzf`.
 *
 * La regla: se miran LOS BYTES DEL TARBALL. Ni `exports`, ni la web, ni la
 * reputación.
 */
export const LIBRERIAS: readonly Libreria[] = [
  {
    id: "chart.js",
    nombre: "Chart.js",
    version: "4.5.0",
    para: "gráficas (barras, líneas, tarta, radar) sobre un <canvas>",
    global: "Chart",
    scripts: [
      {
        url: `${BASE}/chart.js/4.5.0/chart.umd.min.js`,
        sri: "sha384-XcdcwHqIPULERb2yDEM4R0XaQKU3YnDsrTmjACBZyfdVVqjh6xQ4/DCMd7XLcA6Y",
      },
    ],
    css: null,
    cssSri: null,
  },
  {
    id: "swiper",
    nombre: "Swiper",
    version: "12.2.0",
    para: "carruseles y pases de diapositivas con gesto táctil",
    global: "Swiper",
    scripts: [
      {
        url: `${BASE}/swiper/12.2.0/swiper-bundle.min.js`,
        sri: "sha384-TmUUNA9gRm9TspAqMh20CdxlcwkNFW3UyIOibSljonhpJ1UfGenJDyQvO/EbWwpW",
      },
    ],
    css: `${BASE}/swiper/12.2.0/swiper-bundle.min.css`,
    cssSri:
      "sha384-+eoVPirEHy8XSrf7sRozx+2OTKCWm1qfVFWnQ7qiXW6vAb+GUXRw4gq7sU+hq6HG",
  },
  {
    id: "photoswipe",
    nombre: "PhotoSwipe",
    version: "5.4.4",
    para: "galería a pantalla completa con zoom de pellizco y arrastre entre fotos",
    global: "PhotoSwipeLightbox",
    scripts: [
      {
        url: `${BASE}/photoswipe/5.4.4/photoswipe.umd.min.js`,
        sri: "sha384-k8EKyYcONphQ7zH4cQ0888JapXwrLTXQl/Ue1/jYgjVYahln1NWpnt2S4IC56LNh",
      },
      {
        url: `${BASE}/photoswipe/5.4.4/photoswipe-lightbox.umd.min.js`,
        sri: "sha384-IiBVbUz6+U+Tbm/ijO2P0XRwcVzNfrMzloNLkrqHkbi6w5H0v6ie4fI9BIO4SwdK",
      },
    ],
    css: `${BASE}/photoswipe/5.4.4/photoswipe.css`,
    cssSri:
      "sha384-IfxC36XL/toUyJ939C73PcgMuRzAZuIzZxE38drsmO5p6jD7ei+Zx/1oA/0l8ysE",
    nota:
      "Los DOS scripts, en ese orden. En la versión UMD no hay import dinámico, así que el módulo se pasa a mano: `new PhotoSwipeLightbox({ gallery: '.galeria', children: 'a', pswpModule: PhotoSwipe }).init()`. Cada `<a>` lleva el href a la imagen grande y `data-pswp-width` / `data-pswp-height`.",
  },
];

/**
 * ¿Esta URL es un fichero de nuestro host de librerías?
 *
 * Deliberadamente NO comprueba que sea una de las rutas del catálogo: mismo
 * razonamiento que en `scripts.rs`. Clavar la versión aquí obligaría a tocar
 * código para subir una revisión, mientras que una ruta que no hayamos subido
 * ya devuelve 404 — el control real está en lo que existe en R2, no en una
 * cadena. Lo que sí se exige es `https:` y que haya ruta.
 */
export function esUrlDeLibreria(url: string): boolean {
  const limpia = url.trim();
  if (!limpia.startsWith(`${BASE}/`)) return false;
  // Nada de `..` que se salga, ni una autoridad camuflada tras el prefijo.
  const resto = limpia.slice(BASE.length);
  return resto.length > 1 && !resto.includes("..") && !resto.startsWith("//");
}

/**
 * El bloque que ven las CINCO superficies del prompt.
 *
 * Corto a propósito: el contrato que se manda al crear es el MÍNIMO (~7 KB) y
 * el motivo de que sea mínimo está medido — ver `prompt-as-cage-measured`. Esto
 * añade lo justo para que la capacidad exista: qué hay, la etiqueta exacta que
 * hay que copiar, y la regla de que no se inventan otras.
 */
export function bloqueDeLibrerias(): string {
  // Los dos atributos van JUNTOS o no va ninguno, y sólo si el origen manda
  // CORS — ver `ORIGEN_MANDA_CORS`. Un `integrity` sin
  // `Access-Control-Allow-Origin` no es «menos garantía»: es la librería
  // BLOQUEADA, que es peor que no ofrecerla.
  const sello = (sri: string | null): string =>
    ORIGEN_MANDA_CORS && sri ? ` integrity="${sri}" crossorigin="anonymous"` : "";
  const fichas = LIBRERIAS.map((l) => {
    const css = l.css
      ? `\n  CSS:     <link rel="stylesheet" href="${l.css}"${sello(l.cssSri)}>`
      : "";
    const scripts = l.scripts
      .map(
        (sc) =>
          `
  Script:  <script src="${sc.url}"${sello(sc.sri)}></script>`,
      )
      .join("");
    const nota = l.nota ? `
  Nota:    ${l.nota}` : "";
    return `• ${l.nombre} ${l.version} — ${l.para}. Global: \`${l.global}\`.${scripts}${css}${nota}`;
  }).join("\n");

  return `LIBRERÍAS DISPONIBLES (opcionales — la mayoría de páginas no necesitan ninguna):

${fichas}

Reglas:
- Copia la etiqueta EXACTA, tal y como está escrita aquí arriba. NO le añadas integrity ni crossorigin: este origen no manda cabeceras CORS, y cualquiera de los dos atributos hace que el navegador BLOQUEE la librería y tu código muera con "no está definido".
- Van en el <head>. Tu propio <script> va al final del body, así que la librería ya está cargada cuando tu código corre.
- ${LIBRERIAS_HOST} es el ÚNICO origen de librerías que sobrevive al publicar. Un <script> a jsdelivr, unpkg, cdnjs o cualquier otro CDN se borra y la página queda con la función muerta.
- No las metas "por si acaso": una gráfica con datos inventados es peor que no tener gráfica. Úsalas cuando la página de verdad las pida.`;
}
