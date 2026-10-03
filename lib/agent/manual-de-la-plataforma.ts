// lib/agent/manual-de-la-plataforma.ts — el texto de /AGENTS.md y de /.openlen/docs, y cómo se adjunta.
//
// PASO 7 DE LEN 2.5 (2026-09-29, OK de Jesús). El prompt de Len mezclaba dos
// cosas: CÓMO TRABAJAR (conducta: alcance, probar, preguntar, no inventar) y
// CÓMO FUNCIONA OPENLEN (los contratos que el modelo no puede adivinar: dónde se
// guarda cada cosa, el `/api/d`, los formularios, los enlaces, los almacenes,
// la guía de diseño, las librerías). Claude Code las separa igual: su prompt de
// sistema es conducta, y lo del proyecto y de la organización llega en sus
// ficheros de instrucciones (`CLAUDE.md`, `AGENTS.md`, el gestionado), que el
// ARNÉS adjunta al principio de la conversación. DeepSeek no cargaría nada por
// su cuenta (abrió la lista 1 vez de 57), así que lo adjunta el arnés siempre.
//
// El texto se MOVIÓ, no se reescribió: las mismas secciones, con las mismas
// palabras, y las tres transformaciones de antes (el contrato mínimo, las
// cláusulas del JavaScript y el contrato dicho para Len) aplicadas aquí, que es
// donde ahora viven sus marcas. Lo que cambia es el sitio. Quitar o mover texto
// del prompt es una hipótesis: se mide en la medición única de Len-Bench.
//
// POR QUÉ AL PRINCIPIO Y NO EN EL ÚLTIMO MENSAJE. El contexto de Len va en el
// último mensaje porque cambia en cada petición. El manual no cambia: justo
// después del prompt de sistema forma parte del prefijo fijo, y se lee de
// caché. Es también donde Claude Code pone sus ficheros de instrucciones.

import { PUBLISH_CONTRACT } from "@/lib/design-guidance";
import { swapJsClauses } from "@/lib/ai/js-clause";
import { conContratoMinimo, contratoParaSuperficie } from "@/lib/publish-contract-min";
import { bloqueDeLibrerias } from "@/lib/librerias";
import { paraSoloLaTerminal, soloTerminal } from "@/lib/agent/terminal/declaracion";
import {
  CARPETA_DOCS,
  CIERRE_DEL_ADJUNTO,
  PRINCIPIO_DEL_ADJUNTO,
  RUTA_API_D,
  RUTA_GUIA,
  RUTA_LIBRERIAS,
  RUTA_MANUAL,
} from "@/lib/agent/ficheros/manual";

/**
 * El manual ENTERO, como era hasta F4: lo que se adjuntaba en cada vuelta. Sigue
 * siendo la fuente —las tres transformaciones se aplican aquí, sobre el texto
 * con sus marcas— y `partir` lo reparte después entre /AGENTS.md y /.openlen/docs.
 * Exportado para la prueba que exige que no se pierda ninguna línea.
 */
export function manualSinPartir(): string {
  const manual = `# OpenLen: how the platform works

WHAT EXISTS AND WHAT DOESN'T:
- What is saved with localStorage SURVIVES closing the tab and the browser; what it doesn't do is travel to another device, another visitor or the user. What is saved in a STORE lives on the server: in "propio" mode each visitor sees their own, and the user sees all of it in the editor, in the "Data" view (not in the Inbox, which is for forms). Telling them "it's saved in the browser" about something you saved in a store is lying to them.
- Forms work: what the visitor sends reaches the user's email and their Inbox (how to write one, in the guide below). When people need to be able to write to them, offer the form; WhatsApp or the chat in addition, not instead.
- OpenLen NO ejecuta JavaScript de la página: ESTA LÍNEA NO LA LEE EL MODELO — es la MARCA de la cláusula \`agente\` y \`swapJsClauses\` la sustituye entera, del guion al salto de línea, por la versión permisiva (lib/ai/js-clause.ts). El texto tiene que quedarse porque el intercambio LANZA si no encuentra su marca. Lo sujeta lib/agent/catalog.test.ts, que exige que esta frase NO salga en el prompt montado.
- WHAT REALLY CAN'T BE DONE, and it is little: charging a card INSIDE the page (there is no payment gateway: payment goes through the user's payment link, as above, or by WhatsApp or bank transfer), the user finding out what the visitor did in their browser (that is what the form is for) and sending emails on your own.

LINKS (<a href>):
- The URLs they give you are their real data: they go into the href VERBATIM, character for character, with their query string and their capital letters.
- ABSOLUTE, ALWAYS: "instagram.com/juan" or "@juan" are completed to https://instagram.com/juan. An href without a scheme is a RELATIVE path of the site itself, and the failure is SILENT: the server serves the home page again with a 200 and the visitor lands on the same page. mailto: and tel: are fine too.
- INTERNAL: the path "/<slug>" of its file /<slug>/index.html (e.g. /menu); never "menu.html" or plain "menu", which fall into the same silent fallback to the home page. The home page is "/".
- ANCHORS ("#pricing"): only if that id EXISTS on the target page; if not, create it in the same edit.

STORES (the page's data, in /datos):
A STORE keeps real data on the server —a dish on the menu, a product in the catalog, a review— and survives reloads and republishing. It is DECLARED in the page, with Edit: a \`<script type="application/json" data-ol-stores>\` block inside the <body>, outside any section that could be deleted, which says what fields it has and who may touch them. Its shape: {"menu":{"visitante":"lectura","campos":{"plato":"texto","precio":"numero"}}}. \`visitante\` is "lectura" (you maintain it, the visitor only reads it — the normal case for a menu or a catalog), "propio" (each visitor writes and reads THEIR OWN — a cart), "publico" (anyone writes and EVERYONE reads it — REVIEWS, comments, a wall: it is published at once and everybody sees it, as on Mercado Libre) or "añadir" (the visitor creates and does NOT read what others left — a sign-up form, where what each one leaves is private). The types are texto, numero, booleano, fecha and lista.
Once declared, each store is a FILE: /datos/<store>.json, the list of its rows with their id. Read it with Read and change it with Edit or Write like any file: a row without an id is new, the one you change gets updated and the one you remove gets deleted. Everything is checked before anything is saved —a field the store doesn't declare, or a value of the wrong type, comes back to you as an error—. If the store doesn't exist yet, declare the block with Edit and write its file in the SAME turn. For the content of a "lectura" store to show on the published page, leave a container with data-ol-datos="<name>" where you want it to appear.

DESIGN GUIDE (for the pages you create yourself and for a redesign you are asked for; what you add to a page that already exists is written the way that page is):
${PUBLISH_CONTRACT}

${bloqueDeLibrerias({ dondeVaElScript: "libre" })}`;

  // Las tres transformaciones que antes se aplicaban al prompt entero, en el
  // mismo orden y con el mismo nombre de quien las pide: sus marcas viven
  // ahora aquí. 🔴 EL CONTRATO MÍNIMO porque esto se paga en cada petición.
  const quien = "buildManualDeLaPlataforma";
  const { prompt: recortado, min } = conContratoMinimo(manual, quien);
  const conClausulas = swapJsClauses(
    recortado,
    min ? ["agente", "contrato-min"] : ["agente", "contrato-completo", "conductas"],
  );
  if (!min) return conClausulas;
  // EL CONTRATO, DICHO PARA LEN (2026-09-04). Va DESPUÉS de `swapJsClauses` a
  // propósito: la viñeta del JavaScript se retira en su versión ya
  // intercambiada, y hacerlo antes dejaría al intercambio sin su marca.
  return contratoParaSuperficie(conClausulas, quien, {
    // La respuesta de Len son llamadas a herramientas más prosa para el
    // usuario. El contrato decía «el primer carácter de tu respuesta es `<`».
    respuestaEsElDocumento: false,
    // Una página nace con un Write a /<slug>/index.html; un enlace no crea nada.
    elEnlaceCreaLaPagina: false,
    // El JavaScript y los enlaces los cubren sus secciones de arriba, con más
    // precisión que el contrato; `data-slot-path` no lo dice ninguna de las
    // dos, porque Write y Edit lo rechazan con su error.
    yaLoDiceLaSuperficie: ["javascript", "enlaces", "data-slot-path"],
    // Len edita documentos que ya traen su `<head>`, y una página nueva la
    // escribe leyendo antes /index.html: «añade dentro, no dupliques» es la
    // orden que le sirve en los dos casos.
    escribeElHead: false,
    // Lo que añade a una página que ya existe se escribe como ella («CÓMO
    // TRABAJAR»); la guía manda en lo que crea (H8).
    laGuiaEsParaLoQueCrea: true,
    // Dos reglas que protegían al editor de defectos suyos, ya arreglados
    // (2026-09-29, OK de Jesús): el prefijo `--ol-` obligatorio y «enlaza
    // Spotify, que el editor borra el iframe». Ver `ReglaRetirada`.
    retira: ["vocabulario-ol", "iframes-que-borraba-el-editor"],
  });
}

// ─── F4 (plans/len-agente-2026): el manual EN FICHEROS ──────────────────────
//
// Lo que la publicación IMPONE —formularios, iframes, enlaces, imágenes— vale
// para cualquier edición y se queda a la vista en /AGENTS.md. Lo que sólo manda
// en lo que Len crea o en un JavaScript concreto se lee cuando hace falta, en
// /.openlen/docs (oculta: ver `CARPETA_DOCS`):
//   · /.openlen/docs/guia-de-diseno.md — color, letra, modo oscuro y acabado;
//   · /.openlen/docs/api-d.md — cómo guarda y lee el JavaScript en un almacén;
//   · /.openlen/docs/librerias.md — las librerías que sobreviven al publicar (lo que se
//     rompe en silencio lo dice además `librerias-que-no-cargan`).
// El texto se MUDA, no se reescribe: se corta por sus marcas y LANZA si una no
// aparece, como `swapJsClauses`. Regla por regla, en
// plans/len-agente-2026/notas/f4-tabla-de-reglas.md (M1–M21, I1–I3).

// Todas las marcas van en inglés desde la traducción de lo que lee Len (rama
// len-agente-2026-en): también las del contrato y las librerías, que Jesús
// decidió traducir para Crear y el editor a la vez (2026-10-02).
const MARCA_GUIA = "DESIGN GUIDE (";
const MARCA_GUSTO = "\nCOLOR, SHAPE AND TYPE";
const MARCA_LIBRERIAS = "AVAILABLE LIBRARIES";
const MARCA_API_D = "SAVING TOO:";
/** La entradilla de WHAT PUBLISHING REQUIRES prometía el acabado «al final»,
 *  y el acabado se va a la guía. */
const PROMESA_DEL_ACABADO = ", and at the end the level of finish that is expected.";

/** Lo que queda en la línea del JavaScript donde estaba el contrato de /api/d. */
const EN_LUGAR_DE_API_D = `SAVING TOO is possible, in a store: what the JavaScript asks of /api/d is in ${RUTA_API_D}.`;

const INDICE = `MORE, IN ${CARPETA_DOCS} (read them when you need them):
- ${RUTA_GUIA}: the design guide —color, type, dark mode and finish—; read it BEFORE writing a page from scratch or a redesign. What you add to a page that already exists is written the way that page is.
- ${RUTA_API_D}: how the page's JavaScript saves to and reads from a store (/api/d); read it before writing that JavaScript.
- ${RUTA_LIBRERIAS}: the chart, carousel and gallery libraries that survive publishing, with their exact tag; read it before adding one.`;

const encontrar = (texto: string, marca: string, desde = 0): number => {
  const i = texto.indexOf(marca, desde);
  if (i === -1) {
    throw new Error(
      `manual-de-la-plataforma: la marca «${marca.trim()}» no apareció — el manual cambió de redacción. ` +
        "Actualiza el reparto de F4; NO lo ignores: sin esto una parte del manual dejaría de llegarle a Len.",
    );
  }
  return i;
};

interface ManualPartido {
  readonly agents: string;
  readonly docs: Readonly<Record<string, string>>;
}

/** Corta el manual entero en /AGENTS.md y los tres ficheros de /.openlen/docs. */
export function partirElManual(entero: string = manualSinPartir()): ManualPartido {
  // 1 · El contrato de /api/d sale de la línea del JavaScript, hasta su final.
  const iApi = encontrar(entero, MARCA_API_D);
  const finApi = entero.indexOf("\n", iApi) === -1 ? entero.length : entero.indexOf("\n", iApi);
  const apiD = entero.slice(iApi, finApi);
  const sinApi = entero.slice(0, iApi) + EN_LUGAR_DE_API_D + entero.slice(finApi);

  // 2 · La guía: su cabecera, lo que IMPONE (se queda) y el gusto (se va).
  const iGuia = encontrar(sinApi, MARCA_GUIA);
  const finCabecera = encontrar(sinApi, "\n", iGuia);
  const cabecera = sinApi.slice(iGuia, finCabecera);
  const iLibrerias = encontrar(sinApi, MARCA_LIBRERIAS, finCabecera);
  const contrato = sinApi.slice(finCabecera + 1, iLibrerias).trimEnd();
  const librerias = sinApi.slice(iLibrerias).trim();
  // Con el contrato COMPLETO (`OPENLEN_MIN_CONTRACT=0`, la salida de
  // emergencia) no hay sección de gusto que separar: la guía entera va a /.openlen/docs.
  const iGusto = contrato.indexOf(MARCA_GUSTO);
  let impone = "";
  let gusto = contrato;
  if (iGusto !== -1) {
    impone = contrato.slice(0, iGusto).trimEnd();
    gusto = contrato.slice(iGusto + 1);
    encontrar(impone, PROMESA_DEL_ACABADO);
    impone = impone.replace(PROMESA_DEL_ACABADO, `; the level of finish is in ${RUTA_GUIA}.`);
  }

  const antes = sinApi.slice(0, iGuia).trimEnd();
  const agents = [antes, ...(impone ? [impone] : []), INDICE].join("\n\n");
  return {
    agents,
    docs: {
      [RUTA_GUIA]: `${cabecera}\n${gusto}`,
      [RUTA_API_D]: `# /api/d: the page's JavaScript saves to and reads from a store\n\n${apiD}`,
      [RUTA_LIBRERIAS]: librerias,
    },
  };
}

/** El contenido de /AGENTS.md: lo que Read devuelve y lo que se adjunta. En el
 *  brazo «sólo terminal» (F4) no nombra Read, Edit ni Write, que no tiene. */
export function buildManualDeLaPlataforma(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const { agents } = partirElManual();
  return soloTerminal(env) ? paraSoloLaTerminal(agents) : agents;
}

/** Los ficheros de /.openlen/docs, por su ruta. */
export function documentosDeLaPlataforma(): Readonly<Record<string, string>> {
  return partirElManual().docs;
}

/** El texto de un fichero del manual por su ruta, o `null` si no es ninguno. */
export function textoDeLaPlataforma(ruta: string): string | null {
  if (ruta === RUTA_MANUAL) return buildManualDeLaPlataforma();
  const docs = documentosDeLaPlataforma();
  return Object.hasOwn(docs, ruta) ? docs[ruta]! : null;
}

/** El mensaje que el arnés pone justo después del prompt de sistema. */
export function adjuntoDelManual(manual: string = buildManualDeLaPlataforma()): string {
  return `${PRINCIPIO_DEL_ADJUNTO}

${manual.trim()}

${CIERRE_DEL_ADJUNTO}
`;
}
