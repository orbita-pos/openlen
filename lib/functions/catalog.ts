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

export const FUNCTIONS_CATALOG_CURRENT = "2026-11";

export interface FunctionsDependency {
  /** El nombre en npm: lo que va tras `npm:` o en `esm.sh/`. */
  readonly name: string;
  /** La versión exacta congelada. */
  readonly version: string;
  /** El fichero dentro de lib/functions/vendor/<catálogo>/. */
  readonly file: string;
  /** Para qué sirve, en una línea. EN INGLÉS: lo lee Len. */
  readonly for: string;
}

export interface FunctionsCatalog {
  readonly dependencies: readonly FunctionsDependency[];
}

export const FUNCTIONS_CATALOGS: Readonly<Record<string, FunctionsCatalog>> = {
  "2026-11": {
    dependencies: [
      { name: "@supabase/supabase-js", version: "2.117.2", file: "supabase-js.mjs", for: "the project's own backend: database, auth and storage (createClient)." },
      { name: "stripe", version: "23.0.0", file: "stripe.mjs", for: "Stripe payments: Checkout sessions and webhooks (constructEventAsync)." },
      { name: "resend", version: "6.32.1", file: "resend.mjs", for: "sending email with Resend." },
      { name: "openai", version: "7.32.0", file: "openai.mjs", for: "calling OpenAI-compatible AI APIs." },
      { name: "mercadopago", version: "3.6.1", file: "mercadopago.mjs", for: "Mercado Pago payments (MercadoPagoConfig, Preference, Payment)." },
      { name: "zod", version: "3.25.76", file: "zod.mjs", for: "validating request bodies." },
    ],
  },
};

export function functionsCatalog(name: string): FunctionsCatalog | null {
  return Object.hasOwn(FUNCTIONS_CATALOGS, name) ? FUNCTIONS_CATALOGS[name]! : null;
}
