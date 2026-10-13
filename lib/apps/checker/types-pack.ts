// lib/apps/checker/types-pack.ts — qué `@types/*` trae el paquete de tipos de
// un catálogo (`public/app-vendor/<catálogo>/types.json`, plan 03): con ellos
// `npm install -D @types/react` contesta «ya está», como el npm de verdad con
// un paquete instalado. Se lee una vez por catálogo, sin parsear los 7 MB.
import { readFileSync } from "node:fs";
import path from "node:path";
import { directorioVendor } from "@/lib/apps/servir";

const porCatalogo = new Map<string, readonly string[]>();
const pathsByCatalog = new Map<string, ReadonlySet<string>>();

/** Las rutas que trae el paquete de tipos (`/node_modules/@types/react-dom/client.d.ts`…):
 *  lo que una parte instalada de npm no tiene que volver a traer. */
export function catalogTypePathsOf(catalogName: string): ReadonlySet<string> {
  const cached = pathsByCatalog.get(catalogName);
  if (cached) return cached;
  let paths = new Set<string>();
  try {
    paths = new Set(Object.keys(JSON.parse(readFileSync(path.join(directorioVendor(), catalogName, "types.json"), "utf8")) as Record<string, string>));
  } catch {
    // Sin paquete de tipos, ninguna.
  }
  pathsByCatalog.set(catalogName, paths);
  return paths;
}

export function typesPackagesOf(catalogo: string): readonly string[] {
  const hecho = porCatalogo.get(catalogo);
  if (hecho) return hecho;
  let nombres: string[] = [];
  try {
    const texto = readFileSync(path.join(directorioVendor(), catalogo, "types.json"), "utf8");
    nombres = [...new Set([...texto.matchAll(/"\/node_modules\/(@types\/[^/"]+)\//g)].map((m) => m[1]!))].sort();
  } catch {
    // Sin paquete de tipos, ninguno: `npm install` dirá la verdad de los demás.
  }
  porCatalogo.set(catalogo, nombres);
  return nombres;
}
