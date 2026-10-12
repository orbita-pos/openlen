// lib/functions/engines/cloudflare/miniflare-for-tests.ts — EL MOTOR DE
// CLOUDFLARE (workerd) EN LOCAL, PARA LAS PRUEBAS (spec local 2026-10-12, Parte
// 8). miniflare vive APARTE, en scripts/functions-workerd con su lockfile: el
// node_modules de la raíz es compartido entre ramas y un `npm install` ahí poda
// lo ajeno.

import { createRequire } from "node:module";
import path from "node:path";

import { COMPATIBILITY_DATE, COMPATIBILITY_FLAGS, WORKER_MAIN_MODULE } from "../cloudflare-api";

export interface MiniflareLike {
  dispatchFetch(input: string, init?: RequestInit): Promise<Response>;
  setOptions(o: unknown): Promise<void>;
  dispose(): Promise<void>;
}

export function loadMiniflare(): new (o: unknown) => MiniflareLike {
  const require = createRequire(path.join(process.cwd(), "scripts", "functions-workerd", "package.json"));
  try {
    return (require("miniflare") as { Miniflare: new (o: unknown) => MiniflareLike }).Miniflare;
  } catch {
    throw new Error("Falta miniflare para las pruebas de Cloudflare: npm --prefix scripts/functions-workerd ci");
  }
}

/** El script de un proyecto en miniflare: sus módulos (la entrada, primero) y sus
 *  variables, con la compatibilidad de producción. */
export function scriptOptions(files: Readonly<Record<string, string>>, vars: Readonly<Record<string, string>>): Record<string, unknown> {
  const orden = Object.keys(files).sort((a, b) => (a === WORKER_MAIN_MODULE ? -1 : b === WORKER_MAIN_MODULE ? 1 : a.localeCompare(b)));
  return {
    modules: orden.map((p) => ({ type: "ESModule", path: p, contents: files[p]! })),
    modulesRoot: "/",
    compatibilityDate: COMPATIBILITY_DATE,
    compatibilityFlags: [...COMPATIBILITY_FLAGS],
    bindings: { ...vars },
  };
}
