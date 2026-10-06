// SÓLO PARA LAS PRUEBAS: aplica unas reglas de `rewrites()` con las funciones
// del propio router de Next (`resolve-routes.js`: `getPathMatch` →
// `matchHas` → `prepareDestination`, regla tras regla), no con una copia
// nuestra que pudiera decir otra cosa. Lo usan `site-rewrite.test.ts` y el
// servidor de `sitio-del-lienzo.browser.test.ts`.

import type { IncomingMessage } from "node:http";
import { modifyRouteRegex } from "next/dist/lib/redirect-status";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas, prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";

type Rule = {
  source: string;
  destination: string;
  has?: Array<{ type: "host"; value: string }>;
};

/** La ruta y la query con las que el router llamaría a la página. */
export function resolveRewrites(
  rules: readonly Rule[],
  host: string,
  url: string,
): { pathname: string; query: Record<string, string | string[] | undefined> } {
  const parsed = new URL(url, "http://n");
  let pathname = parsed.pathname;
  const query: Record<string, string | string[] | undefined> = Object.fromEntries(parsed.searchParams);
  const req = { headers: { host } } as unknown as IncomingMessage;
  for (const rule of rules) {
    // Las mismas opciones que `buildCustomRoute` (filesystem.js).
    const match = getPathMatch(rule.source, {
      strict: true,
      removeUnnamedParams: true,
      regexModifier: (regex) => modifyRouteRegex(regex),
    });
    let params = match(pathname);
    if (params && rule.has) {
      const fromHas = matchHas(req, query, rule.has);
      params = fromHas ? Object.assign(params, fromHas) : false;
    }
    if (!params) continue;
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: true,
      destination: rule.destination,
      params,
      query,
    });
    pathname = parsedDestination.pathname;
    Object.assign(query, parsedDestination.query);
  }
  return { pathname, query };
}
