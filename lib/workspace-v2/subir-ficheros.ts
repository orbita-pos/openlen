/**
 * SUBIR ARCHIVOS DE TU ORDENADOR soltándolos en el árbol de la lente «Código»
 * (como en VS Code). Lo que no es pintar: qué se sube, adónde, qué se salta y
 * por qué. La carpeta del proyecto guarda TEXTO —código, CSS, JSON, SVG,
 * Markdown— y páginas (`/<slug>/index.html`); una foto no se escribe, se sube a
 * Imágenes. Puro: lo prueba vitest y lo importa el cliente.
 */
import { MAX_FOLDER_FILE_BYTES, WEB_EXTENSIONS } from "@/lib/agent/ficheros/folder";
import { nombreValido, rutaDentro } from "./explorador";

/** Como mucho, de una vez: soltar un `node_modules` por error no puede tardar una hora. */
export const MAX_SUBIDA = 100;

/** Las extensiones que se suben: las de la carpeta del proyecto, y `.html` (una página). */
const PERMITIDAS: readonly string[] = [...WEB_EXTENSIONS, ".html"];

export function extensionPermitida(nombre: string): boolean {
  const punto = nombre.lastIndexOf(".");
  return punto > 0 && PERMITIDAS.includes(nombre.slice(punto).toLowerCase());
}

/** Un archivo soltado: su ruta DENTRO de lo soltado (`css/base.css` si venía en una carpeta) y su tamaño. */
export interface Soltado {
  readonly relativa: string;
  readonly tamano: number;
}

export type MotivoDeSalto = "tipo" | "grande" | "nombre" | "demasiados";

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
    if (!extensionPermitida(nombre)) saltados.push({ nombre, motivo: "tipo" });
    else if (s.tamano > MAX_FOLDER_FILE_BYTES) saltados.push({ nombre, motivo: "grande" });
    else if (!nombreValido(nombre)) saltados.push({ nombre, motivo: "nombre" });
    else if (subir.length >= MAX_SUBIDA) saltados.push({ nombre, motivo: "demasiados" });
    else {
      const ruta = rutaDentro(carpeta, nombre);
      subir.push({ origen: s, ruta, reemplaza: existentes.has(ruta) });
    }
  }
  return { subir, saltados };
}
