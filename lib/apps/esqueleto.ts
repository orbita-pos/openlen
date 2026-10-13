// lib/apps/esqueleto.ts — CON LO QUE NACE UNA APP (H10 de la spec local
// docs/superpowers/specs/2026-10-07-apps-design.md).
//
// Una app no se escribe en UNA llamada como una página: son varios ficheros.
// Nace de este esqueleto de la plataforma —que ya arranca, compila y se ve— y de
// un turno de Len con el brief, que lo convierte en la app pedida. Así el
// primer turno de Len no empieza por el andamiaje (el cascarón, el montaje, el
// router, el cliente del backend), que es lo que más fácil sale mal y lo que
// siempre es igual.
//
// LO QUE TRAE, y por qué:
//   · /index.html, el CASCARÓN: Tailwind por CDN (se hornea al publicar), una
//     familia de Google Fonts, `#root` y el `<script type="module">` de la
//     entrada. Nada más: la app vive en /src.
//   · /src/main.tsx monta la app dentro de `<HashRouter>`: las pantallas van
//     por hash (H6), y así ya está puesto donde tiene que estar.
//   · /src/App.tsx, las rutas; /src/screens/Inicio.tsx, la primera pantalla.
//   · /src/lib/supabase.ts, el cliente del backend con `import.meta.env`: la URL
//     y la clave publicable las pone la plataforma, nunca se escriben. Sólo se
//     evalúa si alguien lo importa, así que una app que aún no usa el backend
//     arranca igual.
//   · SIN StrictMode: cada efecto corre una vez, como en la publicada (§5.3).
//   · EN TYPESCRIPT (Jesús, 10/10): nacía en .jsx, y el comprobador de tipos
//     (`checkJs: false`, como Lovable) no revisaba nada. Como la plantilla de
//     Lovable. Las apps que nacieron en .jsx se quedan así (`appFileNames`).
//
// 🔴 EL ESQUELETO TIENE QUE COMPILAR Y ARRANCAR: lo vigilan sus pruebas con el
// mismo compilador y en un Chromium de verdad. Cada fichero que se toque aquí,
// también lo describen el prompt y el manual de Len (`lib/agent/modo-app.ts`).
//
// Puro: sin disco ni red. Lo usa quien crea el proyecto.

import type { AppDeProyecto } from "@/lib/projects/types";
import { CATALOGO_ACTUAL } from "./dependencias";
import { catalogRange, serializePackageJson } from "./npm/lock";
import { PACKAGE_JSON_PATH } from "./npm/paths";

export const ENTRADA = "/src/main.tsx";
/** La de las apps que nacieron antes, en .jsx: la conversión la acepta si es la que Len escribió. */
export const ENTRADA_JSX = "/src/main.jsx";

/** Los ficheros que el prompt y el manual nombran, los de ESA app: en TypeScript si
 *  su entrada lo es, y en JavaScript las que nacieron en .jsx (Holi). */
export function appFileNames(app: Pick<AppDeProyecto, "entrada">): { readonly rutas: string; readonly backend: string } {
  const ts = /\.tsx?$/.test(app.entrada);
  return ts ? { rutas: "/src/App.tsx", backend: "/src/lib/supabase.ts" } : { rutas: "/src/App.jsx", backend: "/src/lib/supabase.js" };
}

export interface EsqueletoDeApp {
  /** El cascarón: `data.html` del proyecto. */
  readonly html: string;
  /** La carpeta: `projectFiles`. */
  readonly ficheros: Readonly<Record<string, string>>;
  /** `data.app`: lo que convierte el proyecto en una app. */
  readonly app: AppDeProyecto;
}

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Un código de idioma válido para `lang`, o `en`. */
function idiomaDe(idioma: string | undefined): string {
  return idioma && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(idioma) ? idioma : "en";
}

/** El cascarón de una app: lo que carga `entrada`. Lo usan el esqueleto y la conversión de una página. */
export function cascaronDeLaApp(o: { readonly titulo: string; readonly idioma?: string; readonly entrada?: string }): string {
  const titulo = o.titulo.trim().slice(0, 120) || "App";
  return `<!doctype html>
<html lang="${idiomaDe(o.idioma)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaparHtml(titulo)}</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>
  body { font-family: "Inter", system-ui, sans-serif; }
</style>
</head>
<body class="bg-slate-50 text-slate-900 antialiased">
<div id="root"></div>
<script type="module" src="${o.entrada ?? ENTRADA}"></script>
</body>
</html>
`;
}

export function esqueletoDeApp(o: { readonly titulo: string; readonly idioma?: string }): EsqueletoDeApp {
  const titulo = o.titulo.trim().slice(0, 120) || "App";
  const html = cascaronDeLaApp(o);
  const ficheros: Record<string, string> = {
    [ENTRADA]: `import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <App />
  </HashRouter>,
);
`,
    "/src/App.tsx": `import { Routes, Route } from "react-router-dom";
import Inicio from "./screens/Inicio";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Inicio />} />
    </Routes>
  );
}
`,
    "/src/screens/Inicio.tsx": `export default function Inicio() {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{${JSON.stringify(titulo)}}</h1>
    </main>
  );
}
`,
    "/src/lib/supabase.ts": `import { createClient } from "@supabase/supabase-js";

// The project's backend. OpenLen fills in its URL and its publishable key,
// which are public by design; a secret key never goes in the code.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
`,
    // OPEN NPM (spec 2026-10-13): like a Vite project, the app lists its packages.
    [PACKAGE_JSON_PATH]: serializePackageJson({
      name: "app",
      private: true,
      type: "module",
      dependencies: Object.fromEntries(["@supabase/supabase-js", "react", "react-dom", "react-router-dom"].map((n) => [n, catalogRange(CATALOGO_ACTUAL, n)])),
    }),
  };
  return { html, ficheros, app: { catalogo: CATALOGO_ACTUAL, entrada: ENTRADA } };
}
