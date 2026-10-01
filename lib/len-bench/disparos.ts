// lib/len-bench/disparos.ts — LAS PRUEBAS DE DISPARO: ¿llama Len a una
// herramienta cuando toca, y SÓLO cuando toca?
//
// Como el `/plugin eval` de Claude Code (su «trigger test»), visto el
// 30/09/2026. Lo que se toma:
//   - Una carpeta por skill —aquí, por HERRAMIENTA— con consultas `*.md`. Cada
//     una lleva un frontmatter con `query` (texto, no vacío) y `should_trigger`
//     (booleano). Lo que va debajo son NOTAS (su `notes`): no las ve nadie más
//     que quien lee el caso.
//   - Recomiendan al menos 5 (`tl=5`) y AVISAN si hay menos; no paran.
//   - Un fichero roto no tumba la carpeta: se avisa y se sigue con los demás.
//   - Pasa si lo que hizo el modelo === `should_trigger`; una consulta que
//     revienta cuenta como FALLO, con el error de motivo.
//   - El informe: «[PASS   ] fichero — expected trigger, got skip», el motivo
//     debajo de cada fallo y «N/M trigger tests passed». Sale ≠ 0 si falla
//     alguna.
// Lo que NO se copia: su evaluador aún no está conectado (`nl=async()=>null`,
// «Model evaluation not yet wired up»); recibe la descripción de la skill y la
// consulta. Aquí no se le pregunta a nadie si llamaría: se corre UN turno de
// verdad y se mira si llamó. Eso lo hace scripts/len-bench-disparos.ts; esto
// es la parte pura (más la lectura de la carpeta).

import fs from "node:fs";
import path from "node:path";

/** Las que recomiendan como mínimo: su `tl=5`. */
export const MINIMO_DE_CONSULTAS = 5;

export interface ConsultaDeDisparo {
  readonly fichero: string;
  readonly query: string;
  readonly shouldTrigger: boolean;
  readonly notas?: string;
}

/** Su `Yk`: el bloque entre dos `---`, al principio del fichero. */
const FRONTMATTER = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

const ESPERADO = "(se esperaba ---\\nquery: …\\nshould_trigger: …\\n---)";

/**
 * Un escalar de YAML en una línea. No hay librería de YAML en el repo, así que
 * esto lee lo justo —`"…"`, `'…'`, `true`/`false` y texto llano— y RECHAZA lo
 * que una de verdad leería distinto, para que una carpeta que pasa aquí también
 * pase en un lector de YAML de verdad.
 */
function escalar(crudo: string): { ok: true; valor: string | boolean } | { ok: false; motivo: string } {
  const v = crudo.trim();
  if (/^(true|True|TRUE)$/.test(v)) return { ok: true, valor: true };
  if (/^(false|False|FALSE)$/.test(v)) return { ok: true, valor: false };
  if (v.startsWith('"')) {
    try {
      const valor: unknown = JSON.parse(v);
      if (typeof valor === "string") return { ok: true, valor };
    } catch {
      // cae al error de abajo
    }
    return { ok: false, motivo: `comillas dobles sin cerrar o con algo detrás: ${v.slice(0, 60)}` };
  }
  if (v.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'$/.exec(v);
    if (m) return { ok: true, valor: m[1]!.replace(/''/g, "'") };
    return { ok: false, motivo: `comillas simples sin cerrar o con algo detrás: ${v.slice(0, 60)}` };
  }
  if (/^[[{|>&*!%@`]/.test(v)) {
    return { ok: false, motivo: `«${v.slice(0, 1)}» al principio de un valor es sintaxis de YAML que este lector no entiende: ponlo entre comillas` };
  }
  // Texto llano. En YAML, « #» abre un comentario y «: » dentro de un valor sin
  // comillas es un error («cambia el horario: abrimos de 8 a 8»).
  const llano = v.replace(/\s+#.*$/, "");
  if (/:(\s|$)/.test(llano)) return { ok: false, motivo: `un valor sin comillas no puede llevar «: »; ponlo entre comillas: ${llano.slice(0, 60)}` };
  return { ok: true, valor: llano };
}

/** El frontmatter como mapa de `clave: valor` de una línea; nada más. */
export function leerFrontmatter(bloque: string): { ok: true; campos: Record<string, string | boolean> } | { ok: false; motivo: string } {
  const campos: Record<string, string | boolean> = {};
  const lineas = bloque.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]!.trimEnd();
    if (l.trim() === "" || l.trimStart().startsWith("#")) continue;
    const m = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(l);
    if (!m) {
      return {
        ok: false,
        motivo: `línea ${i + 1} («${l.trim().slice(0, 60)}»): este lector sólo entiende «clave: valor» en una línea (no hay librería de YAML en el repo)`,
      };
    }
    const clave = m[1]!;
    if (clave in campos) return { ok: false, motivo: `«${clave}» aparece dos veces` };
    const e = escalar(m[2] ?? "");
    if (!e.ok) return { ok: false, motivo: `${clave}: ${e.motivo}` };
    campos[clave] = e.valor;
  }
  return { ok: true, campos };
}

/** Una consulta, o el aviso que la deja fuera (su `k.push(...)`). */
export function leerConsulta(fichero: string, texto: string): { ok: true; consulta: ConsultaDeDisparo } | { ok: false; aviso: string } {
  // Su `GS`: sin BOM y con saltos de línea de Unix. En Windows el fichero
  // puede salir del checkout con CRLF.
  const limpio = texto.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const fm = FRONTMATTER.exec(limpio);
  if (!fm) return { ok: false, aviso: `${fichero}: falta el frontmatter de YAML ${ESPERADO}.` };
  const leido = leerFrontmatter(fm[1] ?? "");
  if (!leido.ok) return { ok: false, aviso: `${fichero}: YAML no válido — ${leido.motivo}` };
  // Su esquema: `query` texto con al menos un carácter, `should_trigger`
  // booleano. Las claves de más se ignoran, como en su `z.object`.
  const { query, should_trigger: debe } = leido.campos;
  const problemas: string[] = [];
  if (query === undefined) problemas.push("query: falta");
  else if (typeof query !== "string") problemas.push("query: tiene que ser texto");
  else if (query.length === 0) problemas.push("query: está vacía");
  if (debe === undefined) problemas.push("should_trigger: falta");
  else if (typeof debe !== "boolean") problemas.push("should_trigger: tiene que ser true o false, sin comillas");
  if (problemas.length > 0) return { ok: false, aviso: `${fichero}: ${problemas.join("; ")}` };
  const notas = limpio.slice(fm[0].length).trim();
  return { ok: true, consulta: { fichero, query: query as string, shouldTrigger: debe as boolean, ...(notas ? { notas } : {}) } };
}

/** Las consultas de UNA carpeta, en orden de nombre, y sus avisos (su `Jg`). */
export function cargarConsultas(dir: string): { consultas: ConsultaDeDisparo[]; avisos: string[] } {
  let ficheros: string[];
  try {
    ficheros = fs.readdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        consultas: [],
        avisos: [`No hay carpeta de disparos en ${dir}. Crea una con al menos ${MINIMO_DE_CONSULTAS} <nombre>.md (frontmatter: query, should_trigger).`],
      };
    }
    throw e;
  }
  const consultas: ConsultaDeDisparo[] = [];
  const avisos: string[] = [];
  for (const f of ficheros.filter((x) => x.endsWith(".md")).sort()) {
    let texto: string;
    try {
      texto = fs.readFileSync(path.join(dir, f), "utf8");
    } catch (e) {
      avisos.push(`No se pudo leer ${f}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const r = leerConsulta(f, texto);
    if (r.ok) consultas.push(r.consulta);
    else avisos.push(r.aviso);
  }
  if (consultas.length > 0 && consultas.length < MINIMO_DE_CONSULTAS) {
    avisos.push(
      `Sólo hay ${consultas.length} ${consultas.length === 1 ? "consulta" : "consultas"}; se recomiendan al menos ${MINIMO_DE_CONSULTAS} para que la cobertura diga algo.`,
    );
  }
  return { consultas, avisos };
}

export interface CarpetaDeDisparos {
  /** El nombre de la carpeta: la herramienta de Len que se prueba. */
  readonly herramienta: string;
  readonly dir: string;
  readonly consultas: readonly ConsultaDeDisparo[];
  readonly avisos: readonly string[];
}

/** Cada subcarpeta de `raiz` es una herramienta (como cada skill, la suya). */
export function cargarDisparos(raiz: string): CarpetaDeDisparos[] {
  return fs
    .readdirSync(raiz, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((herramienta) => {
      const dir = path.join(raiz, herramienta);
      return { herramienta, dir, ...cargarConsultas(dir) };
    });
}

export type Veredicto = "pasa" | "falla" | "saltada";

export interface ResultadoDeDisparo {
  readonly consulta: ConsultaDeDisparo;
  /** ¿Llamó a la herramienta? `null` si no se corrió o el turno no llegó a decidir. */
  readonly llamo: boolean | null;
  readonly veredicto: Veredicto;
  readonly motivo: string;
  /** Lo grabado del turno, en dólares (sin el margen de lo no grabado). */
  readonly usd: number;
}

/** El veredicto de una consulta que se corrió: pasa si (llamó) === `should_trigger`. */
export function veredicto(debia: boolean, llamadas: readonly string[], herramienta: string): { llamo: boolean; veredicto: "pasa" | "falla" } {
  const llamo = llamadas.includes(herramienta);
  return { llamo, veredicto: llamo === debia ? "pasa" : "falla" };
}

/** Lo que Len llamó, en palabras: la mitad del motivo de un fallo. */
export function lasLlamadas(llamadas: readonly string[]): string {
  return llamadas.length > 0 ? `llamó a ${llamadas.join(", ")}` : "no llamó a ninguna herramienta";
}

export interface InformeDeHerramienta extends CarpetaDeDisparos {
  readonly resultados: readonly ResultadoDeDisparo[];
}

export function cuentas(resultados: readonly ResultadoDeDisparo[]): { pasan: number; fallan: number; saltadas: number } {
  return {
    pasan: resultados.filter((r) => r.veredicto === "pasa").length,
    fallan: resultados.filter((r) => r.veredicto === "falla").length,
    saltadas: resultados.filter((r) => r.veredicto === "saltada").length,
  };
}

/** «N/M pruebas de disparo pasaron (K saltadas).» — su línea final. */
export function lineaDeTotal(c: { pasan: number; fallan: number; saltadas: number }): string {
  const saltadas = c.saltadas > 0 ? ` (${c.saltadas} ${c.saltadas === 1 ? "saltada" : "saltadas"})` : "";
  return `${c.pasan}/${c.pasan + c.fallan} pruebas de disparo pasaron${saltadas}.`;
}

/** El informe de una herramienta, con la forma del suyo (`il`). */
export function informe(h: InformeDeHerramienta): string {
  const l: string[] = [`Evaluando ${h.herramienta} (${h.dir})`, ""];
  for (const a of h.avisos) l.push(`! ${a}`);
  if (h.avisos.length > 0) l.push("");
  if (h.consultas.length === 0) {
    l.push("No hay consultas que correr.");
    return l.join("\n");
  }
  l.push("Pruebas de disparo:");
  for (const r of h.resultados) {
    const etiqueta = r.veredicto.toUpperCase().padEnd(7);
    const debia = r.consulta.shouldTrigger ? "debía llamar" : "no debía llamar";
    if (r.veredicto === "saltada" || r.llamo === null) {
      l.push(`  [${etiqueta}] ${r.consulta.fichero} — ${debia}`);
    } else {
      l.push(`  [${etiqueta}] ${r.consulta.fichero} — ${debia}, ${r.llamo ? "llamó" : "no llamó"}`);
    }
    if (r.veredicto === "falla") l.push(`            ${r.motivo}`);
  }
  l.push("");
  const c = cuentas(h.resultados);
  l.push(c.saltadas === h.resultados.length ? "Todas las pruebas de disparo se saltaron." : lineaDeTotal(c));
  return l.join("\n");
}

/**
 * La salida del proceso. Como su `process.exitCode`: 1 si falla alguna. Y 2 si
 * el número no es el de la carpeta entera (el tope saltó consultas), como
 * `salidaDeLaSuite`: un «5/5» de 5 corridas de 8 no puede salir en verde.
 */
export function salidaDeDisparos(c: { fallan: number; saltadas: number }): 0 | 1 | 2 {
  if (c.saltadas > 0) return 2;
  return c.fallan > 0 ? 1 : 0;
}
