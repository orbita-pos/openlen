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
//   · /src/main.jsx monta la app dentro de `<HashRouter>`: las pantallas van
//     por hash (H6), y así ya está puesto donde tiene que estar.
//   · /src/App.jsx, las rutas; /src/screens/Inicio.jsx, la primera pantalla.
//   · /src/lib/supabase.js, el cliente del backend con `import.meta.env`: la URL
//     y la clave publicable las pone la plataforma, nunca se escriben. Sólo se
//     evalúa si alguien lo importa, así que una app que aún no usa el backend
//     arranca igual.
//   · SIN StrictMode: cada efecto corre una vez, como en la publicada (§5.3).
//
// 🔴 EL ESQUELETO TIENE QUE COMPILAR Y ARRANCAR: lo vigilan sus pruebas con el
// mismo compilador y en un Chromium de verdad. Cada fichero que se toque aquí,
// también lo describen el prompt y el manual de Len (`lib/agent/modo-app.ts`).
//
// Puro: sin disco ni red. Lo usa quien crea el proyecto.

import type { AppDeProyecto } from "@/lib/projects/types";
import { CATALOGO_ACTUAL } from "./dependencias";

export const ENTRADA = "/src/main.jsx";

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

export function esqueletoDeApp(o: { readonly titulo: string; readonly idioma?: string }): EsqueletoDeApp {
  const titulo = o.titulo.trim().slice(0, 120) || "App";
  const html = `<!doctype html>
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
<script type="module" src="${ENTRADA}"></script>
</body>
</html>
`;
  const ficheros: Record<string, string> = {
    [ENTRADA]: `import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";

createRoot(document.getElementById("root")).render(
  <HashRouter>
    <App />
  </HashRouter>,
);
`,
    "/src/App.jsx": `import { Routes, Route } from "react-router-dom";
import Inicio from "./screens/Inicio";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Inicio />} />
    </Routes>
  );
}
`,
    "/src/screens/Inicio.jsx": `export default function Inicio() {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{${JSON.stringify(titulo)}}</h1>
    </main>
  );
}
`,
    "/src/lib/supabase.js": `import { createClient } from "@supabase/supabase-js";

// The project's backend. OpenLen fills in its URL and its publishable key,
// which are public by design; a secret key never goes in the code.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
`,
  };
  return { html, ficheros, app: { catalogo: CATALOGO_ACTUAL, entrada: ENTRADA } };
}
