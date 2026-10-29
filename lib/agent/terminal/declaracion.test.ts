// lib/agent/terminal/declaracion.test.ts — lo que ve el modelo con y sin la terminal (F1).
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "@/lib/agent/catalog";
import { buildManualDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import type { AgentMode } from "@/lib/agent/dynamis";
import { COMMITTING_WITH_GIT, DECLARACION_BASH, NOMBRE_BASH, PARA_LA_TERMINAL, PARA_SOLO_LA_TERMINAL, terminalEncendida, terminalOnly, withGit, withSandbox } from "./declaracion";

const CON = { OPENLEN_TERMINAL: "1" };
const SIN = { OPENLEN_TERMINAL: "0" };
const nombres = (env: Record<string, string>) => buildFunctionDeclarations(env).map((d) => String(d.name));
const textos = (env: Record<string, string>) => [buildAgentSystemPrompt(env), ...buildFunctionDeclarations(env).map((d) => String(d.description ?? ""))].join("\n");
// UNA APP WEB (F3): su prompt, su manual y sus herramientas, que son los suyos.
const APP = { catalogo: "2026-10", entrada: "/src/main.jsx" };
const textosDeApp = (env: Record<string, string>, mode: AgentMode = "len") =>
  [
    buildAgentSystemPrompt(env, mode, APP),
    ...buildFunctionDeclarations(env, {}, mode, APP).map((d) => String(d.description ?? "")),
    buildManualDeLaPlataforma(env, mode, APP),
  ].join("\n");

describe("bash, como el de Claude Code (plan 04 de las apps, tarea 7)", () => {
  it("🔴 tiene timeout, con su texto, y dice lo que pasa con la salida larga", () => {
    const p = DECLARACION_BASH.parameters as { properties: Record<string, { type: string; description: string }> };
    expect(p.properties.timeout).toEqual({ type: "NUMBER", description: "Optional timeout in milliseconds (max 600000)." });
    expect(String(DECLARACION_BASH.description)).toContain("- `timeout` is in milliseconds: default 120000, max 600000.");
    expect(String(DECLARACION_BASH.description)).toContain("is saved to a file in /tmp/tool-results and you get its path and a preview");
  });
});

describe("la palanca de la terminal", () => {
  // N45 (03/10, Jesús: «como DeepSeek lo hace»): en el arnés de DeepSeek la
  // terminal siempre está. Sin ella Len no veía las versiones guardadas
  // (`/.openlen/versiones` sólo vive en `bash`), y su encendido dependía de una
  // línea en la caja.
  it("encendida por defecto: sólo el literal \"0\" la apaga", () => {
    for (const v of [undefined, "1", "", "true"]) expect(terminalEncendida({ OPENLEN_TERMINAL: v })).toBe(true);
    expect(terminalEncendida(SIN)).toBe(false);
  });

  it("sin la variable, Len lee lo mismo que con ella", () => {
    expect(buildAgentSystemPrompt({})).toBe(buildAgentSystemPrompt(CON));
    expect(nombres({})).toEqual(nombres(CON));
  });

  it("con ella: entra bash y salen Grep y Glob; Read, Edit y Write se quedan", () => {
    expect(nombres(CON)).toContain(NOMBRE_BASH);
    expect(nombres(CON)).not.toContain("Grep");
    expect(nombres(CON)).not.toContain("Glob");
    for (const n of ["Read", "Edit", "Write"]) expect(nombres(CON)).toContain(n);
  });

  it("con ella, nada de lo que lee el modelo nombra una herramienta que no tiene; sin ella, sí (brazo de control)", () => {
    expect(textos(CON)).not.toMatch(/\bGrep\b|\bGlob\b/);
    expect(buildAgentSystemPrompt(CON)).toMatch(/\bbash\b/);
    expect(textos(SIN)).toMatch(/\bGrep\b/);
  });

  // F4: tres sustituciones se quedaron sin su frase cuando cambiaron los textos
  // (una desde `31a94a0e`) y nada lo avisó. Una que no encuentra nada es una
  // palanca a ninguna parte.
  it("con ella, tampoco en una APP (su prompt y su manual son los suyos)", () => {
    expect(textosDeApp(CON)).not.toMatch(/\bGrep\b|\bGlob\b/);
    expect(textosDeApp(SIN)).toMatch(/\bGrep\b/);
  });

  it("cada sustitución para la terminal encuentra su frase en lo que lee el modelo sin ella", () => {
    const sinElla = [buildAgentSystemPrompt(SIN), ...buildFunctionDeclarations(SIN).map((d) => JSON.stringify(d))].join("\n");
    expect(PARA_LA_TERMINAL.map(([de]) => de).filter((de) => !sinElla.includes(de))).toEqual([]);
  });

  it("apagada, todo sale como antes de la terminal: ni bash, y Grep y Glob vuelven", () => {
    expect(nombres(SIN)).not.toContain(NOMBRE_BASH);
    expect(nombres(SIN)).toEqual(expect.arrayContaining(["Grep", "Glob"]));
  });
});

// F4 (plans/len-agente-2026), punto 4: sólo la terminal para los ficheros,
// como el modo mínimo de DeepSeek. Desde el 03/10 es la mitad de Len Dynamis
// que toca las herramientas, y lo decide el MODO DEL TURNO (`lib/agent/dynamis.ts`),
// no una variable del servidor.
describe("Len Dynamis: sólo la terminal para los ficheros", () => {
  const nombresEn = (env: Record<string, string>, mode: AgentMode) =>
    buildFunctionDeclarations(env, {}, mode).map((d) => String(d.name));
  const todo = (env: Record<string, string>, mode: AgentMode = "len") =>
    [
      buildAgentSystemPrompt(env, mode),
      ...buildFunctionDeclarations(env, {}, mode).map((d) => String(d.description ?? "")),
      buildManualDeLaPlataforma(env, mode),
    ].join("\n");

  it("sólo con el modo Dynamis y la terminal encendida", () => {
    expect(terminalOnly("dynamis", CON)).toBe(true);
    expect(terminalOnly("dynamis", SIN)).toBe(false);
    expect(terminalOnly("len", CON)).toBe(false);
  });

  it("en Dynamis: bash y nada más para los ficheros; lo demás se queda", () => {
    const n = nombresEn(CON, "dynamis");
    expect(n).toContain(NOMBRE_BASH);
    for (const fuera of ["Read", "Edit", "Write", "Grep", "Glob"]) expect(n).not.toContain(fuera);
    for (const queda of ["view_page", "use_page", "publish", "ask_user_question", "undo_last_change", "web_search", "web_fetch"]) expect(n).toContain(queda);
  });

  it("🔴 en Dynamis, ni el prompt, ni las descripciones, ni /AGENTS.md nombran una herramienta que no tiene", () => {
    // «Read-only» no es la herramienta; «Read the current session goal» (la
    // descripción de `get_goal`, literal de DeepSeek, pieza 8) tampoco: es el verbo.
    expect(todo(CON, "dynamis")).not.toMatch(/\b(Read|Edit|Write|Grep|Glob)\b(?!-| the current session goal)/);
  });

  // 🔴 LA LÁPIDA de la palanca vieja: el valor que antes quitaba Read, Edit y
  // Write ahora no cambia nada. Una variable que sigue en un .env viejo no
  // puede volver a convertir un servidor entero en Dynamis.
  it("OPENLEN_SOLO_TERMINAL=1 ya no hace nada", () => {
    const VIEJA = { OPENLEN_TERMINAL: "1", OPENLEN_SOLO_TERMINAL: "1" };
    expect(todo(VIEJA)).toBe(todo(CON));
    expect(nombresEn(VIEJA, "len")).toEqual(expect.arrayContaining(["Read", "Edit", "Write"]));
  });

  it("con la terminal apagada, Dynamis no quita nada: Len sin manos no existe", () => {
    expect(todo(SIN, "dynamis")).toBe(todo(SIN));
    expect(nombresEn(SIN, "dynamis")).toEqual(expect.arrayContaining(["Read", "Edit", "Write", "Grep", "Glob"]));
  });

  it("🔴 tampoco en una APP en Dynamis", () => {
    expect(textosDeApp(CON, "dynamis")).not.toMatch(/\b(Read|Edit|Write|Grep|Glob)\b(?!-| the current session goal)/);
  });

  it("cada sustitución encuentra su frase en lo que lee el modelo con la terminal (en una página o en una app)", () => {
    const conTerminal = [
      buildAgentSystemPrompt(CON),
      ...buildFunctionDeclarations(CON).map((d) => JSON.stringify(d)),
      buildManualDeLaPlataforma(CON),
      textosDeApp(CON),
    ].join("\n");
    expect(PARA_SOLO_LA_TERMINAL.map(([de]) => de).filter((de) => !conTerminal.includes(de))).toEqual([]);
  });

  it("en Len (el modo por defecto), todo sale como con la terminal", () => {
    expect(todo(CON, "len")).toBe(todo(CON));
    expect(nombres(CON)).toEqual(expect.arrayContaining(["Read", "Edit", "Write"]));
  });
});

// LA CARPETA (pieza 9 de Len 2.5): la lista de ficheros de `bash` es el único
// sitio donde el modelo lee qué ficheros tiene el proyecto. Sin nombrar la
// carpeta, Len metería el JavaScript en la página como siempre.
describe("la lista de ficheros de bash nombra la carpeta", () => {
  const d = String(DECLARACION_BASH.description);
  it("los ficheros de la web, con sw.js y manifest.json", () => {
    expect(d).toContain("/js, /css, /data/*.json, /sw.js, /manifest.json");
    expect(d).toContain(".js .mjs .jsx .tsx .ts .css .json .webmanifest .txt .svg .md");
  });
  it("/tests, que no se publica, y que rm borra un fichero de la carpeta", () => {
    expect(d).toContain("/tests holds Playwright tests: not run here (there is no Playwright in this terminal), never published");
    expect(d).toContain("rm deletes a folder file");
  });
  it("rm also deletes a page that isn't the home (25/10), and no longer says the user has to", () => {
    expect(d).toContain("rm deletes a page other than /index.html");
    expect(d).not.toContain("pages are removed by the user");
  });
});

describe("git in the bash description (spec local 2026-10-15-git-for-len, §5)", () => {
  const bash = (env: Record<string, string>) => String(buildFunctionDeclarations(env).find((d) => d.name === "bash")!.description);
  it("says git works, keeps the versions apart from commits, and carries Claude Code's commit section", () => {
    const d = bash({ OPENLEN_TERMINAL: "1" });
    expect(d).toContain("no network, no node, npm or pip, but git (this project's repository, with branches and remotes), grep,");
    expect(d).not.toContain("no node, npm, pip or git");
    expect(d).toContain("These versions are automatic checkpoints the person can restore; git commits exist only when someone asks for one.");
    expect(d.endsWith(COMMITTING_WITH_GIT)).toBe(true);
    expect(COMMITTING_WITH_GIT).toContain("Only create commits when requested by the user. If unclear, ask first.");
    expect(COMMITTING_WITH_GIT).toContain("Co-Authored-By: Len <noreply@openlen.com>");
    expect(COMMITTING_WITH_GIT).not.toMatch(/--no-verify|force push|gh pr|amend/);
  });
  it("OPENLEN_GIT=0 leaves it exactly as before", () => {
    expect(bash({ OPENLEN_TERMINAL: "1", OPENLEN_GIT: "0" })).toContain("no network, no node, npm, pip or git, but grep,");
    expect(bash({ OPENLEN_TERMINAL: "1", OPENLEN_GIT: "0" })).not.toContain("Committing changes with git");
  });
  it("withGit finds its sentence (a substitution that finds nothing is a lever to nowhere)", () => {
    expect(() => withGit("nothing to replace")).toThrow();
    expect(withGit(String(DECLARACION_BASH.description))).not.toBe(String(DECLARACION_BASH.description));
  });
});

// LA TERMINAL REAL (spec local 2026-10-21-real-terminal-e2b, §11): con la caja encendida, bash dice
// que corre de verdad, dónde llega su red, que lo de los visitantes se lee con sus herramientas y
// que hay segundo plano. Apagada, la descripción es la de hoy, byte a byte.
describe("bash con la terminal real", () => {
  const bashDe = (env: Record<string, string>, app: { catalogo: string; entrada: string } | null = null) =>
    buildFunctionDeclarations(env, {}, "len", app as never).find((d) => d.name === NOMBRE_BASH)!;
  const SIN_CAJA = { OPENLEN_GIT: "0" };
  const CON_CAJA = { OPENLEN_GIT: "0", E2B_API_KEY: "k" };
  const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };

  it("apagada, la descripción y los parámetros son los de hoy", () => {
    expect(bashDe({ ...SIN_CAJA, OPENLEN_SANDBOX: "0", E2B_API_KEY: "k" })).toEqual(bashDe(SIN_CAJA));
    expect(JSON.stringify(bashDe(SIN_CAJA))).not.toContain("run_in_background");
  });

  // 🔴 Durante el despliegue por fases (OPENLEN_SANDBOX_ONLY_USERS), quien no está en la lista tiene la
  // terminal de siempre (terminalForTurn, sin aviso): bash tiene que decir ésa, no la caja.
  it("🔴 en un despliegue por fases, la de hoy para quien no está en la lista; la caja para quien sí", () => {
    const FASES = { ...CON_CAJA, OPENLEN_SANDBOX_ONLY_USERS: "u1" };
    const bashPara = (realTerminal: boolean) => buildFunctionDeclarations(FASES, { realTerminal }, "len", null).find((d) => d.name === NOMBRE_BASH)!;
    expect(bashPara(false)).toEqual(bashDe(SIN_CAJA));
    expect(JSON.stringify(bashPara(true))).toContain("run_in_background");
    // Sin persona (scripts, Len-Bench), como quien no está en la lista.
    expect(bashDe(FASES)).toEqual(bashDe(SIN_CAJA));
  });

  it("encendida, dice que corre de verdad y hasta dónde llega su red", () => {
    const d = String(bashDe(CON_CAJA).description);
    expect(d).not.toContain("interprets commands without running real programs");
    expect(d).toContain("isolated Linux computer");
    expect(d).toContain("python3 with pip");
    // OFFICE SKILLS (spec local 2026-10-26-len-skills): what is installed for them, named.
    expect(d).toContain("LibreOffice (soffice) and openpyxl, pandas, python-docx and python-pptx");
    // THE PDF SKILL (spec local 2026-10-27-len-pdf-skill, §4.7).
    expect(d).toContain("For PDFs it has pypdf, pdfplumber, reportlab, qpdf, poppler (pdftotext, pdftoppm) and tesseract.");
    expect(d).toContain("package registries (npm, PyPI) and GitHub");
  });

  it("lo de los visitantes se lee con sus herramientas, no en la terminal", () => {
    const d = String(bashDe(CON_CAJA).description);
    expect(d).not.toContain("/.openlen/bandeja/formularios.jsonl");
    expect(d).not.toContain("/.openlen/resultados/visitas.json");
    expect(d).toContain("list_form_submissions");
    expect(d).toContain("get_visits");
  });

  it("dice lo del segundo plano y trae run_in_background", () => {
    const d = bashDe(CON_CAJA);
    expect(String(d.description)).toContain("keeps running in the background");
    expect(JSON.stringify(d.parameters)).toContain("run_in_background");
  });

  it("con git, en una app, también", () => {
    const d = String(bashDe({ E2B_API_KEY: "k" }, APP).description);
    expect(d).toContain("isolated Linux computer");
    expect(d).toContain("this project's repository (branches and remotes; fetch, pull and push go through OpenLen)");
    expect(d).toContain("npm test, npm run build");
  });

  it("no promete que una búsqueda de / se salte nada: en la caja recorre el ordenador entero", () => {
    for (const d of [bashDe(CON_CAJA), bashDe({ E2B_API_KEY: "k" }, APP)].map((x) => String(x.description))) {
      expect(d).not.toMatch(/grep -r \/,? does not enter it/);
      expect(d).not.toContain("does not enter it unless you name it");
      expect(d).toContain("not with grep -r /");
    }
  });

  it("en una página, /tests se corre: npx playwright test contra $BASE_URL", () => {
    const d = String(bashDe(CON_CAJA).description);
    expect(d).not.toContain("there is no Playwright in this terminal");
    expect(d).toContain("npx playwright test");
    expect(d).toContain("$BASE_URL");
  });

  it("en una app, /tests sigue siendo de vitest", () => {
    const d = String(bashDe({ ...CON_CAJA }, APP).description);
    expect(d).toContain("/tests holds the app's tests (vitest)");
    expect(d).not.toContain("npx playwright test");
  });

  it("withSandbox encuentra su frase (si no, falla)", () => {
    expect(() => withSandbox("nothing to replace")).toThrow();
  });
});
