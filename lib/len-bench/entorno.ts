// lib/len-bench/entorno.ts — dónde vive Len-Bench y qué NO puede tocar.
//
// Len-Bench publica de verdad (`publishProject`), y publicar sube una copia de
// la release a R2 y purga Cloudflare si encuentra sus credenciales. Contra la
// base local eso sería subir releases de prueba al bucket de copias de
// PRODUCCIÓN. Y cada formulario que un grader envía avisa al dueño por CORREO
// (/api/f/<sub> → notifyOwner → Resend, a la bandeja real +openlen-eval): las
// validaciones del 2026-09-23 gastaron así la cuota de Resend. Así que las
// credenciales se VACÍAN — y los nombres se sacan del
// código, no de una lista escrita a mano: una lista copiada se queda vieja el
// día que alguien añade una variable (memoria `la-guarda-que-compara-dos-copias`).

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";

export const RAIZ_LEN_BENCH = path.join("plans", "len-2");
export const DIR_PUBLICADAS = path.join(RAIZ_LEN_BENCH, "publicadas");
export const DIR_GRABACIONES = path.join(RAIZ_LEN_BENCH, "grabaciones");
export const DIR_CORRIDAS = path.join(RAIZ_LEN_BENCH, "corridas");
export const PUERTO_LEN_BENCH = 3007;
export const BASE_LEN_BENCH = `http://localhost:${PUERTO_LEN_BENCH}`;

// Sin RESEND_API_KEY, lib/email.ts escribe el aviso en el log del servidor y no
// manda nada; el grader lee la bandeja en la base, no el correo.
const PREFIJOS = ["R2_", "CLOUDFLARE_", "RESEND_"] as const;

function tsDe(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsDe(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

export function variablesApagadas(raizRepo: string): string[] {
  const nombres = new Set<string>();
  for (const sub of ["lib", "app"]) {
    for (const f of tsDe(path.join(raizRepo, sub))) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        if (PREFIJOS.some((p) => m[1].startsWith(p))) nombres.add(m[1]);
      }
    }
  }
  return [...nombres].sort();
}

// Un registro normal y no `NodeJS.ProcessEnv`: en este repo los tipos de Next
// hacen obligatorio `NODE_ENV`, y un entorno construido a mano no lo lleva.
export type Entorno = Record<string, string | undefined>;

export function entornoDeLenBench(base: Readonly<Entorno>, raizRepo: string): Entorno {
  const env: Entorno = { ...base };
  for (const n of variablesApagadas(raizRepo)) env[n] = "";
  for (const k of Object.keys(env)) if (PREFIJOS.some((p) => k.startsWith(p))) env[k] = "";
  env.PUBLISH_ROOT = path.join(raizRepo, DIR_PUBLICADAS);
  env.OPENLEN_AGENT_RECORD_DIR = path.join(raizRepo, DIR_GRABACIONES);
  // El «ápice» de la publicada. Lo que la página manda a la app —el `action`
  // de los formularios (lib/publish/forms.ts) y la base del widget
  // (lib/publish/base-host.ts)— se hornea al publicar con esta variable, y sin
  // ella es https://openlen.com: el grader del formulario enviaría a
  // PRODUCCIÓN. En producción la página también envía a otro origen (el
  // ápice), así que apuntarlo al Next de Len-Bench es la misma forma.
  env.NEXT_PUBLIC_SITE_URL = BASE_LEN_BENCH;
  // Los almacenes (/api/d/) firman la cookie del visitante con este secreto y
  // sin él contestan 500 `no_configurado`. Producción lo tiene; el .env.local
  // de desarrollo no (E del 26/09: todas las /api/d/ daban 500). Uno de usar y
  // tirar basta: sólo firma cookies de Len-Bench.
  if (!env.OPENLEN_INTERNAL_SECRET?.trim()) env.OPENLEN_INTERNAL_SECRET = randomBytes(32).toString("hex");
  return env;
}

/**
 * Lo que tiene MAL un entorno para correr Len-Bench, en palabras. Vacío = se
 * puede. El conductor lo comprueba antes de publicar: olvidar
 * `apagarEnEsteProceso` subiría releases de prueba a R2 de producción, y un
 * formulario de prueba acabaría en la bandeja de producción.
 */
export function problemasDelEntorno(env: Readonly<Entorno>, raizRepo: string): string[] {
  const p: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (PREFIJOS.some((pre) => k.startsWith(pre)) && v) p.push(`${k} tiene valor: tocaría R2/Cloudflare/Resend de producción`);
  }
  if (env.NEXT_PUBLIC_SITE_URL !== BASE_LEN_BENCH) {
    p.push(`NEXT_PUBLIC_SITE_URL es «${env.NEXT_PUBLIC_SITE_URL ?? "(sin definir → https://openlen.com)"}», no ${BASE_LEN_BENCH}: los formularios irían a producción`);
  }
  if (env.PUBLISH_ROOT !== path.join(raizRepo, DIR_PUBLICADAS)) {
    p.push(`PUBLISH_ROOT es «${env.PUBLISH_ROOT ?? "(sin definir)"}», no ${DIR_PUBLICADAS}`);
  }
  if (env.OPENLEN_AGENT_RECORD_DIR !== path.join(raizRepo, DIR_GRABACIONES)) {
    p.push(`OPENLEN_AGENT_RECORD_DIR es «${env.OPENLEN_AGENT_RECORD_DIR ?? "(sin definir)"}»: el coste saldría 0`);
  }
  return p;
}

/** Lo mismo, aplicado al proceso que llama (el conductor publica en su proceso). */
export function apagarEnEsteProceso(raizRepo: string): void {
  const env = entornoDeLenBench(process.env, raizRepo);
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

/**
 * 🔴 SÓLO LA BASE LOCAL. Contar filas no identifica una base (memoria
 * `database-url-local-es-produccion`); la dirección del servidor sí. Una base
 * por socket devuelve NULL, y también es local.
 */
export async function exigirBaseLocal(): Promise<void> {
  const { db } = await import("@/lib/db");
  const r = (await db.execute(sql`select inet_server_addr()::text as addr, version() as version`)) as unknown as
    | { rows: { addr: string | null; version: string }[] }
    | { addr: string | null; version: string }[];
  const fila = Array.isArray(r) ? r[0] : r.rows[0];
  const addr = fila?.addr ?? null;
  if (addr !== null && !/^(127\.|::1)/.test(addr)) {
    throw new Error(
      `Len-Bench sólo corre contra la base LOCAL, y ésta contesta desde ${addr} (${fila?.version ?? "?"}). ` +
        `Revisa DATABASE_URL antes de seguir.`,
    );
  }
}
