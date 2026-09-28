// lib/len-bench/casos/cargar.ts — de dónde sale cada juego.
//
// `dev` va en el repo. `pendientes` y `sellado` viven en plans/len-2/ (ignorado
// por git) y se importan por RUTA en ejecución: ningún fichero commiteado los
// importa de forma estática, así que un `git add .` no puede arrastrarlos.

import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Encargo } from "../tipos";

export type Juego = "dev" | "pendientes" | "sellado";

export async function cargarEncargos(juego: Juego, raiz = process.cwd()): Promise<Encargo[]> {
  if (juego === "dev") return (await import("./dev")).ENCARGOS;
  const ruta = path.resolve(raiz, "plans", "len-2", juego, "index.ts");
  try {
    return ((await import(pathToFileURL(ruta).href)) as { ENCARGOS: Encargo[] }).ENCARGOS;
  } catch (e) {
    throw new Error(`no se pudo cargar el juego «${juego}» de ${ruta}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
