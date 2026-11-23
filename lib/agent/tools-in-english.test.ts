// LAS HERRAMIENTAS DE LEN, EN INGLÉS (plans/crear-es-len/plan-herramientas.md,
// 2026-10-06), como las de DeepSeek: `bash`, `send_message`, `list_agents`.
// La guarda de que no vuelva un nombre, un parámetro ni un valor en español a
// lo que lee el modelo.
import { describe, expect, it } from "vitest";
import { buildFunctionDeclarations } from "./catalog";
import { buildManualDeLaPlataforma, documentosDeLaPlataforma } from "./manual-de-la-plataforma";
import { TOOL_RENAMES } from "./tool-renames";
import { ASK_LEN_DECLARATION } from "@/lib/assistants/ask-len";
import { MESSAGE_AGENT_DECLARATION, MESSAGE_LEN_DECLARATION } from "@/lib/assistants/messages/tool";

// Lo que se retiró: nombres de herramienta, claves y valores en español.
const VIEJOS_NOMBRES = Object.keys(TOOL_RENAMES);
const VIEJAS_CLAVES = [
  "modulo", "encender", "numero", "tipo", "pregunta", "zona", "pasos", "pulsa", "escribe", "en", "elige",
  "dentro_de", "recarga", "lee", "busqueda", "estilo", "imagen_url", "instruccion", "subdominio", "idiomas",
  "desde", "hasta", "cuales", "para", "texto",
];
const VIEJOS_VALORES = ["medir", "describir", "nuevos", "fecha", "uno", "sin_leer", "una", "formulario"];

function walk(schema: unknown, keys: string[], values: string[]): void {
  if (!schema || typeof schema !== "object") return;
  const s = schema as { properties?: Record<string, unknown>; items?: unknown; enum?: unknown[] };
  if (Array.isArray(s.enum)) values.push(...s.enum.filter((v): v is string => typeof v === "string"));
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    keys.push(k);
    walk(v, keys, values);
  }
  walk(s.items, keys, values);
}

describe("las herramientas de Len, en inglés (como DeepSeek)", () => {
  for (const mode of ["len", "dynamis"] as const) {
    it(`ningún nombre, parámetro ni valor en español (${mode})`, () => {
      const decls = buildFunctionDeclarations({}, {}, mode) as { name: string; description?: string; parameters?: unknown }[];
      const keys: string[] = [];
      const values: string[] = [];
      for (const d of decls) walk(d.parameters, keys, values);
      expect(decls.map((d) => d.name).filter((n) => VIEJOS_NOMBRES.includes(n))).toEqual([]);
      expect(keys.filter((k) => VIEJAS_CLAVES.includes(k))).toEqual([]);
      expect(values.filter((v) => VIEJOS_VALORES.includes(v))).toEqual([]);
      for (const d of decls) {
        for (const viejo of VIEJOS_NOMBRES) expect(d.description ?? "").not.toContain(viejo);
      }
    });
  }

  // The ones the route adds only to the person's agent, after Len's (app/api/agent/route.ts): `ask_len` and `message_len`
  // (spec local 2026-11-21-len-y-el-agente-conversan). They aren't in the catalog, so they are walked here. (Its artifacts'
  // tools are Len's, in the catalog, and walked with it: spec local 2026-11-22-artifacts-de-len.)
  it("ni las que sólo tiene el agente de la persona", () => {
    const keys: string[] = [];
    const values: string[] = [];
    for (const d of [ASK_LEN_DECLARATION, MESSAGE_LEN_DECLARATION]) walk(d.parameters, keys, values);
    expect(keys).toEqual(expect.arrayContaining(["request", "project", "message"]));
    expect(keys.filter((k) => VIEJAS_CLAVES.includes(k))).toEqual([]);
    expect(values.filter((v) => VIEJOS_VALORES.includes(v))).toEqual([]);
  });

  // And the one the route adds to Len LAST, only in a project with agents related to it: `message_agent`.
  it("ni la que la ruta le añade a Len con agentes relacionados", () => {
    const keys: string[] = [];
    const values: string[] = [];
    walk(MESSAGE_AGENT_DECLARATION.parameters, keys, values);
    expect(MESSAGE_AGENT_DECLARATION.name).toBe("message_agent");
    expect(keys).toEqual(["to", "message"]);
    expect(keys.filter((k) => VIEJAS_CLAVES.includes(k))).toEqual([]);
    expect(values.filter((v) => VIEJOS_VALORES.includes(v))).toEqual([]);
    for (const viejo of VIEJOS_NOMBRES) expect(MESSAGE_AGENT_DECLARATION.description).not.toContain(viejo);
  });

  it("el manual tampoco nombra las viejas", () => {
    const textos = [buildManualDeLaPlataforma({}), ...Object.values(documentosDeLaPlataforma())];
    for (const t of textos) for (const viejo of VIEJOS_NOMBRES) expect(t).not.toContain(viejo);
  });
});
