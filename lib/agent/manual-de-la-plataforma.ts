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
import { realTerminalFor } from "@/lib/agent/sandbox/config";
import type { AgentMode } from "@/lib/agent/dynamis";
import { GUIA_DE_LA_APP, manualDeLaApp } from "@/lib/agent/modo-app";
import type { AppDeProyecto } from "@/lib/projects/types";
import {
  CARPETA_DOCS,
  CIERRE_DEL_ADJUNTO,
  PRINCIPIO_DEL_ADJUNTO,
  RUTA_APPS,
  RUTA_GUIA,
  RUTA_LIBRERIAS,
  RUTA_MANUAL,
} from "@/lib/agent/ficheros/manual";
import { CATALOGO_ACTUAL } from "@/lib/apps/dependencias";
import { FUNCTIONS_CATALOG_CURRENT, functionsCatalog } from "@/lib/functions/catalog";
import { appAiEnabledIn } from "@/lib/app-ai/enabled";
import { functionsEnabledIn } from "@/lib/functions/enabled";
import { stripeEnabledIn } from "@/lib/stripe/enabled";
import { emailEnabledIn } from "@/lib/project-email/enabled";
import { shopifyEnabledIn } from "@/lib/shopify/enabled";
import { FUNCTION_LIMITS, FUNCTION_MEMORY_MB, MAX_REQUEST_BYTES } from "@/lib/functions/limits";
import { MAX_FUNCTIONS } from "@/lib/functions/project-files";
import { ENTRADA } from "@/lib/apps/esqueleto";
import { ARTIFACT_MANUAL_INDEX, artifactManuals } from "./artifact-manuals";
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
- /tests holds Playwright tests, which are not run here (there is no Playwright in the terminal): they are kept, never published, and they go with the project when it is exported. Checking the page here is view_page and use_page. /supabase holds the backend's migrations.
- view_page and use_page load these files the way the published site does. Their browser does not run service workers: offline mode cannot be checked there — say so instead of claiming it works.
- An installable app is a /manifest.json plus a service worker at /sw.js; if the site stops using one, the platform publishes a /sw.js that removes itself, so no visitor stays on an old version.
- Up to ${MAX_FOLDER_FILES} files and ${MAX_FOLDER_BYTES / 1024 / 1024} MB; ${MAX_FOLDER_FILE_BYTES / 1024 / 1024} MB per file (${MAX_TEST_FILE_BYTES / 1024} KB per test file).
Before you say a change is done, check it: view_page mode="measure" is free and tells you what overflows, the contrast and the JavaScript errors; view_page mode="screenshot" shows it to you as an image; use_page tries it like a visitor, and can take a screenshot after a step. Nothing checks it for you. If you couldn't check it, say so instead of claiming it works.

THE BACKEND (Supabase):
This project has its own Supabase backend —a Postgres database behind the REST API, Auth with email and password, Storage for files (photos, videos, PDFs), and Realtime for live updates— at the URL and with the publishable key that PROJECT STATE gives you under \`supabase\` (\`supabase status\` in the terminal prints them too). Edge Functions don't exist here yet: if something needs them, say so. Anything that has to live on a server —a cart that is still there tomorrow, reviews everyone sees, a menu the user maintains, people who sign in— goes here.
- In the page, supabase-js as usual: \`<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\` and \`supabase.createClient(url, publishableKey)\`. The publishable key is meant to be in the page; a secret key, never.
- The tables, their policies, functions and triggers are migrations: \`supabase migration new <name>\` creates /supabase/migrations/<timestamp>_<name>.sql, you write the SQL in it with Write or Edit, and \`supabase db push\` applies it. Enable row level security on every table you create and write its policies: with RLS on and no policy the page reads nothing and writes nothing, and without RLS anyone can read and change everything. Users are auth.users: \`references auth.users(id)\`, and \`auth.uid()\` in the policies.
- You work on the TEST database: \`supabase db push\` (or \`supabase migration up\`), your use_page visits and \`supabase/seed.sql\` all land there. Production is a separate database that only the published site uses; when the user publishes, your pushed migrations are applied to it —the tables, never the test rows. To change what was already pushed, write a NEW migration. \`supabase db reset\` recreates the test database from the migrations and runs \`supabase/seed.sql\` (put example rows there).
- \`supabase db query "<sql>"\` runs SQL on the test database (one statement; table changes go in a migration). \`supabase db query --linked "<sql>"\` reads PRODUCTION —the real data, e.g. to answer "how much did I sell today?"— read-only: you never write to production. If a publish would delete real data (a dropped column or table, deleted rows), the user is asked to confirm when publishing.
- To test what is behind signing in, use_page can sign in as a user of the test database (\`sign_in_as\` with an email): if there is none with that email, a test user is created. The test database sends no emails; new accounts are confirmed automatically.
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
- ${RUTA_LIBRERIAS}: the chart, carousel and gallery libraries that survive publishing, with their exact tag; read it before adding one.
- ${RUTA_APPS}: how a web app is built here (React in /src, its packages, its screens); read it BEFORE converting a page into an app.`;

/** /.openlen/docs/apps.md en una página: el manual de una app recién
 *  convertida, para escribirla en /src antes de `convert_to_app`. */
function manualParaConvertir(): string {
  return `# HOW A WEB APP IS BUILT HERE (for converting this page into an app with convert_to_app)
Convert only after the user accepted. Build the whole app in /src FIRST, with the pages still in place —read each one—, and then call convert_to_app, which swaps the pages for the app in one step. The app keeps the page's look (its colors, fonts and texts): the pages become screens (/menu/index.html → /src/screens/Menu.tsx at the route #/menu, the home at #/), what repeats in every page (the header, the menu, the footer) becomes a component in /src/components, the loose JavaScript becomes React state, and each form saves to a table (a migration in /supabase/migrations, and the form inserts into it with supabase-js) instead of going to the Inbox. Below, the rules every app follows once converted.

${manualDeLaApp(manualSinPartir(), { catalogo: CATALOGO_ACTUAL, entrada: ENTRADA })
  .replace(/^# OpenLen: how the platform works\n\n/, "")
  .replace("THIS PROJECT IS A WEB APP:", "A WEB APP, ONCE CONVERTED:")
  // Su índice nombra la guía de diseño de una APP, que en una página no está
  // en esa ruta: lo que se convierte conserva el aspecto de la página.
  .replace(/\n\nMORE, IN [\s\S]*$/, "")
  // Los mapas y vídeos se dicen igual que en la página, que ya los dice: dos
  // veces la misma regla es una de más (prompts-superficies.test.ts). Tras
  // convertir, el manual de la app la trae.
  .replace(/\n• MAPS and VIDEOS[^\n]*/, "")}`;
}

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
// ─── Edge Functions (spec local 2026-10-11, Parte 1) ──────────────────────────
// Sólo donde hay motor: la frase de «no existen» cambia y sus líneas van dentro
// de THE BACKEND, tras las de Realtime. El manual de la app copia esa sección
// entera (`elBackend`, modo-app.ts), así que les llega igual. Estable por
// servidor: no rompe la caché del prompt.
const SIN_FUNCIONES = "Edge Functions don't exist here yet: if something needs them, say so.";
const CON_FUNCIONES = "It also runs the project's Edge Functions (below).";
const LINEA_DE_REALTIME = "\n- Live updates go through Realtime";

// LA IA DE LAS APPS (spec local 2026-10-15, 4.7): sólo con su puerta encendida,
// dentro de las líneas de las funciones (las llama una función, nunca la página).
const LINEA_DE_IA =
  "- AI from a function, with no key of your own: POST `${SUPABASE_URL}/ai/v1/chat/completions` with `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` and OpenAI's chat format (the `openai` package pointed at `${SUPABASE_URL}/ai/v1` works too)." +
  " Two models: `openlen-fast` answers without thinking —sort, classify, extract, summarize; use it unless the task needs reasoning— and `openlen-smart` thinks first and costs more." +
  " Text only; `response_format: { type: \"json_object\" }` for JSON (a json_schema is not enforced: validate what comes back); `stream: true` for a chat." +
  " It is server-only: never call it from the page and never send the key to the browser." +
  " Every call spends the owner's credits, within a monthly limit for all their apps together: a 402 (no credits, or the limit reached), 429 or 503 means no AI right now, and the app must keep working without it —save the text as it came, show the plain form— instead of failing.";

// STRIPE (spec local 2026-10-21-stripe-integration, §6.8): only with Stripe on, inside the
// functions' lines. It is OpenLen's contract with Stripe —the key, the `stripe` command, what
// publishing does—, documented because the model can't guess it.
const LINEA_DE_STRIPE =
  "- Stripe, with the owner's own account: ask for the key with request_secrets with the name STRIPE_SECRET_KEY —a test key for the draft, a live one for the published site; never in the chat." +
  " Then use `stripe` in the terminal, with the Stripe CLI's syntax (`stripe products create --id=… --name=…`, `stripe prices create --product=… --unit-amount=2900 --currency=usd --lookup-key=…`, `stripe payment_links create -d \"line_items[0][price]=…\" -d \"line_items[0][quantity]=1\"`, `stripe get /v1/…`): it works in test mode with the draft's key, and --live only reads production." +
  " Register a webhook with `stripe webhook_endpoints create --url=<draft_url><function> --enabled-events=…`: its signing secret is saved by itself for the draft as STRIPE_WEBHOOK_SECRET (the output says the exact name), and `stripe trigger <event>` sends it a test event." +
  " Test cards: 4242 4242 4242 4242 pays, 4000 0000 0000 3220 asks for 3D Secure, 4000 0000 0000 0002 is declined (any future date, any CVC)." +
  " Publishing copies to live mode the products, prices, payment links, shipping rates, portal configurations and webhook endpoints the project uses, and the published site gets their live ids and links: in code, a price by its lookup key or by its id both work." +
  " Checkout and payment links open outside the canvas, in a new tab. The customer portal needs a configuration created with `stripe billing_portal configurations create`, passed as `configuration`, or turned on once in the owner's Stripe dashboard.";

// PROJECT EMAIL (spec local 2026-10-22-email-integration, 6.8): only with the email on, inside the
// functions' lines like Stripe's (an app's emails go from a function). OpenLen's contract —the
// gateway behind Resend's own SDK, the domain's card, the rules—, which the model can't guess.
const LINEA_DEL_CORREO =
  "- Email from the project's own domain, on paid plans (PROJECT STATE's `email`): if `email.status` is `none`, call connect_email_domain and the owner connects it in a card; until it is `ready`, emails go from OpenLen." +
  " From a function, use Resend's SDK exactly as Resend documents it —`new Resend(Deno.env.get(\"RESEND_API_KEY\"))` and `resend.emails.send({ from: Deno.env.get(\"OPENLEN_EMAIL_FROM\"), to, subject, html })`—: the functions already have RESEND_API_KEY and RESEND_BASE_URL, which go through OpenLen, and OPENLEN_EMAIL_FROM once the domain is ready; don't ask the user for a Resend key. For a designed email, write the function as index.tsx with a React Email template (`import { Html, Body, Heading, Text, Button } from \"npm:react-email\"`) and send it with `react: <Template … />` instead of `html`." +
  " Only service emails someone asked for or expects (an order, a booking, a reminder), never promotions; clear subjects; links only to the project's own sites; no attachments, cc or bcc. In the draft they only reach the project's team (the owner and the members), so test with their addresses. Refusals come back as Resend's errors (a 429 is the hourly limit, or the month without credits: explain it, don't retry)." +
  " The sign-in emails use the project's Supabase templates: `[auth.email.template.<confirmation|recovery|invite|magic_link>]` with `subject` and `content_path` in /supabase/config.toml, an HTML file with {{ .ConfirmationURL }} or {{ .Token }}." +
  " A form's automatic reply to whoever filled it is set with set_form_auto_reply.";

// SHOPIFY WITHOUT A KEY (spec local 2026-10-22-shopify-storefront, §6.7): with Shopify on, in
// pages and apps, with or without the functions. Shopify's own Storefront Web Components (a
// page) and Storefront API, plus what OpenLen adds: the connection, the canvas's checkout and
// the rules. An app has no <script> tags to add: it goes through the API. What differs goes in
// its own "- In the page" / "- In the app" line, like the backend's.
const SHOPIFY_LINE =
  "- Shopify, the owner's existing store (PROJECT STATE's `shopify`): if the user talks about their Shopify store and there is no `shopify`, call connect_shopify_store with its domain." +
  " Products, prices, photos and stock come from Shopify live: never copy them into the page as text, and never guess a handle: read it with `curl` in the terminal (POST GraphQL to `storefront_api`, without a key)." +
  " Without a key there is no `quantityAvailable`, tags come back empty, and there are no metafields or customers: use `availableForSale` for sold out." +
  " In the canvas the checkout opens in a new tab; when you try the cart with use_page, never fill in or pay Shopify's checkout. If the store changes, update the pages that use the old one.";
const SHOPIFY_IN_THE_PAGE =
  '- In the page, sell from the Shopify store with Shopify\'s Storefront Web Components: `<script src="https://cdn.shopify.com/storefront/web-components.js"></script>`, `<shopify-store store-domain="https://<store_domain>" country="<country>">`, then `<shopify-context type="product" handle="…">` or `<shopify-list-context type="product" query="products" first="12">` around a `<template>` you design (`<shopify-data query="product.title">`, `<shopify-money query="product.selectedOrFirstAvailableVariant.price">`, `<shopify-media query="product.selectedOrFirstAvailableVariant.image">`, `<shopify-variant-selector>`), and `<shopify-cart id="cart">` with `onclick="getElementById(\'cart\').addLine(event).showModal()"` (or `buyNow(event)` on `<shopify-store>`); style the cart with `shopify-cart::part(…)` and its slots.' +
  " For anything else, `fetch` the Storefront API from the page.";
const SHOPIFY_IN_THE_APP =
  "- In the app, sell from the Shopify store through the Storefront API without a key: POST GraphQL to `storefront_api` with `fetch`, and its Cart API (`cartCreate`, `cartLinesAdd`) ending in the cart's `checkoutUrl`.";

/** The manual with the Shopify lines, after Realtime's (where the functions' lines also go), or at the end. */
function conShopify(manual: string, app: AppDeProyecto | null): string {
  const line = `${SHOPIFY_LINE}\n${app ? SHOPIFY_IN_THE_APP : SHOPIFY_IN_THE_PAGE}`;
  const i = manual.indexOf(LINEA_DE_REALTIME);
  const fin = i === -1 ? -1 : manual.indexOf("\n", i + 1);
  return fin === -1 ? `${manual}\n${line}` : `${manual.slice(0, fin)}\n${line}${manual.slice(fin)}`;
}

function lineasDeFunciones(env: Readonly<Record<string, string | undefined>>): string {
  const catalogo = functionsCatalog(FUNCTIONS_CATALOG_CURRENT)!
    .dependencies.map((d) => `\`npm:${d.name}\` (${d.for.replace(/\.$/, "")})`)
    .join(", ");
  return [
    `- Edge Functions, the Supabase way: each one is /supabase/functions/<name>/index.ts with \`Deno.serve(async (req) => …)\` (a name that starts with a letter and has only letters, digits, - and _; up to ${MAX_FUNCTIONS}).` +
      " Code they share goes in /supabase/functions/_shared/. Every save redeploys the draft a few seconds later; `supabase functions deploy` does it now and waits, and `supabase functions list` shows what is deployed where.",
    `- Their imports come only from the functions catalog: ${catalogo}; also as \`jsr:\` or \`https://esm.sh/\` URLs of those same packages, plus \`node:*\`. Anything else is a compile error with its file and line.`,
    "- They already have SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (and SUPABASE_PUBLISHABLE_KEYS and SUPABASE_SECRET_KEYS) for THEIR environment: the draft's functions use the test database, the published site's use production. There is no SUPABASE_DB_URL.",
    "- Secrets —API keys, webhook signing secrets— are read with `Deno.env.get(\"NAME\")`. Ask the user for them with request_secrets: never in the chat and never in a file. A value you generate yourself (a random token) can go to the draft with `supabase secrets set NAME=value`; production values are set only by the user, and the publish card asks for any that are missing.",
    "- From the page: `supabase.functions.invoke(\"name\", { body })`. Try one from the terminal with `curl -i` on the draft URL that PROJECT STATE gives you under `edge_functions`, plus its name; use_page and view_page report the calls the page made, with their logs and errors.",
    "- A function needs the user's JWT or the project's key in Authorization unless `verify_jwt` is off: a webhook (Stripe, Mercado Pago) needs `[functions.<name>]` with `verify_jwt = false` in /supabase/config.toml (or `supabase functions deploy <name> --no-verify-jwt`). Check Stripe's signature on the raw text body with `stripe.webhooks.constructEventAsync(body, signature, secret, undefined, Stripe.createSubtleCryptoProvider())`.",
    `- Limits: ${FUNCTION_MEMORY_MB} MB of memory; per call, ${FUNCTION_LIMITS.free.cpuMs} ms of CPU and ${FUNCTION_LIMITS.free.timeoutSec} s in total on the Free plan, ${FUNCTION_LIMITS.pro.cpuMs} ms of CPU and ${FUNCTION_LIMITS.pro.timeoutSec} s on paid plans (waiting for another service doesn't count as CPU; going over it ends the call with a 546 WORKER_RESOURCE_LIMIT); ${MAX_REQUEST_BYTES / 1024 / 1024} MB per request body. Publishing compiles them for production, and if they don't compile nothing is published. A 429 means the project used its calls for the month, has too many at once, or too many from one visitor: explain it to the user; don't retry.`,
    ...(appAiEnabledIn(env) ? [LINEA_DE_IA] : []),
    ...(stripeEnabledIn(env) ? [LINEA_DE_STRIPE] : []),
    ...(emailEnabledIn(env) ? [LINEA_DEL_CORREO] : []),
  ].join("\n");
}

/** El manual con las Edge Functions de este servidor. Sin la frase o sin la
 *  línea de Realtime (otro manual), tal cual. */
export function conEdgeFunctions(manual: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const i = manual.indexOf(LINEA_DE_REALTIME);
  if (i === -1 || !manual.includes(SIN_FUNCIONES)) return manual;
  const fin = manual.indexOf("\n", i + 1);
  const conLineas = fin === -1 ? `${manual}\n${lineasDeFunciones(env)}` : `${manual.slice(0, fin)}\n${lineasDeFunciones(env)}${manual.slice(fin)}`;
  return conLineas.replace(SIN_FUNCIONES, CON_FUNCIONES);
}

// LA TERMINAL REAL (plan local 2026-10-21-playwright-in-the-box): with the box, a page's /tests run.
const TESTS_NOT_RUN =
  "- /tests holds Playwright tests, which are not run here (there is no Playwright in the terminal): they are kept, never published, and they go with the project when it is exported. Checking the page here is view_page and use_page.";
const TESTS_RUN =
  '- /tests holds Playwright tests, and `npx playwright test` runs them in this computer\'s Chromium (Playwright is installed: import from "@playwright/test", don\'t install it) against the saved draft, whose address is in `$BASE_URL`: put `use: { baseURL: process.env.BASE_URL }` in /playwright.config.ts. A test works with the draft\'s data; it can read the published page but never writes to it. Screenshot comparisons (toHaveScreenshot) can\'t be kept: only text files are saved. The tests are kept, never published, and they go with the project when it is exported. Looking at the page is still view_page and use_page.';

export function buildManualDeLaPlataforma(
  env: Readonly<Record<string, string | undefined>> = process.env,
  mode: AgentMode = "len",
  app: AppDeProyecto | null = null,
  /** Whether this turn's terminal is the box (`realTerminalFor` its owner, as bash's description). */
  realTerminal: boolean = realTerminalFor(null, env),
): string {
  const page = partirElManual().agents;
  const base = app ? manualDeLaApp(manualSinPartir(), app) : realTerminal ? page.replace(TESTS_NOT_RUN, TESTS_RUN) : page;
  const withFunctions = functionsEnabledIn(env) ? conEdgeFunctions(base, env) : base;
  const agents = shopifyEnabledIn(env) ? conShopify(withFunctions, app) : withFunctions;
  const withArtifacts = env.OPENLEN_ARTIFACTS === "1" ? `${agents}\n\n${ARTIFACT_MANUAL_INDEX}` : agents;
  return terminalOnly(mode, env) ? paraSoloLaTerminal(withArtifacts) : withArtifacts;
}

/** Los ficheros de /.openlen/docs, por su ruta. Una app tiene su guía de
 *  diseño en la MISMA ruta, y no tiene la de las librerías de las páginas
 *  (sus paquetes son los de su catálogo, en /AGENTS.md). La guía para
 *  convertir lleva el backend de la app: con motor, también sus Edge Functions,
 *  como el manual. */
export function documentosDeLaPlataforma(
  app: AppDeProyecto | null = null,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<Record<string, string>> {
  const artifacts = env.OPENLEN_ARTIFACTS === "1" ? artifactManuals : {};
  if (app) return { [RUTA_GUIA]: GUIA_DE_LA_APP, ...artifacts };
  const convertir = manualParaConvertir();
  return { ...partirElManual().docs, [RUTA_APPS]: functionsEnabledIn(env) ? conEdgeFunctions(convertir, env) : convertir, ...artifacts };
}

/** El texto de un fichero del manual por su ruta, o `null` si no es ninguno. */
export function textoDeLaPlataforma(
  ruta: string,
  mode: AgentMode = "len",
  app: AppDeProyecto | null = null,
  realTerminal: boolean = realTerminalFor(null),
): string | null {
  if (ruta === RUTA_MANUAL) return buildManualDeLaPlataforma(process.env, mode, app, realTerminal);
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
