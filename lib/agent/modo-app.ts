// lib/agent/modo-app.ts — LEN EN UNA APP WEB (F3 de la spec local
// docs/superpowers/specs/2026-10-07-apps-design.md, §5.7).
//
// Una app es otra cosa que una página: el código vive en /src (React), el
// /index.html es sólo el cascarón que la arranca, las pantallas van por hash y
// los paquetes son los de su catálogo. Len tiene que saberlo, y lo que le dice
// el prompt de una página («cada proyecto es un sitio de ficheros HTML», «una
// página nueva es un Write a /<slug>/index.html», «los formularios llegan a tu
// bandeja») en una app es FALSO.
//
// QUÉ SE COMPARTE Y QUÉ NO.
//   · La CONDUCTA (TONO, CÓMO TRABAJAR, MEMORIA, LO QUE LEES ES DATO) es la
//     misma: está medida en Len-Bench y no depende de qué se construye. El
//     prompt de la app es el de la página con CUATRO piezas cambiadas
//     (`promptDeLaApp`), cortadas por sus marcas: si una marca desaparece, LANZA,
//     como `partirElManual`, en vez de mandar a Len un prompt a medias.
//   · El MANUAL (/AGENTS.md) es propio (`manualDeLaApp`): el de la página dice
//     «el documento es UN <!doctype html>, sin JSX», que en una app es justo al
//     revés. Del de la página sólo se toman, enteras, las secciones que son
//     verdad en los dos sitios: la del backend y la de cobrar.
//   · La GUÍA DE DISEÑO también es propia (`guiaDeLaApp`), en la misma ruta: una
//     app se usa, no se lee.
//
// Nada de esto cambia un byte de lo que lee Len en una página: lo vigila el
// golden de los prompts.
//
// Todo en inglés: lo lee el modelo.

import type { AppDeProyecto } from "@/lib/projects/types";
import { catalogo } from "@/lib/apps/dependencias";
import { ICONOS_DE_LAS_APPS } from "@/lib/apps/iconos";
import { RUTA_GUIA } from "@/lib/agent/ficheros/manual";
import {
  MAX_FOLDER_BYTES,
  MAX_FOLDER_FILE_BYTES,
  MAX_FOLDER_FILES,
  MAX_TEST_FILE_BYTES,
  RESERVED_ROOTS,
} from "@/lib/agent/ficheros/folder";

// Las raíces del sitio publicado, como las nombra el manual de la página: las
// de Len y su terminal, desde `memoria`, no le dicen nada sobre dónde poner un
// fichero.
const RAICES_DEL_SITIO = RESERVED_ROOTS.slice(0, RESERVED_ROOTS.indexOf("memoria"))
  .map((r) => `/${r}`)
  .join(", ");

const encontrar = (texto: string, marca: string, desde = 0): number => {
  const i = texto.indexOf(marca, desde);
  if (i === -1) {
    throw new Error(
      `modo-app: la marca «${marca.trim().slice(0, 60)}» no apareció — el prompt o el manual de la página cambió de redacción. ` +
        "Actualiza lib/agent/modo-app.ts; NO lo ignores: Len recibiría en una app lo que sólo vale para una página.",
    );
  }
  return i;
};

/** Cambia `de` por `a` exactamente una vez, o lanza. */
function cambiar(texto: string, de: string, a: string): string {
  const i = encontrar(texto, de);
  return texto.slice(0, i) + a + texto.slice(i + de.length);
}

/** Cambia el bloque que empieza en `desde` y acaba justo antes de `hasta`. */
function cambiarBloque(texto: string, desde: string, hasta: string, por: string): string {
  const i = encontrar(texto, desde);
  const j = encontrar(texto, hasta, i + desde.length);
  return texto.slice(0, i) + por + texto.slice(j);
}

// ─── El prompt de sistema ───────────────────────────────────────────────────

const APERTURA_DE_PAGINA =
  "OpenLen builds and publishes websites: each project is a site made of HTML files that is published exactly as it is, and you edit it on behalf of whoever is talking to you.";
const APERTURA_DE_APP =
  "OpenLen builds and publishes websites and web apps. THIS project is a web app: React code in /src that OpenLen compiles and publishes as it is, and you build it on behalf of whoever is talking to you.";

const COMO_LA_PAGINA =
  "What you add to a page that already exists is written the way that page is written —its colors, its font and its classes—, just as new code is written like the code around it.";
const COMO_LA_APP =
  "What you add to the app is written the way the app is written —its components, its file layout, its names, its Tailwind classes and its colors—, just as new code is written like the code around it.";

const PROBAR_LA_PAGINA =
  'If you change the page, test it before you call it done. What it DOES —a button, a form, a calculation, something that is saved or changes when clicked—, use it with usar_pagina: the path the user asked for and some odd case (an empty or wrong value, reloading the page). What it SHOWS —a section, a new page—, look at it with mirar_pagina tipo="medir", which is free and tells whether something overflows on mobile. And check that the rest of the page is still as it was.';
const PROBAR_LA_APP =
  'If you change the app, test it before you call it done. What it DOES —a button, a form, a calculation, something that is saved or changes when clicked—, use it with usar_pagina: the path the user asked for and some odd case (an empty or wrong value, reloading the app). What it SHOWS —a screen, a list, a total—, look at it with mirar_pagina tipo="medir", which is free and tells whether something overflows on mobile. And check that the screens you didn\'t touch still work.';

const LA_APP_SON_FICHEROS = (entrada: string) => `THE APP IS FILES:
/index.html is only the shell that starts the app: its <head> (<title>, the <meta> tags, the fonts) and the <div id="root"> plus <script type="module" src="${entrada}"> that it must keep. The app itself lives in /src: ${entrada} mounts it, /src/App.jsx holds its routes, each screen goes in its own file under /src/screens and each component under /src/components, and /src/lib/supabase.js exports the backend client. Read to read, Edit to change an exact piece, Write to create a new file or rewrite a whole one, Grep to search the whole site and Glob to list files. PROJECT STATE lists the app's files; the files themselves don't come in your context, so whatever you say about the code —what it has, what it lacks, what its parts are called— comes from having read it in this conversation: otherwise, read it first or don't describe it.
- There is no npm and no build to run: you write the files and OpenLen compiles each one as it is served. Imports work as in Vite (relative, "@/" for /src, without extension, CSS and JSON), and packages are only the ones listed in /AGENTS.md; anything else is written in the project.
- After each Edit or Write the change is ALREADY saved and the user sees the app running on their canvas. If a file doesn't compile, the <new-diagnostics> give you its file, its line and why, and the app stays blank until you fix it: fix it in this turn. Every change is also kept: the user goes back from the editor, so never tell them that no copies are kept.
- Screens are hash routes (/#/sales): a new screen is a component and a <Route> in /src/App.jsx, and you reach it with <Link to="/sales">. Never a /<slug>/index.html: that would be a separate static page, outside the app.
- 🔴 A CHANGE GOES THROUGH EVERY FILE THAT DEPENDS ON IT, and only those: a renamed prop or component, a removed field, a column that changes in a table — search for every use with Grep before changing it and change them all in the same turn, migration included when the data changes. A file left behind breaks the app at runtime, in a screen you didn't look at. <example>user: "call it 'stock' instead of 'quantity'" — agent: searches for quantity with Grep across /src and /supabase, writes a migration that renames the column, and changes every component that reads or writes it.</example>
- "Undo that" is handled with revertir_ultimo_cambio, which undoes your previous turn whole, never by editing backwards from memory.`;

const LO_QUE_PUEDE_LA_PAGINA_INICIO = "- What a page can do is not limited by your list of tools but by whether it needs a server.";
const LO_QUE_PUEDE_LA_APP =
  "- What the app can do is not limited by your list of tools but by whether it needs a server of its own. Everything that runs in the browser, and everything its backend's database, Auth, Storage and Realtime can do, you build: including what has to happen all at once (selling and taking the items out of stock, booking a slot nobody else can take), which is a Postgres function in a migration, called with supabase.rpc. What needs a secret key or a server of its own —charging a card inside the app, sending emails or WhatsApps, calling another service's API with a key— doesn't exist here yet: say so in one sentence and build the rest.";

const SUS_DATOS_EN_LA_APP = `THEIR DATA AND THEIR LINKS:
What the app shows about THEIR business —their products, their prices, their menu, their customers, their stock, their opening hours, their phone, which account a link points to— is never invented or guessed, because it looks true. Their records live in the app's database: they give them to you (ask_user_question), or they enter them in the app themselves, so the app has the screens to add and change them. If the app needs some records to be tried out, add a few that are obviously examples (named as such), and say so when you finish. Their phone, WhatsApp, social profiles and address go in the code only if they give them to you. <example>user: "make me a POS for my coffee shop" — agent: builds the products table, the sale screen and the screen to add products, adds two products named "Example product", and when it finishes asks for their real menu and prices; it never fills the menu with prices it made up.</example>`;

/** El prompt de sistema de una app, desde el de la página. */
export function promptDeLaApp(promptDePagina: string, app: AppDeProyecto): string {
  let p = cambiar(promptDePagina, APERTURA_DE_PAGINA, APERTURA_DE_APP);
  p = cambiar(p, COMO_LA_PAGINA, COMO_LA_APP);
  p = cambiar(p, PROBAR_LA_PAGINA, PROBAR_LA_APP);
  p = cambiarBloque(p, "THE SITE IS FILES:\n", "\n\nWHAT EXISTS AND WHAT DOESN'T:\n", LA_APP_SON_FICHEROS(app.entrada));
  // La viñeta de lo que puede una página es UNA línea: se cambia entera.
  const i = encontrar(p, LO_QUE_PUEDE_LA_PAGINA_INICIO);
  const fin = encontrar(p, "\n", i);
  p = p.slice(0, i) + LO_QUE_PUEDE_LA_APP + p.slice(fin);
  p = cambiarBloque(p, "THEIR DATA AND THEIR LINKS:\n", "\n\nMEMORY IS TWO FILES", SUS_DATOS_EN_LA_APP);
  return p;
}

// ─── El manual (/AGENTS.md) ─────────────────────────────────────────────────

/** Los iconos por su nombre de siempre, para dar una idea de la selección. */
const ALGUNOS_ICONOS = ["Plus", "Minus", "Trash2", "Pencil", "Search", "X", "Check", "ShoppingCart", "Receipt", "Printer", "Users", "Settings", "LogOut", "Calendar", "Package"];

function seccionDeLaApp(app: AppDeProyecto): string {
  const c = catalogo(app.catalogo);
  const paquetes = (c?.dependencias ?? []).map((d) => `  · ${d.especificador} — ${d.para}`).join("\n");
  return `THIS PROJECT IS A WEB APP:
React in /src —.jsx, .tsx, .ts or .js— that OpenLen serves and publishes as it is. There is no bundler, no npm and no build: each file is compiled on its own (JSX and TypeScript to JavaScript, at the same path and keeping its line numbers) and the browser joins them through their imports.
- /index.html is the shell: its <head> (<title>, <meta>, the Tailwind and Google Fonts tags, a <style> of your own) and, in its <body>, <div id="root"> and <script type="module" src="${app.entrada}">. Without those two the app doesn't start. The app itself never goes in it.
- ${app.entrada} mounts the app (createRoot(document.getElementById("root")).render(…)) inside <HashRouter>; /src/App.jsx holds the routes; each screen goes in /src/screens and each component in /src/components, one per file; /src/lib/supabase.js exports the backend client.
- IMPORTS work as in Vite: "./x", "../x", "/src/x" and "@/x" (= /src/x), with or without extension, or a folder's index; import "./x.css" adds that stylesheet; import data from "./x.json". import.meta.env has VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (also as VITE_SUPABASE_ANON_KEY), MODE, DEV and PROD: public values only — a secret never goes in the code.
- PACKAGES, the only ones (catalog ${app.catalogo}):
${paquetes}
  Nothing else can be installed, because there is no npm here: anything else is written in the project. A package or an export that isn't there is a compile error that names the closest ones.
- ICONS: lucide-react has a selection of ${ICONOS_DE_LAS_APPS.length} icons, the usual ones for an app (${ALGUNOS_ICONOS.join(", ")}…), by their current name or their old one, with or without the Icon suffix. If one isn't there, the compiler says so and suggests the closest; or draw it as an inline <svg>.
- SCREENS are hash routes: <HashRouter> (in ${app.entrada}) with <Routes> and <Route path="/sales" element={<Sales />} />, <Link to="/sales">, useNavigate() and useParams(). The address is /#/sales. BrowserRouter, createBrowserRouter and the data routers (loaders, actions) don't exist here: a path without # breaks when the published app is reloaded. Never write a /<slug>/index.html in an app: it would be a static page outside it.
- STYLES are Tailwind classes in className, written WHOLE. When publishing, OpenLen builds the CSS from the classes that appear in the files, so a class assembled in pieces (\`bg-\${color}-500\`) is missing from the published app even though it worked on the canvas. To vary one, choose between whole names: ok ? "bg-green-600" : "bg-red-600". Your own CSS goes in a .css file imported from ${app.entrada}, or in the shell's <style>.
- ERRORS: a file that doesn't compile comes back in <new-diagnostics> with its file and line, and is NOT served: the app is blank until it is fixed. What fails while the app runs (mirar_pagina, usar_pagina and the checks after each turn) comes with the error's message and, when the browser gives it, the file and line of the source. The canvas and your checks run React's development build, with its whole error messages; the published app, the production one.
- There is no StrictMode: each effect runs once, as in the published app.`;
}

/** Lo que es verdad en una app de lo que dice el manual de la página sobre
 *  cobrar y sobre la respuesta de supabase-js. Se toma ENTERO de ahí. */
function cobrarYComprobar(manualDePagina: string): string {
  const i = encontrar(manualDePagina, "CHARGING IS POSSIBLE");
  const fin = encontrar(manualDePagina, "\n", i);
  return manualDePagina.slice(i, fin).split("ON THE PAGE").join("IN THE APP");
}

const LO_QUE_EXISTE = (manualDePagina: string) => `WHAT EXISTS AND WHAT DOESN'T:
- What is saved with localStorage SURVIVES closing the tab and the browser; what it doesn't do is travel to another device, another person or the user. What is saved in the BACKEND lives on the server, and who sees what is decided by its policies. Telling them "it's saved in the browser" about something you saved in the backend is lying to them.
- ${cobrarYComprobar(manualDePagina)}
- An app's forms don't reach the user's email or their Inbox (that is for the forms of a page): what a form in the app sends goes where your code sends it, usually a table, and the user sees it in the app or in the Database view.
- WHAT REALLY CAN'T BE DONE YET: anything that needs a server of its own or a secret key —charging a card INSIDE the app, sending emails, SMS or WhatsApps on your own, calling another service's API with a key, jobs that run on a schedule—. What has to happen all at once IS possible: a Postgres function in a migration (\`create function sell(...) ... language plpgsql\`), called with \`supabase.rpc('sell', { ... })\`, runs as one transaction.`;

const LOS_ENLACES = `LINKS:
- The URLs they give you are their real data: they go into the href VERBATIM and ABSOLUTE ("instagram.com/juan" or "@juan" are completed to https://instagram.com/juan); mailto: and tel: are fine too.
- Between screens, <Link to="/route"> or href="#/route"; never a path without # ("/route"), which on the published app falls back to the start.`;

const LA_CARPETA = (app: AppDeProyecto) => `THE PROJECT'S FOLDER:
Besides /src, the folder takes any other text file —/data/*.json, /manifest.json, /sw.js, images as .svg— anywhere except the reserved roots (${RAICES_DEL_SITIO}), and publishing ships them next to the app. /tests holds Playwright tests (never published); /supabase holds the backend's migrations.
- mirar_pagina, usar_pagina and the checks after each turn run the app the way it is published, starting at ${app.entrada}. Their browser does not run service workers: offline mode cannot be checked there — say so instead of claiming it works.
- Up to ${MAX_FOLDER_FILES} files and ${MAX_FOLDER_BYTES / 1024 / 1024} MB; ${MAX_FOLDER_FILE_BYTES / 1024 / 1024} MB per file (${MAX_TEST_FILE_BYTES / 1024} KB per test file).`;

const EN_LA_PAGINA_SUPABASE_INICIO = "- In the page, supabase-js as usual:";
const EN_LA_APP_SUPABASE =
  '- In the app, the client is created once in /src/lib/supabase.js, with createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY), and every file takes it from there: import { supabase } from "@/lib/supabase". The publishable key is meant to be in the code; a secret key, never.';

/** La sección del backend del manual de la página, entera, con la línea de
 *  cómo se carga supabase-js dicha para una app. */
function elBackend(manualDePagina: string): string {
  const i = encontrar(manualDePagina, "THE BACKEND (Supabase):");
  const j = encontrar(manualDePagina, "\n\nDESIGN GUIDE (", i);
  const seccion = manualDePagina.slice(i, j);
  const k = encontrar(seccion, EN_LA_PAGINA_SUPABASE_INICIO);
  const fin = encontrar(seccion, "\n", k);
  return seccion.slice(0, k) + EN_LA_APP_SUPABASE + seccion.slice(fin);
}

const QUE_PIDE_PUBLICAR = `WHAT PUBLISHING REQUIRES:
• The shell keeps Tailwind via CDN (\`<script src="https://cdn.tailwindcss.com"></script>\`) and the Google Fonts stylesheets in its <head>; when publishing, OpenLen replaces the CDN with the compiled CSS.
• Illustrations and logos: inline SVG, with className="max-w-full h-auto". Icons: lucide-react.
• No external image URL (unsplash, picsum, placehold.co…), not even one that comes in the request: a server we don't control is a 404 on the published app. The photos the user uploads or that elegir_foto gives you are fine.
• MAPS and VIDEOS are <iframe>s, as in a page: \`https://maps.google.com/maps?q=<address>&output=embed\`, \`https://www.youtube.com/embed/<ID>\` — and a video ONLY if they give you the link.`;

const INDICE_DE_LA_APP = `MORE, IN /.openlen/docs (read them when you need them):
- ${RUTA_GUIA}: the design guide for an app —what it opens on, its states, its numbers, color and type—; read it BEFORE building an app from scratch or a redesign. What you add to an app that already exists is written the way that app is.`;

/** /AGENTS.md de una app, antes de las palancas de la terminal. */
export function manualDeLaApp(manualDePagina: string, app: AppDeProyecto): string {
  return [
    "# OpenLen: how the platform works",
    seccionDeLaApp(app),
    LO_QUE_EXISTE(manualDePagina),
    LOS_ENLACES,
    LA_CARPETA(app),
    elBackend(manualDePagina),
    QUE_PIDE_PUBLICAR,
    INDICE_DE_LA_APP,
  ].join("\n\n");
}

// ─── La guía de diseño (/.openlen/docs/guia-de-diseno.md) ───────────────────

export const GUIA_DE_LA_APP = `DESIGN GUIDE (for the apps you create yourself and for a redesign you are asked for; what you add to an app that already exists is written the way that app is):
AN APP IS USED, NOT READ
• It opens on what the person came to do: a POS on the sale, an agenda on today, a CRM on the list. No hero, no marketing sections, no footer full of links.
• Every action within reach and big enough for a finger: buttons and rows at least 44 px tall. ONE main action per screen, and it is obvious.
• Every list and every call to the backend has its three states drawn: loading, empty (with what to do next: "No products yet — add the first one") and error (what went wrong and a way to retry). A blank screen while data loads is a bug.
• Numbers that are compared or added up line up: \`tabular-nums\`, right-aligned in tables. Money always with its currency and two decimals, and computed in cents.
• A form says what is wrong next to the field, keeps what was typed, and disables its button while it sends. What destroys (deleting, emptying a cart) asks first; what is saved says so.
• Readable and usable from 360 px wide; on a wide screen the space is used (a side menu, two columns), not stretched.

COLOR, SHAPE AND TYPE
• Tailwind's palette and scale, as whole classes. ONE accent for the main actions and the active state; the rest neutral. Green, amber and red only for success, warning and error.
• Depth: raised surfaces separate from the background with a soft shadow or a hairline border at low alpha, never a bright border.
• Type: one family for the interface (Inter, IBM Plex Sans, Manrope…), loaded from Google Fonts in the shell, and a display one only if the brand asks for it. Icons from lucide-react, all the same size (h-4 w-4 or h-5 w-5).
• ONE mode —light or dark— chosen by where it is used (a bar or a kitchen at night, dark; a shop counter, light). No theme switch unless they ask for one.`;

// ─── Las herramientas ────────────────────────────────────────────────────────

/** El parámetro con el que se abre una pantalla de la app (H6: van por hash). */
export const PARAMETRO_PANTALLA = {
  type: "STRING",
  description: 'Optional: the screen to open, as its hash route, e.g. "#/sales". Without it, the app opens at its start ("#/").',
};

const REVERTIR_EN_LA_APP =
  'Undoes your PREVIOUS turn whole: every file it changed goes back to how it was before it. If the user changed one of those files afterwards, it undoes nothing and tells you which, so their work is never lost; the database is not undone (a migration that was pushed stays: undoing it is a new migration). "Undo that" or "put it back the way it was" is this, NEVER editing backwards from memory. Afterwards, read the files before editing them again.';

const PUBLICAR_EN_LA_APP =
  " An app is published as it is, without translations; if any file doesn't compile it isn't published, and this tool tells you what to fix first.";

/**
 * Las declaraciones de una app, desde las de la página: las mismas herramientas
 * (la caché del prefijo no cambia entre turnos de un mismo proyecto) con lo que
 * en una app es distinto.
 *   · `mirar_pagina` y `usar_pagina`: no hay páginas que elegir, hay pantallas
 *     (`pantalla`, una ruta de hash) — `file_path` se va.
 *   · `revertir_ultimo_cambio` deshace el TURNO anterior entero (F2), no la
 *     última versión de una página: en una app un turno toca cinco ficheros.
 *   · `publicar` sin `idiomas`: la traducción automática no ve el texto que
 *     vive en el JSX (H15), y aceptarlos sería prometer lo que no se hace.
 */
/** Las herramientas que `declaracionesDeLaApp` cambia, por su nombre. Si una se
 *  renombra en el catálogo y aquí no, la app la recibiría como la de una página
 *  SIN QUE NADA FALLE: lo vigila `modo-app.test.ts` («los nombres que usa»). */
export const HERRAMIENTAS_QUE_CAMBIAN_EN_UNA_APP = ["mirar_pagina", "usar_pagina", "revertir_ultimo_cambio", "publicar"] as const;

export function declaracionesDeLaApp(declaraciones: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return declaraciones.map((d) => {
    const parametros = d.parameters as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    const sinFilePath = () => {
      const { file_path: _fuera, ...resto } = parametros?.properties ?? {};
      return { ...d, parameters: { ...parametros, properties: { ...resto, pantalla: PARAMETRO_PANTALLA } } };
    };
    switch (d.name) {
      case "mirar_pagina":
      case "usar_pagina":
        return sinFilePath();
      case "revertir_ultimo_cambio":
        return { ...d, description: REVERTIR_EN_LA_APP, parameters: { type: "OBJECT", properties: {} } };
      case "publicar": {
        const { idiomas: _fuera, ...resto } = parametros?.properties ?? {};
        return { ...d, description: `${String(d.description)}${PUBLICAR_EN_LA_APP}`, parameters: { ...parametros, properties: resto } };
      }
      default:
        return { ...d };
    }
  });
}
