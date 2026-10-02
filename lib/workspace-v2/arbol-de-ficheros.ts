/**
 * EL ÁRBOL DEL EXPLORADOR de la lente «Código»: las rutas del proyecto, por
 * carpetas, como el explorador de VS Code. Son las mismas que ve Len en su
 * terminal (`/api/projects/[id]/ficheros`). Puro: lo prueba vitest.
 */
import type { FicheroCambiado } from "@/lib/agent/cambios-del-turno";
import { esDeSoloLectura } from "@/lib/agent/terminal/ficheros";

export interface NodoDelArbol {
  readonly nombre: string;
  /** La ruta absoluta: la del fichero, o la de la carpeta. */
  readonly ruta: string;
  readonly tipo: "carpeta" | "fichero";
  readonly hijos: readonly NodoDelArbol[];
  /** Se calcula al abrirlo (`/resultados`, `/bandeja`…): no viene con la lista. */
  readonly perezoso: boolean;
  /** Ni Len ni nadie lo escribe. */
  readonly soloLectura: boolean;
}

interface Carpeta {
  readonly carpetas: Map<string, Carpeta>;
  readonly ficheros: Map<string, boolean>;
}

/** Carpetas primero y, dentro de cada grupo, por nombre: lo de VS Code. */
const porNombre = (a: NodoDelArbol, b: NodoDelArbol) =>
  a.tipo !== b.tipo ? (a.tipo === "carpeta" ? -1 : 1) : a.nombre.localeCompare(b.nombre, "es");

export function arbolDeFicheros(ficheros: readonly { readonly ruta: string; readonly perezoso?: boolean }[]): NodoDelArbol[] {
  const raiz: Carpeta = { carpetas: new Map(), ficheros: new Map() };
  for (const { ruta, perezoso } of ficheros) {
    const partes = ruta.split("/").filter(Boolean);
    const nombre = partes.pop();
    if (!nombre) continue;
    let aqui = raiz;
    for (const p of partes) {
      let dentro = aqui.carpetas.get(p);
      if (!dentro) aqui.carpetas.set(p, (dentro = { carpetas: new Map(), ficheros: new Map() }));
      aqui = dentro;
    }
    aqui.ficheros.set(nombre, perezoso === true);
  }
  const nodos = (c: Carpeta, base: string): NodoDelArbol[] =>
    [
      ...[...c.carpetas].map(([nombre, dentro]): NodoDelArbol => {
        const ruta = `${base}/${nombre}`;
        return { nombre, ruta, tipo: "carpeta", hijos: nodos(dentro, ruta), perezoso: false, soloLectura: esDeSoloLectura(ruta) };
      }),
      ...[...c.ficheros].map(([nombre, perezoso]): NodoDelArbol => {
        const ruta = `${base}/${nombre}`;
        return { nombre, ruta, tipo: "fichero", hijos: [], perezoso, soloLectura: esDeSoloLectura(ruta) };
      }),
    ].sort(porNombre);
  return nodos(raiz, "");
}

/** Las carpetas que se ven abiertas al entrar: todas menos las de sólo lectura,
 *  que cuestan consultas y no son lo primero que se busca. Y siempre las que
 *  llevan al fichero elegido. */
export function abiertasAlEntrar(arbol: readonly NodoDelArbol[], elegido: string | null): Set<string> {
  const abiertas = new Set<string>();
  const recorrer = (ns: readonly NodoDelArbol[]) => {
    for (const n of ns) {
      if (n.tipo !== "carpeta") continue;
      if (!n.soloLectura || (elegido !== null && elegido.startsWith(`${n.ruta}/`))) abiertas.add(n.ruta);
      recorrer(n.hijos);
    }
  };
  recorrer(arbol);
  return abiertas;
}

export type MarcaDeCambio = "nuevo" | "cambiado";

/**
 * LA MARCA DE «CAMBIADO» EN EL ÁRBOL (la #19 de plans/len-agente-2026/notas/
 * fase-5-taller.md): qué ficheros cambió algún turno de esta pestaña, sacado de
 * la misma foto que pinta la lente «Cambios» (`cambiosEnVivo`), del turno más
 * viejo al más nuevo. Cuenta la SESIÓN, no el último turno: uno creado en un
 * turno y retocado en otro sigue siendo nuevo; uno creado y luego borrado no se
 * marca (tampoco está en el árbol).
 */
export function marcasDeCambios(
  turnos: readonly { readonly ficheros: readonly FicheroCambiado[] }[],
): ReadonlyMap<string, MarcaDeCambio> {
  const marcas = new Map<string, MarcaDeCambio>();
  for (const turno of turnos) {
    for (const f of turno.ficheros) {
      const nuevo = f.tipo === "texto" ? f.antes === null : f.nuevo;
      const borrado = f.tipo === "texto" ? f.despues === null : f.borrado;
      if (borrado) marcas.delete(f.ruta);
      else if (nuevo) marcas.set(f.ruta, "nuevo");
      else if (!marcas.has(f.ruta)) marcas.set(f.ruta, "cambiado");
    }
  }
  return marcas;
}

/** Las carpetas con algún fichero marcado dentro, a cualquier profundidad. */
export function carpetasConMarca(marcas: ReadonlyMap<string, MarcaDeCambio>): ReadonlySet<string> {
  const carpetas = new Set<string>();
  for (const ruta of marcas.keys()) {
    for (let i = ruta.indexOf("/", 1); i > 0; i = ruta.indexOf("/", i + 1)) carpetas.add(ruta.slice(0, i));
  }
  return carpetas;
}
