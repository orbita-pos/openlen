/**
 * TOOLSEARCH Y LAS HERRAMIENTAS DIFERIDAS, como Claude Code (H2 de Len 2.x).
 *
 * Claude Code no le carga al modelo todas sus herramientas: las que se usan poco
 * van DIFERIDAS —el modelo ve sólo su nombre, en un `<system-reminder>`— y las
 * trae cuando las necesita con ToolSearch, que devuelve su esquema en un bloque
 * `<functions>`. Desde ahí se pueden llamar como cualquier otra. Len hace lo
 * mismo con las siete que en 1.574 llamadas grabadas (Len-Bench, 2026-09-25) se
 * usaron dos veces o ninguna.
 *
 * El mecanismo y las tres formas de consulta son los de Claude Code; los
 * textos que lee el modelo están escritos con palabras nuestras (2026-09-27),
 * con ejemplos de las herramientas de Len.
 */

type Declaracion = Record<string, unknown> & { readonly name?: unknown; readonly description?: unknown };

export const NOMBRE_TOOL_SEARCH = "ToolSearch";

const DESCRIPCION = `Loads the full definition of deferred tools so that you can call them.

A deferred tool is listed by name only, in a <system-reminder>. Until you load it you do not have its parameters, and calling it fails with an InputValidationError. Whenever an instruction, a reminder or another tool's description points you to one of them, load it first with query "select:<name>".

What comes back is a <functions> block, and inside it each tool on a line of its own: <function>{"description": "...", "name": "...", "parameters": {...}}</function>, written the same way as the tools at the top of this prompt. From then on you call it like any other tool.

Ways to query:
- "select:activar_modulo,editar_imagen" — load exactly these tools, by name
- "imagen fondo" — search by keywords; returns up to max_results of the best matches
- "+modulo chat" — the name must contain "modulo"; the other words rank the results`;

export const DECLARACION_TOOL_SEARCH: Record<string, unknown> = {
  name: NOMBRE_TOOL_SEARCH,
  description: DESCRIPCION,
  parameters: {
    type: "OBJECT",
    properties: {
      query: { type: "STRING", description: 'What to look for: "select:<name>" to load a tool by its name, or keywords to search.' },
      max_results: { type: "NUMBER", description: "How many tools to return at most (5 if you leave it out)" },
    },
    required: ["query"],
  },
};

export const NINGUNA_DIFERIDA = "No deferred tool matches that query.";

export const AVISO_DIFERIDAS =
  'These tools are deferred: you have their names but not their parameters, so calling one before loading it fails with an InputValidationError. Load them with ToolSearch, query "select:<name>[,<name>...]":';

/** El `<system-reminder>` con los nombres de las diferidas, uno por línea. */
export function avisoDeDiferidas(nombres: readonly string[]): string {
  return `<system-reminder>\n${AVISO_DIFERIDAS}\n${nombres.join("\n")}\n</system-reminder>`;
}

/**
 * Lo que contesta el bucle si el modelo llama a una diferida sin cargarla.
 * Claude Code falla con InputValidationError (su descripción lo promete); la
 * frase de después es nuestra —Claude Code no la trae—: dice cómo cargarla.
 */
export function errorDeNoCargada(nombre: string): string {
  return `<tool_use_error>InputValidationError: ${nombre} is a deferred tool and its schema is not loaded. Load it with ToolSearch query "select:${nombre}" before calling it.</tool_use_error>`;
}

const texto = (d: Declaracion) => `${String(d.name ?? "")} ${String(d.description ?? "")}`.toLowerCase();
const palabras = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9_ñ+]+/)
    .filter(Boolean);
const llano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Las diferidas que casan con la consulta, en las tres formas de Claude Code. */
export function buscarDiferidas(query: string, maxResults: number, diferidas: readonly Declaracion[]): Declaracion[] {
  const q = query.trim();
  if (q.toLowerCase().startsWith("select:")) {
    const pedidas = q.slice("select:".length).split(",").map((s) => s.trim()).filter(Boolean);
    return pedidas.flatMap((n) => diferidas.filter((d) => d.name === n));
  }
  const terminos = palabras(q);
  const exigidas = terminos.filter((t) => t.startsWith("+")).map((t) => t.slice(1)).filter(Boolean);
  const resto = terminos.filter((t) => !t.startsWith("+"));
  const tope = Number.isFinite(maxResults) && maxResults > 0 ? Math.floor(maxResults) : 5;
  return diferidas
    .filter((d) => exigidas.every((e) => llano(String(d.name ?? "")).toLowerCase().includes(e)))
    .map((d) => {
      const t = llano(texto(d));
      const nombre = llano(String(d.name ?? "")).toLowerCase();
      const puntos = resto.reduce((p, r) => p + (nombre.includes(r) ? 3 : 0) + (t.includes(r) ? 1 : 0), 0);
      return { d, puntos };
    })
    .filter((x) => exigidas.length > 0 || x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, tope)
    .map((x) => x.d);
}

/** El bloque `<functions>` de Claude Code: una `<function>` por línea. */
export function bloqueDeFunciones(decls: readonly Declaracion[]): string {
  const lineas = decls.map(
    (d) => `<function>${JSON.stringify({ description: d.description, name: d.name, parameters: d.parameters })}</function>`,
  );
  return `<functions>\n${lineas.join("\n")}\n</functions>`;
}
