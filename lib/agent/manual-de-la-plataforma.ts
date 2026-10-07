// lib/agent/manual-de-la-plataforma.ts — el texto de /AGENTS.md y de /.openlen/docs, y cómo se adjunta.
//
// PASO 7 DE LEN 2.5 (2026-09-29, OK de Jesús). El prompt de Len mezclaba dos
// cosas: CÓMO TRABAJAR (conducta: alcance, probar, preguntar, no inventar) y
// CÓMO FUNCIONA OPENLEN (los contratos que el modelo no puede adivinar: dónde se
// guarda cada cosa, los formularios, los enlaces, el backend,
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
import { GUIA_DE_LA_APP, manualDeLaApp } from "@/lib/agent/modo-app";
import type { AppDeProyecto } from "@/lib/projects/types";
import {
  CARPETA_DOCS,
  CIERRE_DEL_ADJUNTO,
  PRINCIPIO_DEL_ADJUNTO,
  RUTA_GUIA,
  RUTA_LIBRERIAS,
  RUTA_MANUAL,
} from "@/lib/agent/ficheros/manual";
import {
  MAX_FOLDER_BYTES,
  MAX_FOLDER_FILE_BYTES,
  MAX_FOLDER_FILES,
  MAX_TEST_FILE_BYTES,
  RESERVED_ROOTS,
  WEB_EXTENSIONS,
} from "@/lib/agent/ficheros/folder";

// LA CARPETA (pieza 9 de Len 2.5; el texto lo escribió el carril B,
// B-PARA-A-manual-carpeta.md). Las cifras, las extensiones y las raíces salen
// de folder.ts, que es quien las hace cumplir: copiadas, se quedarían viejas en
// cuanto cambie una. Las raíces que se nombran son las del sitio publicado
// (las que Caddy contesta con otra cosa); las de Len y su terminal, desde
// `memoria`, no le dicen nada al modelo sobre dónde poner un fichero.
const RAICES_DEL_SITIO = RESERVED_ROOTS.slice(0, RESERVED_ROOTS.indexOf("memoria"))
  .map((r) => `/${r}`)
  .join(", ");

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

THE PROJECT'S FOLDER:
Besides its pages, the project is a folder like any Vercel + Supabase project: /js, /css, /data/*.json, /sw.js, /manifest.json and any other text file (${WEB_EXTENSIONS.join(" ")}), anywhere except the reserved roots (${RAICES_DEL_SITIO}). They are read and changed like the pages, every change can be undone with the turn, and publishing ships them as they are, next to the pages — except .jsx, .tsx and .ts, which are served and published compiled to JavaScript at the same path. Reference them by path: \`<script src="/js/app.js" type="module">\`, \`fetch("/data/menu.json")\`.
- /tests holds Playwright tests (never published); /supabase holds the backend's migrations.
- view_page and use_page load these files the way the published site does. Their browser does not run service workers: offline mode cannot be checked there — say so instead of claiming it works.
- An installable app is a /manifest.json plus a service worker at /sw.js; if the site stops using one, the platform publishes a /sw.js that removes itself, so no visitor stays on an old version.
- Up to ${MAX_FOLDER_FILES} files and ${MAX_FOLDER_BYTES / 1024 / 1024} MB; ${MAX_FOLDER_FILE_BYTES / 1024 / 1024} MB per file (${MAX_TEST_FILE_BYTES / 1024} KB per test file).
Before you say a change is done, check it: view_page mode="measure" is free and tells you what overflows, the contrast and the JavaScript errors; use_page tries it like a visitor. Nothing checks it for you. If you couldn't check it, say so instead of claiming it works.

THE BACKEND (Supabase):
This project has its own Supabase backend —a Postgres database behind the REST API, Auth with email and password, Storage for files (photos, videos, PDFs), and Realtime for live updates— at the URL and with the publishable key that PROJECT STATE gives you under \`supabase\` (\`supabase status\` in the terminal prints them too). Edge Functions don't exist here yet: if something needs them, say so. Anything that has to live on a server —a cart that is still there tomorrow, reviews everyone sees, a menu the user maintains, people who sign in— goes here.
- In the page, supabase-js as usual: \`<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\` and \`supabase.createClient(url, publishableKey)\`. The publishable key is meant to be in the page; a secret key, never.
- The tables, their policies, functions and triggers are migrations: \`supabase migration new <name>\` creates /supabase/migrations/<timestamp>_<name>.sql, you write the SQL in it with Write or Edit, and \`supabase db push\` applies it. Enable row level security on every table you create and write its policies: with RLS on and no policy the page reads nothing and writes nothing, and without RLS anyone can read and change everything. Users are auth.users: \`references auth.users(id)\`, and \`auth.uid()\` in the policies.
- To change what was already pushed, write a NEW migration. There is no \`supabase db reset\` here: this is the live database, with the visitors' data in it.
- use_page uses this same live database: what a visit sends to the backend stays there. To test what is behind signing in, it can sign in as one of the page's users (\`sign_in_as\`); it doesn't create accounts.
- Files go to Storage, with supabase-js as usual: \`supabase.storage.from(bucket).upload(path, file)\`, \`getPublicUrl(path)\` for a public bucket, \`createSignedUrl(path, seconds)\` for a private one. Create buckets in a migration (\`insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);\`). Who can upload, see, change or delete files is decided by policies on \`storage.objects\`, the same way as for tables; \`(storage.foldername(name))[1] = (select auth.uid()::text)\` keeps each user in their own folder. With no policy, only the secret key gets in. Limits: 50 MB per file and 1 GB per project. Image transformations and resumable uploads don't exist here yet.
- Live updates go through Realtime, with supabase-js as usual: \`supabase.channel(name)\` with \`.on('broadcast', { event }, …)\` and \`send()\` for messages between visitors, \`.track()\` and \`presenceState()\` for who is here, and \`.on('postgres_changes', { event, schema: 'public', table }, …)\` for changes to a table. A table is heard only after a migration adds it to the publication (\`alter publication supabase_realtime add table public.messages;\`), and its RLS policies decide who hears each change. Private channels (\`{ config: { private: true } }\`) are allowed by policies on \`realtime.messages\` with \`realtime.topic()\`. Limits: 200 connections and 100 messages per second per project.

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
// ⚰️ /.openlen/docs/api-d.md (`data-ol-stores` y /api/d) y accounts.md
// (data-ol-accounts) se retiraron el 2026-10-04 con lo que describían: los datos
// de una página van a su backend de Supabase (THE BACKEND, arriba;
// plans/pages-backend/design.md).
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

// LO QUE SABÍA CREAR (plans/crear-es-len, 2026-10-06). Crear dejó de ser una
// superficie aparte y pasó a ser el primer mensaje a Len; esto es lo que sólo
// decía su prompt (`app/api/generate/system-prompt.ts`), mudado sin reescribir
// a la guía que el índice ya manda leer antes de escribir desde cero. El resto
// de aquel prompt —contrato, librerías, JavaScript— Len ya lo tenía.
const FROM_SCRATCH = `WHEN THE PAGE IS EMPTY (you are writing it from scratch):
- The brief is sometimes specific, often vague. Design the whole page yourself: the structure, the palette, the typography, the rhythm and what the page even contains are yours to decide — a vague brief is your cue to apply judgment, not to fall back on something safe.
- There is no default shape. Nav on top, centered hero, three columns of benefits, testimonials, closing call and footer is ONE shape, not THE shape: it is the one that comes out by itself when nobody decides. Let the shape grow out of the content. Something to be read wants a column; something to be looked at wants a grid; something that happens over time wants a line; something to be compared wants a table; something with a single idea can fit in two blocks and be finished.
- Three habits to CHOOSE, not inherit: splitting the content into cards in threes, always opening with the same centered hero, and adding a section because one seems to be missing. Keep them when this page asks for them —a long text is glad of its table of contents, a shop is glad of its navigation— and leave them out when it doesn't.
- Write the whole document with Write, <head> included: a descriptive <title> that names the product, Tailwind via CDN, the Google Fonts you use and your own <style>.
- Every other page of the site is one more file, /<slug>/index.html, written the same way.`;

const INDICE = `MORE, IN ${CARPETA_DOCS} (read them when you need them):
- ${RUTA_GUIA}: the design guide —color, type, dark mode and finish—; read it BEFORE writing a page from scratch (an empty /index.html is one) or a redesign. What you add to a page that already exists is written the way that page is.
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

/** Corta el manual entero en /AGENTS.md y dos ficheros de /.openlen/docs. */
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
      [RUTA_GUIA]: `${cabecera}\n\n${FROM_SCRATCH}\n\n${gusto}`,
      [RUTA_LIBRERIAS]: librerias,
    },
  };
}

/** El contenido de /AGENTS.md: lo que Read devuelve y lo que se adjunta. En Len
 *  Dynamis no nombra Read, Edit ni Write, que no tiene. En una APP es el suyo
 *  (`lib/agent/modo-app.ts`), con las secciones que valen en los dos sitios
 *  tomadas enteras de éste. */
export function buildManualDeLaPlataforma(
  env: Readonly<Record<string, string | undefined>> = process.env,
  mode: AgentMode = "len",
  app: AppDeProyecto | null = null,
): string {
  const agents = app ? manualDeLaApp(manualSinPartir(), app) : partirElManual().agents;
  return terminalOnly(mode, env) ? paraSoloLaTerminal(agents) : agents;
}

/** Los ficheros de /.openlen/docs, por su ruta. Una app tiene su guía de
 *  diseño en la MISMA ruta, y no tiene la de las librerías de las páginas
 *  (sus paquetes son los de su catálogo, en /AGENTS.md). */
export function documentosDeLaPlataforma(app: AppDeProyecto | null = null): Readonly<Record<string, string>> {
  return app ? { [RUTA_GUIA]: GUIA_DE_LA_APP } : partirElManual().docs;
}

/** El texto de un fichero del manual por su ruta, o `null` si no es ninguno. */
export function textoDeLaPlataforma(ruta: string, mode: AgentMode = "len", app: AppDeProyecto | null = null): string | null {
  if (ruta === RUTA_MANUAL) return buildManualDeLaPlataforma(process.env, mode, app);
  const docs = documentosDeLaPlataforma(app);
  return Object.hasOwn(docs, ruta) ? docs[ruta]! : null;
}

/** El mensaje que el arnés pone justo después del prompt de sistema. */
export function adjuntoDelManual(manual: string = buildManualDeLaPlataforma()): string {
  return `${PRINCIPIO_DEL_ADJUNTO}

${manual.trim()}

${CIERRE_DEL_ADJUNTO}
`;
}
