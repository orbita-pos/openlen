/**
 * SUBIR ARCHIVOS DE TU ORDENADOR soltándolos en el árbol de la lente «Código»
 * (como en VS Code). Lo que no es pintar: qué se sube, adónde, qué se salta y
 * por qué. Como a un disco (spec local 2026-10-28-ficheros-al-nivel-de-claude-code): cualquier
 * archivo —código, fotos, fuentes, PDF, un zip—, hasta 50 MB cada uno. Puro: lo prueba vitest y lo
 * importa el cliente.
 */
import { MAX_FILE_BYTES } from "@/lib/files/limits";
import { nombreValido, rutaDentro } from "./explorador";

/** Como mucho, de una vez: soltar un `node_modules` por error no puede tardar una hora. */
export const MAX_SUBIDA = 100;

/** Un archivo soltado: su ruta DENTRO de lo soltado (`css/base.css` si venía en una carpeta) y su tamaño. */
export interface Soltado {
  readonly relativa: string;
  readonly tamano: number;
}

export type MotivoDeSalto = "grande" | "nombre" | "demasiados";

export interface PlanDeSubida {
  /** Lo que se sube, con su ruta en el proyecto y si ya existía (se reemplaza). */
  readonly subir: readonly { readonly origen: Soltado; readonly ruta: string; readonly reemplaza: boolean }[];
  readonly saltados: readonly { readonly nombre: string; readonly motivo: MotivoDeSalto }[];
}

/** Qué pasa con lo soltado en `carpeta` (`""` es la raíz), sabiendo qué existe ya. */
export function planDeSubida(soltados: readonly Soltado[], carpeta: string, existentes: ReadonlySet<string>): PlanDeSubida {
  const subir: PlanDeSubida["subir"][number][] = [];
  const saltados: PlanDeSubida["saltados"][number][] = [];
  for (const s of soltados) {
    const nombre = s.relativa.replace(/^\/+/, "");
    if (s.tamano > MAX_FILE_BYTES) saltados.push({ nombre, motivo: "grande" });
    else if (!nombreValido(nombre)) saltados.push({ nombre, motivo: "nombre" });
    else if (subir.length >= MAX_SUBIDA) saltados.push({ nombre, motivo: "demasiados" });
    else {
      const ruta = rutaDentro(carpeta, nombre);
      subir.push({ origen: s, ruta, reemplaza: existentes.has(ruta) });
    }
  }
  return { subir, saltados };
}
