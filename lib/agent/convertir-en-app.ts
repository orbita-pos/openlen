// lib/agent/convertir-en-app.ts — UNA PÁGINA QUE CRECE SE CONVIERTE EN APP
// (F4 de la spec local docs/superpowers/specs/2026-10-07-apps-design.md).
//
// Si el dueño de una página pide algo que sólo cabe en una app —cuentas con
// login, un punto de venta, una agenda, un panel con datos—, Len se lo propone
// y, si acepta, la convierte EN UN TURNO. El turno tiene dos mitades:
//
//   1. CONSTRUIR, con la página intacta: Len lee cada página y escribe la app
//      en /src con Write, como cualquier fichero de la carpeta (una página ya
//      puede guardar `.jsx`). Las páginas pasan a pantallas (/menu/index.html
//      → /src/screens/Menu.tsx, ruta `#/menu`), lo repetido a componentes, el
//      JavaScript suelto a estado de React y los formularios a una tabla.
//   2. VOLTEAR, con esta herramienta y de una vez: el /index.html pasa a ser
//      el cascarón del esqueleto (con el <title> y el `lang` de la portada),
//      las páginas se borran —aquí, y sólo aquí, Len quita páginas— y el
//      proyecto recibe `data.app`. Así el dueño nunca ve media conversión.
//
// 🔴 EL COMPILADOR ES LA PUERTA: si la app de /src no compila entera con el
// cascarón nuevo, NO SE CONVIERTE NADA y Len recibe qué arreglar, con fichero y
// línea, como la puerta de publicar. Una conversión que deja la app en blanco
// sería la peor de las dos cosas: sin página y sin app.
//
// DESHACER: el turno entero, con el Deshacer de siempre. La foto del turno
// guarda `data.app` y los títulos de las páginas (`RUTA_FORMA`,
// lib/projects/deshacer-turno-plan.ts), así que deshacer devuelve las páginas
// con su título, quita /src y quita `data.app`. Y antes de voltear, cada página
// queda en Versiones.
//
// Los textos que lee el modelo van en inglés.

import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { erroresDeLaApp, problemasDelCascaron } from "@/lib/agent/compila-la-app";
import { CATALOGO_ACTUAL } from "@/lib/apps/dependencias";
import { ENTRADA, ENTRADA_JSX, cascaronDeLaApp, esqueletoDeApp } from "@/lib/apps/esqueleto";
import { textoDeDiagnostico } from "@/lib/apps/compilador";
import { titleFromHtml } from "@/lib/projects/titulo-del-html";
import { RUTA_APPS } from "@/lib/agent/ficheros/manual";
import type { AppDeProyecto, ProjectData } from "@/lib/projects/types";
import type { GameOfProject } from "@/lib/games/types";
import { gamesEnabled } from "@/lib/games/enabled";
import { CARPETA_SKILLS } from "@/lib/agent/ficheros/manual";

export const CONVERTIR_EN_APP = "convert_to_app";

/** El `lang` del <html> de la portada, si lo tiene. */
export function idiomaDeLaPortada(html: string): string | undefined {
  return /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
}

/** La pantalla que le corresponde a una página: /menu/index.html → Menu, `#/menu`. */
export function pantallaDeLaPagina(slug: string): { componente: string; ruta: string } {
  const componente =
    slug
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((p) => p[0]!.toUpperCase() + p.slice(1))
      .join("") || "Pagina";
  return { componente: /^[0-9]/.test(componente) ? `P${componente}` : componente, ruta: `#/${slug}` };
}

/** Cómo queda `data` tras voltear: el cascarón, sin páginas y con `data.app` (y `data.game`, si se convierte en juego). */
export function dataConvertida(data: ProjectData, cascaron: string, app: AppDeProyecto, game?: GameOfProject): ProjectData {
  const { pages: _fuera, ...resto } = data;
  void _fuera;
  return { ...resto, html: cascaron, app, ...(game ? { game } : {}) };
}

/**
 * LA VIÑETA DEL PROMPT DE UNA PÁGINA: cuándo se propone convertir y cómo. En
 * una app no tiene sentido y `promptDeLaApp` la quita por esta misma marca.
 */
export const LA_PAGINA_QUE_CRECE = `- Some requests don't fit in a page but in an APP: accounts with login, a point of sale, a booking agenda, a panel whose data several screens share. When the user asks for one, offer to turn the project into an app with ask_user_question, and in that same question say in one sentence that in an app the canvas can't be edited by hand and pages aren't translated automatically, and that the whole turn can be undone. Only if they accept, convert it in that turn: read ${RUTA_APPS}, build the app in /src and then call ${CONVERTIR_EN_APP}. Never convert without their yes.`;

/** A GAME (spec local 2026-11-05-modo-juego-design, §8.2): Kimi deduces the type from the description; the house
 *  answer for an app is to offer converting and wait for a yes, and a game gets the same. Only with the skills on:
 *  it is built from the game-development skill, whose SKILL.md is readable in any project. */
const UN_JUEGO_QUE_CRECE = ` A game that will grow —levels, 3D, several files— fits better as a GAME project: offer it the same way, build it in /src reading ${CARPETA_SKILLS}/game-development/SKILL.md, and convert it with ${CONVERTIR_EN_APP} and game: true. A small one-file game the user only wants on this page can stay in the page.`;

/** La misma viñeta con las skills encendidas: la guía de apps es la skill `convert-to-app` (spec local
 *  2026-10-27-len-five-skills), y un juego, la suya —sólo con los juegos encendidos (OPENLEN_GAMES)—. Apagadas, la
 *  de siempre. */
export function laPaginaQueCrece(conSkills: boolean, conJuegos = true): string {
  return conSkills ? LA_PAGINA_QUE_CRECE.replace(`read ${RUTA_APPS}`, "load the convert-to-app skill") + (conJuegos ? UN_JUEGO_QUE_CRECE : "") : LA_PAGINA_QUE_CRECE;
}

/** The declaration as this server offers it: without games (OPENLEN_GAMES=0), no `game` parameter. */
export function declaracionConvertirEnApp(conJuegos: boolean): Record<string, unknown> {
  if (conJuegos) return { ...DECLARACION_CONVERTIR_EN_APP };
  return { ...DECLARACION_CONVERTIR_EN_APP, parameters: { type: "OBJECT", properties: {} } };
}

export const DECLARACION_CONVERTIR_EN_APP = {
  name: CONVERTIR_EN_APP,
  description:
    "Turns this page project into a web app, in one step: /index.html becomes the app's shell (keeping the home page's <title> and lang), EVERY page is removed and the project becomes an app from then on. " +
    `Use it ONLY after the user accepted converting, and only after you have written the whole app in /src: ${ENTRADA} mounting /src/App.tsx inside <HashRouter> into #root, each page as a screen (/menu/index.html → /src/screens/Menu.tsx at #/menu, the home at #/), what repeats as components, the loose JavaScript as React state and each form saving to a table. ` +
    "If the app in /src doesn't compile, nothing is converted and you get what to fix. After it, in this same turn, view_page and use_page open the app: pass the screen as file_path (\"#/menu\").",
  parameters: {
    type: "OBJECT",
    properties: {
      game: {
        type: "BOOLEAN",
        description:
          "Convert it into a GAME project instead (only after the user accepted a game): the shell fills the window, Len's game posture applies from then on, and /src needs no <HashRouter> —a game has no routes—, only the entry mounting it into #root.",
      },
    },
  },
} as const;

/** El esqueleto de la entrada, para decirle a Len qué falta si no la escribió. */
const ENTRADA_DE_EJEMPLO = esqueletoDeApp({ titulo: "App" }).ficheros[ENTRADA]!;

export async function toolConvertirEnApp(session: AgentSession, deps: AgentDeps, args: { readonly game?: unknown } = {}): Promise<ToolOutcome> {
  // With games off (OPENLEN_GAMES=0) the parameter isn't offered, and a stray `game: true` makes a plain app.
  const comoJuego = args.game === true && gamesEnabled();
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "project not found" } };
  if (row.data.app) return { response: { ok: false, error: "This project is already an app: there is nothing to convert." } };
  if (!deps.projectFiles) return { response: { ok: false, error: "convert_to_app isn't available in this environment." } };
  const ficheros = await deps.projectFiles(session.projectId);
  // La entrada que Len escribió: la de ahora (TypeScript) o la de siempre (.jsx).
  const entrada = [ENTRADA, ENTRADA_JSX].find((r) => Object.hasOwn(ficheros, r));
  if (!entrada) {
    return {
      response: {
        ok: false,
        error:
          `Nothing was converted: write the app in /src first, starting with ${ENTRADA}, and then call ${CONVERTIR_EN_APP} again. ` +
          `${ENTRADA} mounts the app like this:\n${ENTRADA_DE_EJEMPLO}`,
      },
    };
  }

  const app: AppDeProyecto = { catalogo: CATALOGO_ACTUAL, entrada };
  const portada = row.data.html ?? "";
  const idioma = idiomaDeLaPortada(portada);
  const cascaron = cascaronDeLaApp({ titulo: titleFromHtml(portada) ?? row.title ?? "App", entrada, ...(idioma ? { idioma } : {}), pantallaCompleta: comoJuego });
  const game: GameOfProject | undefined = comoJuego ? { bornAt: new Date().toISOString() } : undefined;
  const problemas = [
    ...erroresDeLaApp(app, ficheros).map(textoDeDiagnostico),
    ...problemasDelCascaron(app, cascaron, ficheros).map((d) => `${d.ruta} — ${d.mensaje}`),
  ];
  if (problemas.length > 0) {
    return {
      response: {
        ok: false,
        error: `Nothing was converted: the app in /src doesn't compile yet, and converting now would leave the user with a blank app instead of their page. Fix this first:\n${problemas.join("\n")}`,
      },
    };
  }

  // Antes de voltear, cada página a Versiones: lo que el dueño tenía queda a
  // mano en el editor, además de en el Deshacer del turno. Fail-soft: el
  // Deshacer del turno ya lo devuelve todo.
  const paginas = Object.keys(row.data.pages ?? {}).sort();
  const etiqueta = `${CONVERTIR_EN_APP}: before converting to an app`;
  for (const [page, html] of [[null, portada] as const, ...paginas.map((s) => [s, row.data.pages![s]!.html] as const)]) {
    await deps.snapshotVersion({ projectId: session.projectId, html, label: etiqueta, source: "chat", page }).catch(() => null);
  }

  await deps.saveProjectData(session.projectId, session.userId, (actual) => {
    // Si alguien lo convirtió entre medias, no se pisa.
    if (actual.app) return actual;
    return dataConvertida(actual, cascaron, app, game);
  });

  // EL RESTO DEL TURNO YA ES DE UNA APP: escribir /x/index.html se rechaza,
  // lo que no compila vuelve en <new-diagnostics>, y no hay página abierta.
  session.app = app;
  if (game) session.game = true;
  session.page = null;
  session.carpetaAlEmpezar ??= new Map(Object.entries(ficheros));

  const quitadas = paginas.map((s) => `/${s}/index.html`);
  const pantallas = paginas.map((s) => pantallaDeLaPagina(s).ruta);
  return {
    response: {
      ok: true,
      tool_result: comoJuego
        ? `Converted: this project is now a game. /index.html is the shell that starts ${entrada}` +
          (quitadas.length ? `, and the pages ${quitadas.join(", ")} were removed.` : ".") +
          ' Now play it as the game-development skill says: use_page with its keys, and the box for what is held. When you finish, tell the user in one sentence that in a game the canvas can\'t be edited by hand and pages aren\'t translated automatically, and that undoing this turn brings their page back.'
        : `Converted: this project is now a web app. /index.html is the shell that starts ${entrada}` +
          (quitadas.length ? `, and the pages ${quitadas.join(", ")} were removed.` : ".") +
          ` Now check the app works: view_page and use_page with file_path "#/"${pantallas.length ? ` and ${pantallas.map((p) => `"${p}"`).join(", ")}` : ""}.` +
          " When you finish, tell the user in one sentence that in an app the canvas can't be edited by hand and pages aren't translated automatically, and that undoing this turn brings their page back.",
      removed_pages: quitadas,
    },
    action: { tool: CONVERTIR_EN_APP, ok: true, summary: comoJuego ? (quitadas.length ? `${quitadas.length + 1} pages → game` : "page → game") : quitadas.length ? `${quitadas.length + 1} pages → app` : "page → app" },
    updatedHtml: cascaron,
    page: null,
    appCambiada: true,
  };
}
