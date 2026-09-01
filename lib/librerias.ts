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
  readonly script: string;
  readonly scriptSri: string;
  /** Las que traen CSS propio. `null` cuando no hace falta ninguna hoja. */
  readonly css: string | null;
  readonly cssSri: string | null;
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
 * ⚠️ POR ESO NO ESTÁ PHOTOSWIPE. Se decidió el 2026-08-31 junto con estas dos,
 * sobre la premisa de que las tres traían build UMD. Comprobado al ir a subirlas:
 * PhotoSwipe 5.4.4 publica SÓLO `.esm.js` (su `exports` no ofrece otra cosa), así
 * que con el contrato de runtime de hoy el modelo no puede cargarla. Queda fuera
 * hasta que se decida qué ceder — el contrato clásico o la librería.
 */
export const LIBRERIAS: readonly Libreria[] = [
  {
    id: "chart.js",
    nombre: "Chart.js",
    version: "4.5.0",
    para: "gráficas (barras, líneas, tarta, radar) sobre un <canvas>",
    global: "Chart",
    script: `${BASE}/chart.js/4.5.0/chart.umd.min.js`,
    scriptSri:
      "sha384-XcdcwHqIPULERb2yDEM4R0XaQKU3YnDsrTmjACBZyfdVVqjh6xQ4/DCMd7XLcA6Y",
    css: null,
    cssSri: null,
  },
  {
    id: "swiper",
    nombre: "Swiper",
    version: "12.2.0",
    para: "carruseles y pases de diapositivas con gesto táctil",
    global: "Swiper",
    script: `${BASE}/swiper/12.2.0/swiper-bundle.min.js`,
    scriptSri:
      "sha384-TmUUNA9gRm9TspAqMh20CdxlcwkNFW3UyIOibSljonhpJ1UfGenJDyQvO/EbWwpW",
    css: `${BASE}/swiper/12.2.0/swiper-bundle.min.css`,
    cssSri:
      "sha384-+eoVPirEHy8XSrf7sRozx+2OTKCWm1qfVFWnQ7qiXW6vAb+GUXRw4gq7sU+hq6HG",
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
  const fichas = LIBRERIAS.map((l) => {
    const css = l.css
      ? `\n  CSS:     <link rel="stylesheet" href="${l.css}" integrity="${l.cssSri}" crossorigin="anonymous">`
      : "";
    return `• ${l.nombre} ${l.version} — ${l.para}. Global: \`${l.global}\`.
  Script:  <script src="${l.script}" integrity="${l.scriptSri}" crossorigin="anonymous"></script>${css}`;
  }).join("\n");

  return `LIBRERÍAS DISPONIBLES (opcionales — la mayoría de páginas no necesitan ninguna):

${fichas}

Reglas:
- Copia la etiqueta EXACTA, con su integrity y su crossorigin. Sin el integrity el navegador la carga igual, pero pierdes la garantía de que son los bytes que decimos; con uno mal copiado NO carga.
- Van en el <head>. Tu propio <script> va al final del body, así que la librería ya está cargada cuando tu código corre.
- ${LIBRERIAS_HOST} es el ÚNICO origen de librerías que sobrevive al publicar. Un <script> a jsdelivr, unpkg, cdnjs o cualquier otro CDN se borra y la página queda con la función muerta.
- No las metas "por si acaso": una gráfica con datos inventados es peor que no tener gráfica. Úsalas cuando la página de verdad las pida.`;
}
