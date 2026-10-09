// lib/agent/terminal/declaracion.test.ts — lo que ve el modelo con y sin la terminal (F1).
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "@/lib/agent/catalog";
import { buildManualDeLaPlataforma } from "@/lib/agent/manual-de-la-plataforma";
import type { AgentMode } from "@/lib/agent/dynamis";
import { DECLARACION_BASH, NOMBRE_BASH, PARA_LA_TERMINAL, PARA_SOLO_LA_TERMINAL, terminalEncendida, terminalOnly } from "./declaracion";

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
    expect(d).toContain("/tests holds Playwright tests, never published");
    expect(d).toContain("rm deletes a folder file");
  });
});
