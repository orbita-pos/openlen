// lib/len-bench/casos/cargar.ts — de dónde sale cada juego.
//
// `dev` y `resultados` van en el repo. `pendientes` y `sellado` viven en plans/len-2/ (ignorado
// por git) y se importan por RUTA en ejecución: ningún fichero commiteado los
// importa de forma estática, así que un `git add .` no puede arrastrarlos.

import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Encargo } from "../tipos";

export type Juego = "dev" | "pendientes" | "sellado" | "resultados" | "agente" | "hard";

export async function cargarEncargos(juego: Juego, raiz = process.cwd()): Promise<Encargo[]> {
  if (juego === "dev") return (await import("./dev")).ENCARGOS;
  // Len sabe de tus resultados (plans/len-resultados/): en el repo, como dev,
  // pero APARTE para que dev siga siendo comparable con M1.
  if (juego === "resultados") return (await import("./resultados")).ENCARGOS;
  // La terminal y la búsqueda (plans/len-agente-2026/): aparte por lo mismo.
  if (juego === "agente") return (await import("./agente")).ENCARGOS;
  // Len Dynamis contra Len 2.5, como DeepSeek (plans/len-2/corridas/2026-10-03-dynamis).
  if (juego === "hard") return (await import("./hard")).ENCARGOS;
  const ruta = path.resolve(raiz, "plans", "len-2", juego, "index.ts");
  try {
    return ((await import(pathToFileURL(ruta).href)) as { ENCARGOS: Encargo[] }).ENCARGOS;
  } catch (e) {
    throw new Error(`no se pudo cargar el juego «${juego}» de ${ruta}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
