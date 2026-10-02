/**
 * DE DÓNDE SALE LA WEB DE LEN (F2 de plans/len-agente-2026): el buscador y el
 * lector que hay detrás de `web_search` y `web_fetch`.
 *
 * Como el servicio web de DeepSeek (`packages/web/web/README.md` @639ed01): las
 * herramientas nunca eligen proveedor; piden y esto decide.
 *   · En Len-Bench (`OPENLEN_WEB_DE_PRUEBA_DIR`), la web FIJA de cada caso, que
 *     el conductor deja en `<dir>/<proyecto>.json`: ni una petición sale a la red,
 *     y la corrida da lo mismo cada vez (lib/len-bench/web-sustituta.ts).
 *   · Si no, el buscador es **Exa**, con `EXA_API_KEY`: el que tiene DeepSeek
 *     entre los suyos (`web-search-exa`) y que existe fuera de su casa (el
 *     nativo no está en Fireworks). Sin clave, buscar falla con un error que el
 *     modelo puede leer; la herramienta sigue a la vista, como allí («stable
 *     registration»).
 *   · Leer una página va por `fetchRaw`, que ya lleva la defensa SSRF entera.
 */
import fs from "node:fs";

import { fetchRaw } from "@/lib/style-match/scrape/fetch-raw";
import { buscarEnLaWeb, ficheroDeLaWeb, leerDeLaWeb, webDeSerializable } from "@/lib/len-bench/web-sustituta";
import type { WebDelCaso } from "@/lib/len-bench/tipos";

export interface FuenteWeb {
  readonly titulo: string;
  readonly url: string;
  readonly fragmento?: string;
  /** `AAAA-MM-DD`, si el buscador la sabe. */
  readonly fecha?: string;
}

/** Un fallo con su mensaje para el modelo, en inglés como el resto de lo que lee. */
export class ErrorDeLaWeb extends Error {}

export type PaginaWeb = { readonly ok: true; readonly url: string; readonly html: string } | { readonly ok: false; readonly error: string };

export interface WebDeps {
  /** Las fuentes de UNA consulta. Lanza `ErrorDeLaWeb`. */
  buscar(projectId: string, consulta: string, max: number, signal: AbortSignal): Promise<readonly FuenteWeb[]>;
  leer(projectId: string, url: string): Promise<PaginaWeb>;
  /** Lo buscado de verdad se cobra; la web de prueba, no. */
  cobrar(userId: string, consultas: number): Promise<void>;
}

// ── Exa ──────────────────────────────────────────────────────────────────────

const EXA_BASE = "https://api.exa.ai";

interface RespuestaDeExa {
  readonly results?: readonly { url?: unknown; title?: unknown; publishedDate?: unknown; highlights?: unknown }[];
}

/** Las fuentes de una respuesta de Exa: sin fragmento de verdad no hay fuente (como DeepSeek). */
export function fuentesDeExa(r: RespuestaDeExa): FuenteWeb[] {
  return (r.results ?? []).flatMap((x) => {
    if (typeof x.url !== "string" || !x.url) return [];
    const fragmento = Array.isArray(x.highlights) ? x.highlights.find((h): h is string => typeof h === "string" && h.trim() !== "") : undefined;
    if (!fragmento) return [];
    const titulo = typeof x.title === "string" && x.title.trim() ? x.title.trim() : x.url;
    const fecha = typeof x.publishedDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(x.publishedDate) ? x.publishedDate.slice(0, 10) : undefined;
    return [{ titulo, url: x.url, fragmento: fragmento.replace(/\s+/g, " ").trim(), ...(fecha ? { fecha } : {}) }];
  });
}

export async function buscarEnExa(
  apiKey: string,
  consulta: string,
  max: number,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FuenteWeb[]> {
  let res: Response;
  try {
    res = await fetchImpl(`${EXA_BASE}/search`, {
      method: "POST",
      // Una redirección se rechaza antes de tocar su destino.
      redirect: "error",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: consulta, type: "auto", numResults: max, contents: { highlights: { highlightsPerUrl: 1 } } }),
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw new ErrorDeLaWeb("the search was cancelled");
    throw new ErrorDeLaWeb(`the search request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new ErrorDeLaWeb(`the search service answered HTTP ${res.status}`);
  let cuerpo: RespuestaDeExa;
  try {
    cuerpo = (await res.json()) as RespuestaDeExa;
  } catch (e) {
    throw new ErrorDeLaWeb(`the search service sent an unreadable answer: ${e instanceof Error ? e.message : String(e)}`);
  }
  return fuentesDeExa(cuerpo);
}

// ── Leer una página ─────────────────────────────────────────────────────────

function motivo(error: { kind: string } & Record<string, unknown>): string {
  switch (error.kind) {
    case "invalid-url":
      return `that is not a valid URL (${String(error.reason ?? "")})`;
    case "ssrf-blocked":
      return "that address is not a public website and cannot be read";
    case "timeout":
      return "the page took too long to answer";
    case "blocked":
      return `the site refused the request (HTTP ${String(error.status ?? "")}) — do not retry; ask the user to paste the text`;
    case "challenge":
      return "the site asks for an anti-bot check — do not retry; ask the user to paste the text";
    case "non-html":
      return `that is not a web page (${String(error.contentType ?? "unknown type")})`;
    case "too-large":
      return "the page is too large";
    default:
      return String(error.message ?? "the page could not be read");
  }
}

export async function leerPaginaDeVerdad(url: string, fetcher: typeof fetchRaw = fetchRaw): Promise<PaginaWeb> {
  try {
    const r = await fetcher({ url });
    if (!r.ok) return { ok: false, error: motivo(r.error as { kind: string }) };
    return { ok: true, url: r.value.finalUrl, html: r.value.html };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── La web de prueba de Len-Bench ───────────────────────────────────────────

/** La web del caso que el conductor dejó para este proyecto; vacía si no dejó ninguna. */
export function webDePrueba(dir: string, projectId: string): WebDelCaso {
  try {
    return webDeSerializable(JSON.parse(fs.readFileSync(ficheroDeLaWeb(dir, projectId), "utf8")));
  } catch {
    return { busquedas: [], paginas: {} };
  }
}

// ── Lo que usa el servidor ──────────────────────────────────────────────────

/**
 * Lo que cuesta UNA consulta, en centicréditos (un crédito es ~$0,01 de coste
 * bruto; el margen va en el precio del plan, como en todo lo demás). Leído en
 * exa.ai/pricing el 2026-10-02: la búsqueda «Auto» son $7 cada 1.000 (hasta 10
 * resultados) y, a falta de que lo diga explícito, el fragmento de cada fuente
 * se cuenta como «Contents», $1 cada 1.000 páginas: 8 × $0,001. ~$0,015, así que
 * 1,5 créditos (Jesús, 02/10). La primera cifra (1 crédito, de la hoja de ruta)
 * se quedaba medio céntimo corta en cada búsqueda.
 */
export const CENTICREDITOS_POR_CONSULTA = 150;

export function webDelServidor(debit: (userId: string, centicreditos: number) => Promise<unknown>): WebDeps {
  const dirDePrueba = process.env.OPENLEN_WEB_DE_PRUEBA_DIR?.trim();
  if (dirDePrueba) {
    return {
      async buscar(projectId, consulta, max) {
        return buscarEnLaWeb(webDePrueba(dirDePrueba, projectId), consulta)
          .slice(0, max)
          .map((r) => ({ titulo: r.titulo, url: r.url, fragmento: r.fragmento, ...(r.fecha ? { fecha: r.fecha } : {}) }));
      },
      async leer(projectId, url) {
        const html = leerDeLaWeb(webDePrueba(dirDePrueba, projectId), url);
        return html === null ? { ok: false, error: "the page does not exist (HTTP 404)" } : { ok: true, url, html };
      },
      async cobrar() {},
    };
  }
  return {
    async buscar(_projectId, consulta, max, signal) {
      const clave = process.env.EXA_API_KEY?.trim();
      if (!clave) throw new ErrorDeLaWeb("web search is not available on this server (no search provider is configured)");
      return buscarEnExa(clave, consulta, max, signal);
    },
    leer: (_projectId, url) => leerPaginaDeVerdad(url),
    async cobrar(userId, consultas) {
      if (consultas > 0) await debit(userId, consultas * CENTICREDITOS_POR_CONSULTA);
    },
  };
}
