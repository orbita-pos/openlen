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
import { paraSoloLaTerminal, terminalOnly } from "@/lib/agent/terminal/declaracion";
import type { AgentMode } from "@/lib/agent/dynamis";
import { STORES_DOC } from "@/lib/agent/stores-doc";
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
- What is saved with localStorage SURVIVES closing the tab and the browser; what it doesn't do is travel to another device, another visitor or the user. What is saved in the BACKEND lives on the server, and who sees what is decided by its policies. Telling them "it's saved in the browser" about something you saved in the backend is lying to them.
- Forms work: what the visitor sends reaches the user's email and their Inbox (how to write one, in the guide below). When people need to be able to write to them, offer the form; WhatsApp or the chat in addition, not instead.
- OpenLen NO ejecuta JavaScript de la página: ESTA LÍNEA NO LA LEE EL MODELO — es la MARCA de la cláusula \`agente\` y \`swapJsClauses\` la sustituye entera, del guion al salto de línea, por la versión permisiva (lib/ai/js-clause.ts). El texto tiene que quedarse porque el intercambio LANZA si no encuentra su marca. Lo sujeta lib/agent/catalog.test.ts, que exige que esta frase NO salga en el prompt montado.
- WHAT REALLY CAN'T BE DONE, and it is little: charging a card INSIDE the page (there is no payment gateway: payment goes through the user's payment link, as above, or by WhatsApp or bank transfer), the user finding out what the visitor did in their browser (that is what the form is for) and sending emails on your own.

LINKS (<a href>):
- The URLs they give you are their real data: they go into the href VERBATIM, character for character, with their query string and their capital letters.
- ABSOLUTE, ALWAYS: "instagram.com/juan" or "@juan" are completed to https://instagram.com/juan. An href without a scheme is a RELATIVE path of the site itself, and the failure is SILENT: the server serves the home page again with a 200 and the visitor lands on the same page. mailto: and tel: are fine too.
- INTERNAL: the path "/<slug>" of its file /<slug>/index.html (e.g. /menu); never "menu.html" or plain "menu", which fall into the same silent fallback to the home page. The home page is "/".
- ANCHORS ("#pricing"): only if that id EXISTS on the target page; if not, create it in the same edit.

THE BACKEND (Supabase):
This project has its own Supabase backend —a Postgres database behind the REST API, and Auth with email and password— at the URL and with the publishable key that PROJECT STATE gives you under \`supabase\` (\`supabase status\` in the terminal prints them too). Realtime, Storage and Edge Functions don't exist here yet: if something needs them, say so. Anything that has to live on a server —a cart that is still there tomorrow, reviews everyone sees, a menu the user maintains, people who sign in— goes here.
- In the page, supabase-js as usual: \`<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\` and \`supabase.createClient(url, publishableKey)\`. The publishable key is meant to be in the page; a secret key, never.
- The tables, their policies, functions and triggers are migrations: \`supabase migration new <name>\` creates /supabase/migrations/<timestamp>_<name>.sql, you write the SQL in it with Write or Edit, and \`supabase db push\` applies it. Enable row level security on every table you create and write its policies: with RLS on and no policy the page reads nothing and writes nothing, and without RLS anyone can read and change everything. Users are auth.users: \`references auth.users(id)\`, and \`auth.uid()\` in the policies.
- To change what was already pushed, write a NEW migration. There is no \`supabase db reset\` here: this is the live database, with the visitors' data in it.
- A page that already declares a data-ol-stores block (the older way to keep data) keeps working with it; how, in ${RUTA_API_D}. New data goes in the backend.

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
//   · /.openlen/docs/librerias.md — las librerías que sobreviven al publicar (lo que se
//     rompe en silencio lo dice además `librerias-que-no-cargan`);
//   · /.openlen/docs/api-d.md — `data-ol-stores` y /api/d, SÓLO para las páginas
//     que ya declaran almacenes. Desde el 2026-10-04 lo nuevo va al backend de
//     Supabase (THE BACKEND, arriba; plans/pages-backend/design.md), y este
//     texto NO sale del manual: se mudó entero a lib/agent/stores-doc.ts.
// ⚰️ /.openlen/docs/accounts.md (data-ol-accounts, 03/10) se retiró el mismo día
// sin llegar a desplegarse: la gente que entra en la página es Supabase Auth.
// El texto se MUDA, no se reescribe: se corta por sus marcas y LANZA si una no
// aparece, como `swapJsClauses`. Regla por regla, en
// plans/len-agente-2026/notas/f4-tabla-de-reglas.md (M1–M21, I1–I3).

// Todas las marcas van en inglés desde la traducción de lo que lee Len (rama
// len-agente-2026-en): también las del contrato y las librerías, que Jesús
// decidió traducir para Crear y el editor a la vez (2026-10-02).
const MARCA_GUIA = "DESIGN GUIDE (";
const MARCA_GUSTO = "\nCOLOR, SHAPE AND TYPE";
const MARCA_LIBRERIAS = "AVAILABLE LIBRARIES";
/** La entradilla de WHAT PUBLISHING REQUIRES prometía el acabado «al final»,
 *  y el acabado se va a la guía. */
const PROMESA_DEL_ACABADO = ", and at the end the level of finish that is expected.";

const INDICE = `MORE, IN ${CARPETA_DOCS} (read them when you need them):
- ${RUTA_GUIA}: the design guide —color, type, dark mode and finish—; read it BEFORE writing a page from scratch or a redesign. What you add to a page that already exists is written the way that page is.
- ${RUTA_API_D}: ONLY for a page that already declares a data-ol-stores block: how its stores and its JavaScript (/api/d) work.
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

/** Corta el manual entero en /AGENTS.md y dos ficheros de /.openlen/docs, y
 *  les suma el tercero, el de los almacenes de antes, que no sale del manual. */
export function partirElManual(entero: string = manualSinPartir()): ManualPartido {
  // La guía: su cabecera, lo que IMPONE (se queda) y el gusto (se va).
  const iGuia = encontrar(entero, MARCA_GUIA);
  const finCabecera = encontrar(entero, "\n", iGuia);
  const cabecera = entero.slice(iGuia, finCabecera);
  const iLibrerias = encontrar(entero, MARCA_LIBRERIAS, finCabecera);
  const contrato = entero.slice(finCabecera + 1, iLibrerias).trimEnd();
  const librerias = entero.slice(iLibrerias).trim();
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

  const antes = entero.slice(0, iGuia).trimEnd();
  const agents = [antes, ...(impone ? [impone] : []), INDICE].join("\n\n");
  return {
    agents,
    docs: {
      [RUTA_GUIA]: `${cabecera}\n${gusto}`,
      // No se corta del manual: lo de antes de Supabase, en su fichero (lib/agent/stores-doc.ts).
      [RUTA_API_D]: STORES_DOC,
      [RUTA_LIBRERIAS]: librerias,
    },
  };
}

/** El contenido de /AGENTS.md: lo que Read devuelve y lo que se adjunta. En Len
 *  Dynamis no nombra Read, Edit ni Write, que no tiene. */
export function buildManualDeLaPlataforma(
  env: Readonly<Record<string, string | undefined>> = process.env,
  mode: AgentMode = "len",
): string {
  const { agents } = partirElManual();
  return terminalOnly(mode, env) ? paraSoloLaTerminal(agents) : agents;
}

/** Los ficheros de /.openlen/docs, por su ruta. */
export function documentosDeLaPlataforma(): Readonly<Record<string, string>> {
  return partirElManual().docs;
}

/** El texto de un fichero del manual por su ruta, o `null` si no es ninguno. */
export function textoDeLaPlataforma(ruta: string, mode: AgentMode = "len"): string | null {
  if (ruta === RUTA_MANUAL) return buildManualDeLaPlataforma(process.env, mode);
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
