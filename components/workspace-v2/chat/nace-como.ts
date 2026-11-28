// LO QUE UNA APP QUE NACE AÑADE AL PRIMER MENSAJE a `/api/agent`: la tarjeta
// App del estado vacío (`tarjetas-nace-como.tsx`). Un sitio para la forma del
// campo, que la usan dos: el borrador que se manda solo y el cuerpo del turno.

import { spaceHref } from "@/lib/space/href";

/** What a first message asks the blank project to be born as, besides a page — each a SKELETON the project gets before
 *  Len reads anything: an app, a tool (spec local 2026-11-04-herramientas-hechas-por-len), a game (spec local
 *  2026-11-05-modo-juego-design) or a workspace theme (spec local 2026-11-27-temas-del-workspace — no app at all, but it
 *  travels the same way: `naceComo` and the language). A page is born as always, with nothing. */
export type NaceComoConEsqueleto = "app" | "tool" | "game" | "theme";

const COMO_CON_ESQUELETO: readonly string[] = ["app", "tool", "game", "theme"] satisfies readonly NaceComoConEsqueleto[];

/** What the home's pill can choose: what a project is born as, or an agent of the person's own (spec local
 *  2026-11-19-agentes-para-todos, §6.3) — which goes to their space and is never a way a project is born. */
export type StartKind = "pagina" | NaceComoConEsqueleto | "agent";

/** Lo que pide nacer como app —o como herramienta, o como juego—: la tarjeta, y el idioma de la interfaz. */
export interface PideNacer {
  readonly naceComo?: NaceComoConEsqueleto;
  readonly idioma?: string;
}

/** Los campos del cuerpo: `{ naceComo, idioma }` para una app, una herramienta o un juego, o nada si es una página
 *  (o un agente, que no nace como proyecto). */
export function camposDeNacer(o: { readonly naceComo?: string; readonly idioma?: string } | null | undefined): PideNacer {
  if (!o || !naceComoConEsqueleto(o.naceComo)) return {};
  return { naceComo: o.naceComo, ...(o.idioma ? { idioma: o.idioma } : {}) };
}

/** Whether this first message gives the blank project a skeleton (an app, a tool, a game or a theme), not a page. */
export function naceComoConEsqueleto(v: string | null | undefined): v is NaceComoConEsqueleto {
  return typeof v === "string" && COMO_CON_ESQUELETO.includes(v);
}

/** What the start page can really be born as: a game asked for (a stale `kind=game` link) while the server says
 *  games are off (OPENLEN_GAMES=0) is a page, which is what the server makes of it — and so is a theme while themes are
 *  off (OPENLEN_THEMES=0: a plugin turned off has no commands). `temas` defaults to on, as `juegos` starts. */
export function naceComoDisponible<T extends StartKind>(v: T, juegos: boolean, temas = true): T | "pagina" {
  if (v === "game" && !juegos) return "pagina";
  if (v === "theme" && !temas) return "pagina";
  return v;
}

// LA PORTADA TAMBIÉN ELIGE (la píldora del input, `hero-kind-picker.tsx`): su
// elección viaja en la URL de /new como `kind=app` y marca la tarjeta App del
// proyecto en blanco. Página no lleva nada: es lo de siempre.

/** El parámetro de /new con el que la portada pide nacer como app. */
export const KIND_PARAM = "kind";

/** Lo que dice la URL: `app`, `tool`, `game`, `theme` o `agent`; lo demás, o nada, es una página. */
export function kindFromParam(v: string | null): StartKind {
  return naceComoConEsqueleto(v) ? v : v === "agent" ? "agent" : "pagina";
}

/** El enlace de la portada a /new: el brief escrito y, si no es una página, su `kind`. An agent goes to the person's
 *  space instead, which sends the home's ticket as /new does. */
/** How much of a URL the brief may take, escaped. Cloudflare and Node refuse a request line past ~16 KB, and escaped
 *  Spanish takes 3–6 bytes a letter; past this the message travels only in the home's ticket and the link carries the
 *  ticket's id (`?first=`, lib/marketing/first-message-in-transit.ts). Since 24/11 the box has no cap, as Claude Code. */
export const URL_BRIEF_MAX_BYTES = 6_000;

export function newProjectHref(brief: string, kind: StartKind, ticket: string | null = null): string {
  const trimmed = brief.trim();
  if (ticket && encodeURIComponent(trimmed).length > URL_BRIEF_MAX_BYTES) {
    if (kind === "agent") return spaceHref({ first: ticket });
    const byId = `/new?first=${encodeURIComponent(ticket)}`;
    return kind === "pagina" ? byId : `${byId}&${KIND_PARAM}=${kind}`;
  }
  if (kind === "agent") return spaceHref({ brief: trimmed });
  const base = `/new?brief=${encodeURIComponent(trimmed)}`;
  return kind === "pagina" ? base : `${base}&${KIND_PARAM}=${kind}`;
}

/** The way back to the home's box, the ONLY box (Jesús, 06/11: «¿para qué tener 2 inputs?»): where /new sends a link
 *  that carries a brief or a kind the home didn't send — they only FILL the home's box (`homeArrival`), as they only
 *  filled /new's. Nothing to carry is plain `/`. */
export function homeHref(brief: string | null, kind: StartKind): string {
  const qs = new URLSearchParams();
  if (brief && brief.trim()) qs.set("brief", brief.trim());
  if (kind !== "pagina") qs.set(KIND_PARAM, kind);
  const s = qs.toString();
  return s ? `/?${s}` : "/";
}

/** What a link to the home carries for its box (`?brief=`, `?kind=`): it fills, never sends. */
export function homeArrival(search: string): { brief: string; kind: StartKind } | null {
  const qs = new URLSearchParams(search);
  const brief = qs.get("brief")?.trim() ?? "";
  const kind = kindFromParam(qs.get(KIND_PARAM));
  return brief || kind !== "pagina" ? { brief, kind } : null;
}
