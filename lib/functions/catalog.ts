// lib/functions/catalog.ts — LO QUE UNA EDGE FUNCTION PUEDE IMPORTAR (spec local
// docs/superpowers/specs/2026-10-11-edge-functions-design.md, Parte 1).
//
// Es a las funciones lo que lib/apps/dependencias.ts es a las apps: una lista
// CORTA Y CERRADA (npm abierto: NO, decidido el 08/10). Lo que Len escribe es
// lo de Supabase —`npm:stripe`, `jsr:@supabase/supabase-js@2`, `esm.sh/…`—, y
// cualquier versión resuelve a la de aquí (con aviso si cambia el mayor).
//
// 🔴 CONGELADO: un catálogo construido NUNCA cambia de bytes. Versión nueva =
// catálogo nuevo. Lo construye `npm run functions:vendor` en
// lib/functions/vendor/<catálogo>/ (es Node en servidor, no navegador: por eso
// es aparte del de las apps).
//
// Puro y sin imports: lo leen el empaquetador, la terminal y las pruebas.

export const FUNCTIONS_CATALOG_CURRENT = "2026-12";

export interface FunctionsDependency {
  /** El nombre en npm: lo que va tras `npm:` o en `esm.sh/`. */
  readonly name: string;
  /** La versión exacta congelada. */
  readonly version: string;
  /** El fichero dentro de lib/functions/vendor/<catálogo>/. */
  readonly file: string;
  /** Para qué sirve, en una línea. EN INGLÉS: lo lee Len. */
  readonly for: string;
  /** The subpaths that may be imported too (`/jsx-runtime` → its file); any other is refused. */
  readonly subpaths?: Readonly<Record<string, string>>;
}

const CATALOG_2026_11: readonly FunctionsDependency[] = [
  { name: "@supabase/supabase-js", version: "2.117.2", file: "supabase-js.mjs", for: "the project's own backend: database, auth and storage (createClient)." },
  { name: "stripe", version: "23.0.0", file: "stripe.mjs", for: "Stripe payments: Checkout sessions and webhooks (constructEventAsync)." },
  { name: "resend", version: "6.32.1", file: "resend.mjs", for: "sending email with Resend." },
  { name: "openai", version: "7.32.0", file: "openai.mjs", for: "calling OpenAI-compatible AI APIs." },
  { name: "mercadopago", version: "3.6.1", file: "mercadopago.mjs", for: "Mercado Pago payments (MercadoPagoConfig, Preference, Payment)." },
  { name: "zod", version: "3.25.76", file: "zod.mjs", for: "validating request bodies." },
];

export interface FunctionsCatalog {
  readonly dependencies: readonly FunctionsDependency[];
}

export const FUNCTIONS_CATALOGS: Readonly<Record<string, FunctionsCatalog>> = {
  "2026-11": { dependencies: CATALOG_2026_11 },
  // PROJECT EMAIL (spec local 2026-10-22-email-integration, Task 15): 2026-11 untouched plus React
  // Email — `react-email`, the package React Email's docs install today (the @react-email/* ones
  // are deprecated). The four share ONE React (scripts/functions-vendor.ts), so a template, its
  // `render` and resend's `react:` render with the same one.
  "2026-12": {
    dependencies: [
      ...CATALOG_2026_11,
      { name: "react", version: "19.3.1", file: "react.mjs", for: "JSX in a .tsx function, for email templates.", subpaths: { "/jsx-runtime": "react-jsx-runtime.mjs" } },
      { name: "react-dom", version: "19.3.1", file: "react-dom-server.mjs", for: "react-dom/server (renderToStaticMarkup); a function has no DOM.", subpaths: { "/server": "react-dom-server.mjs" } },
      { name: "react-email", version: "6.11.1", file: "react-email.mjs", for: "email templates as React components (Html, Body, Heading, Text, Button, Img…) and render; send one with resend's `react:`." },
      { name: "@react-email/render", version: "2.1.0", file: "react-email-render.mjs", for: "turning a React Email template into HTML (render, also in react-email)." },
    ],
  },
};

export function functionsCatalog(name: string): FunctionsCatalog | null {
  return Object.hasOwn(FUNCTIONS_CATALOGS, name) ? FUNCTIONS_CATALOGS[name]! : null;
}
