// LO QUE UNA APP QUE NACE AÑADE AL PRIMER MENSAJE a `/api/agent`: la tarjeta
// App del estado vacío (`tarjetas-nace-como.tsx`). Un sitio para la forma del
// campo, que la usan dos: el borrador que se manda solo y el cuerpo del turno.

/** What is born as an app: an app, a tool (spec local 2026-11-04-herramientas-hechas-por-len) or a game (spec local
 *  2026-11-05-modo-juego-design). A page is born as always, with nothing. */
export type NaceComoApp = "app" | "tool" | "game";

const COMO_APP: readonly string[] = ["app", "tool", "game"] satisfies readonly NaceComoApp[];

/** Lo que pide nacer como app —o como herramienta, o como juego—: la tarjeta, y el idioma de la interfaz. */
export interface PideNacer {
  readonly naceComo?: NaceComoApp;
  readonly idioma?: string;
}

/** Los campos del cuerpo: `{ naceComo, idioma }` para una app, una herramienta o un juego, o nada si es una página. */
export function camposDeNacer(o: PideNacer | null | undefined): PideNacer {
  if (!o?.naceComo || !COMO_APP.includes(o.naceComo)) return {};
  return { naceComo: o.naceComo, ...(o.idioma ? { idioma: o.idioma } : {}) };
}

/** Whether this first message makes the blank project an app (a tool and a game are apps too). */
export function naceComoApp(v: string | null | undefined): v is NaceComoApp {
  return typeof v === "string" && COMO_APP.includes(v);
}

/** What the start page can really be born as: a game asked for (a stale `kind=game` link) while the server says
 *  games are off (OPENLEN_GAMES=0) is a page, which is what the server makes of it. */
export function naceComoDisponible<T extends "pagina" | NaceComoApp>(v: T, juegos: boolean): T | "pagina" {
  return v === "game" && !juegos ? "pagina" : v;
}

// LA PORTADA TAMBIÉN ELIGE (la píldora del input, `hero-kind-picker.tsx`): su
// elección viaja en la URL de /new como `kind=app` y marca la tarjeta App del
// proyecto en blanco. Página no lleva nada: es lo de siempre.

/** El parámetro de /new con el que la portada pide nacer como app. */
export const KIND_PARAM = "kind";

/** Lo que dice la URL: `app`, `tool` o `game`; lo demás, o nada, es una página. */
export function kindFromParam(v: string | null): "pagina" | NaceComoApp {
  return naceComoApp(v) ? v : "pagina";
}

/** El enlace de la portada a /new: el brief escrito y, si no es una página, su `kind`. */
export function newProjectHref(brief: string, kind: "pagina" | NaceComoApp): string {
  const base = `/new?brief=${encodeURIComponent(brief.trim())}`;
  return kind === "pagina" ? base : `${base}&${KIND_PARAM}=${kind}`;
}

/** The way back to the home's box, the ONLY box (Jesús, 06/11: «¿para qué tener 2 inputs?»): where /new sends a link
 *  that carries a brief or a kind the home didn't send — they only FILL the home's box (`homeArrival`), as they only
 *  filled /new's. Nothing to carry is plain `/`. */
export function homeHref(brief: string | null, kind: "pagina" | NaceComoApp): string {
  const qs = new URLSearchParams();
  if (brief && brief.trim()) qs.set("brief", brief.trim());
  if (kind !== "pagina") qs.set(KIND_PARAM, kind);
  const s = qs.toString();
  return s ? `/?${s}` : "/";
}

/** What a link to the home carries for its box (`?brief=`, `?kind=`): it fills, never sends. */
export function homeArrival(search: string): { brief: string; kind: "pagina" | NaceComoApp } | null {
  const qs = new URLSearchParams(search);
  const brief = qs.get("brief")?.trim() ?? "";
  const kind = kindFromParam(qs.get(KIND_PARAM));
  return brief || kind !== "pagina" ? { brief, kind } : null;
}
