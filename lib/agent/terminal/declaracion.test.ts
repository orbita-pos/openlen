// lib/agent/terminal/declaracion.test.ts — lo que ve el modelo con y sin la terminal (F1).
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "@/lib/agent/catalog";
import { buildManualDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import type { AgentMode } from "@/lib/agent/dynamis";
import { COMMITTING_WITH_GIT, DECLARACION_BASH, NOMBRE_BASH, PARA_LA_TERMINAL, terminalEncendida, withGit, withGitRemote, withSandbox } from "./declaracion";

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
    for (const n of ["Read", "Edit", "MultiEdit", "Write"]) expect(nombres(CON)).toContain(n);
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

// LEN ODYSSEY (`mode: "dynamis"`, `lib/agent/dynamis.ts`): el 03/10 corrió en
// modo mínimo sin `Read`/`Edit`/`Write`; hoy corre Kimi K3.1 Pro con las mismas
// herramientas completas de ficheros que Len (`Read`, `Edit`, `MultiEdit`,
// `Write` + `bash`) MÁS `run_code` (Code Mode / Programmatic Tool Calling).
describe("Len Odyssey (dynamis): conserva herramientas completas de ficheros y añade run_code", () => {
  const nombresEn = (env: Record<string, string>, mode: AgentMode) =>
    buildFunctionDeclarations(env, {}, mode).map((d) => String(d.name));
  const todo = (env: Record<string, string>, mode: AgentMode = "len") =>
    [
      buildAgentSystemPrompt(env, mode),
      ...buildFunctionDeclarations(env, {}, mode).map((d) => String(d.description ?? "")),
      buildManualDeLaPlataforma(env, mode),
    ].join("\n");

  it("en Dynamis se declaran Read, Edit, MultiEdit, Write, bash y run_code; en Len normal no entra run_code", () => {
    const nDynamis = nombresEn(CON, "dynamis");
    const nLen = nombresEn(CON, "len");
    expect(nLen).not.toContain("run_code");
    expect(nDynamis).toEqual([...nLen, "run_code"]);
    for (const herramienta of [NOMBRE_BASH, "run_code", "Read", "Edit", "MultiEdit", "Write", "view_page", "use_page", "publish", "ask_user_question", "undo_last_change", "web_search", "web_fetch"]) {
      expect(nDynamis).toContain(herramienta);
    }
    for (const fuera of ["Grep", "Glob"]) expect(nDynamis).not.toContain(fuera);
  });

  it("con OPENLEN_CODE_MODE=0, Dynamis apaga run_code pero conserva su postura y especialistas", () => {
    const SIN_CODE_MODE = { ...CON, OPENLEN_CODE_MODE: "0" };
    expect(nombresEn(SIN_CODE_MODE, "dynamis")).toEqual(nombresEn(SIN_CODE_MODE, "len"));
    expect(buildAgentSystemPrompt(SIN_CODE_MODE, "dynamis")).toContain("Architectural Creation Posture");
    expect(buildAgentSystemPrompt(SIN_CODE_MODE, "len")).not.toContain("Architectural Creation Posture");
  });

  // 🔴 LA LÁPIDA de la palanca vieja: el valor que antes quitaba Read, Edit y
  // Write ahora no cambia nada. Una variable que sigue en un .env viejo no
  // puede volver a quitar herramientas en silencio.
  it("OPENLEN_SOLO_TERMINAL=1 ya no hace nada", () => {
    const VIEJA = { OPENLEN_TERMINAL: "1", OPENLEN_SOLO_TERMINAL: "1" };
    expect(todo(VIEJA)).toBe(todo(CON));
    expect(nombresEn(VIEJA, "len")).toEqual(expect.arrayContaining(["Read", "Edit", "Write"]));
  });

  it("con la terminal apagada, Dynamis tampoco cambia nada", () => {
    expect(todo(SIN, "dynamis")).toBe(todo(SIN));
    expect(nombresEn(SIN, "dynamis")).toEqual(expect.arrayContaining(["Read", "Edit", "Write", "Grep", "Glob"]));
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

describe("Claude Code's git protocol when the project has a remote (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8)", () => {
  const bash = (caps: Parameters<typeof buildFunctionDeclarations>[1], env: Record<string, string> = { OPENLEN_TERMINAL: "1" }) =>
    String(buildFunctionDeclarations(env, caps).find((d) => d.name === "bash")!.description);

  it("🔴 without a remote, the description is byte for byte today's (the cached prefix doesn't move)", () => {
    expect(bash({ gitRemote: false })).toBe(bash({}));
    expect(bash({ gitRemote: false, realTerminal: true })).toBe(bash({ realTerminal: true }));
  });

  it("🔴 with one: pull requests with gh pr create, no push unless asked, never a force push to main/master", () => {
    for (const realTerminal of [false, true]) {
      const d = bash({ gitRemote: true, realTerminal });
      expect(d).toContain("# Creating pull requests");
      expect(d).toContain('gh pr create --title "the pr title" --body "$(cat <<\'EOF\'');
      expect(d).toContain("- NEVER run force push to main/master, warn the user if they request it");
      expect(d).toContain("- DO NOT push to the remote repository unless the user explicitly asks you to do so");
      expect(d).toContain("(push --force, checkout ., restore ., branch -D)");
      expect(d).toContain("GitHub notifies the owner of any `@name` written in a PR, issue, or comment.");
      expect(d).toContain("🤖 Generated with [Len](https://openlen.com)");
      // What doesn't exist here stays out: hooks, gh api, the Task tools.
      expect(d).not.toMatch(/--no-verify|gh api|TodoWrite/);
    }
  });

  it("only where there is git", () => {
    expect(bash({ gitRemote: true }, { OPENLEN_TERMINAL: "1", OPENLEN_GIT: "0" })).not.toContain("# Creating pull requests");
  });

  it("withGitRemote finds every sentence it changes", () => {
    expect(() => withGitRemote("nothing to replace")).toThrow();
  });
});

// LA TERMINAL REAL (spec local 2026-10-21-real-terminal-e2b, §11): con la caja encendida, bash dice
// que corre de verdad, dónde llega su red, que lo de los visitantes se lee con sus herramientas y
// que hay segundo plano. Apagada, la descripción es la de hoy, byte a byte.
describe("bash con la terminal real", () => {
  // `realTerminal`: whose turn has the box (since 05/11 the owner's plan decides, spec local 2026-11-05-modo-juego-
  // design, §11; without a person nobody has it). The «on» cases say so, as the route does.
  const bashDe = (env: Record<string, string>, app: { catalogo: string; entrada: string } | null = null, realTerminal?: boolean) =>
    buildFunctionDeclarations(env, realTerminal === undefined ? {} : { realTerminal }, "len", app as never).find((d) => d.name === NOMBRE_BASH)!;
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
    const d = String(bashDe(CON_CAJA, null, true).description);
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
    const d = String(bashDe(CON_CAJA, null, true).description);
    expect(d).not.toContain("/.openlen/bandeja/formularios.jsonl");
    expect(d).not.toContain("/.openlen/resultados/visitas.json");
    expect(d).toContain("list_form_submissions");
    expect(d).toContain("get_visits");
  });

  it("dice lo del segundo plano y trae run_in_background", () => {
    const d = bashDe(CON_CAJA, null, true);
    expect(String(d.description)).toContain("keeps running in the background");
    expect(JSON.stringify(d.parameters)).toContain("run_in_background");
  });

  it("con git, en una app, también", () => {
    const d = String(bashDe({ E2B_API_KEY: "k" }, APP, true).description);
    expect(d).toContain("isolated Linux computer");
    expect(d).toContain("this project's repository (branches and remotes; fetch, pull and push go through OpenLen)");
    expect(d).toContain("npm test, npm run build");
  });

  it("no promete que una búsqueda de / se salte nada: en la caja recorre el ordenador entero", () => {
    for (const d of [bashDe(CON_CAJA, null, true), bashDe({ E2B_API_KEY: "k" }, APP, true)].map((x) => String(x.description))) {
      expect(d).not.toMatch(/grep -r \/,? does not enter it/);
      expect(d).not.toContain("does not enter it unless you name it");
      expect(d).toContain("not with grep -r /");
    }
  });

  it("en una página, /tests se corre: npx playwright test contra $BASE_URL", () => {
    const d = String(bashDe(CON_CAJA, null, true).description);
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
