/**
 * LOS GRUPOS DE EDITORES de la lente «Código», como en VS Code: uno, o dos lado
 * a lado («Dividir», Ctrl+\). Cada grupo tiene sus pestañas y la suya activa; un
 * mismo archivo puede estar abierto en los dos (y lo escrito en uno se ve en el
 * otro: el texto es del archivo, no del grupo). Puro: lo prueba vitest.
 */
import { estaDentro, moverRuta } from "./explorador";

export interface Grupo {
  readonly pestanas: readonly string[];
  readonly activa: string | null;
}

export interface Editores {
  /** Uno o dos. */
  readonly grupos: readonly Grupo[];
  /** El grupo donde se abre lo que se pulsa en el árbol. */
  readonly activo: number;
}

export const MAX_GRUPOS = 2;

export function unGrupo(pestanas: readonly string[], activa: string | null): Editores {
  return { grupos: [{ pestanas, activa }], activo: 0 };
}

const conGrupo = (e: Editores, g: number, grupo: Grupo): Grupo[] => e.grupos.map((x, i) => (i === g ? grupo : x));

/** Quita los grupos vacíos (siempre queda uno) y deja `activo` en uno que existe. */
function sinVacios(grupos: readonly Grupo[], activo: number): Editores {
  const quedan = grupos.filter((g) => g.pestanas.length > 0);
  if (quedan.length === 0) return { grupos: [{ pestanas: [], activa: null }], activo: 0 };
  const elActivo = grupos[activo];
  const i = elActivo ? quedan.indexOf(elActivo) : -1;
  return { grupos: quedan, activo: i >= 0 ? i : Math.min(activo, quedan.length - 1) };
}

/** Abre `ruta` en el grupo `g` (o va a su pestaña), y ese grupo pasa a ser el activo. */
export function abrirEn(e: Editores, g: number, ruta: string): Editores {
  const grupo = e.grupos[g] ?? e.grupos[0]!;
  const i = e.grupos[g] ? g : 0;
  const pestanas = grupo.pestanas.includes(ruta) ? grupo.pestanas : [...grupo.pestanas, ruta];
  return { grupos: conGrupo(e, i, { pestanas, activa: ruta }), activo: i };
}

/** Cierra la pestaña `ruta` del grupo `g`. Un grupo que se queda sin pestañas se va (si hay otro). */
export function cerrarEn(e: Editores, g: number, ruta: string): Editores {
  const grupo = e.grupos[g];
  if (!grupo) return e;
  const i = grupo.pestanas.indexOf(ruta);
  if (i < 0) return e;
  const pestanas = grupo.pestanas.filter((r) => r !== ruta);
  const activa = grupo.activa === ruta ? (pestanas[Math.min(i, pestanas.length - 1)] ?? null) : grupo.activa;
  return sinVacios(conGrupo(e, g, { pestanas, activa }), e.activo);
}

/** «Dividir a la derecha»: el archivo activo del grupo `g`, también en un grupo nuevo a su lado. */
export function dividir(e: Editores, g: number): Editores {
  const grupo = e.grupos[g];
  if (!grupo?.activa) return e;
  if (e.grupos.length >= MAX_GRUPOS) return abrirEn(e, g === 0 ? 1 : 0, grupo.activa);
  return { grupos: [...e.grupos, { pestanas: [grupo.activa], activa: grupo.activa }], activo: e.grupos.length };
}

/** Lleva la pestaña `ruta` del grupo `de` al grupo `a` (si `a` no existe, se crea a la derecha). */
export function moverPestana(e: Editores, de: number, a: number, ruta: string): Editores {
  if (de === a) return { ...e, activo: a };
  const destino = a >= e.grupos.length && e.grupos.length < MAX_GRUPOS ? { ...e, grupos: [...e.grupos, { pestanas: [], activa: null }] } : e;
  const conLaPestana = abrirEn(destino, Math.min(a, destino.grupos.length - 1), ruta);
  const sinElla = cerrarEn({ ...conLaPestana, activo: conLaPestana.activo }, de, ruta);
  // `cerrarEn` pudo quitar el grupo de origen; el destino sigue siendo el activo.
  const i = sinElla.grupos.findIndex((x) => x.activa === ruta && x.pestanas.includes(ruta));
  return { ...sinElla, activo: i >= 0 ? i : sinElla.activo };
}

/** Lo abierto sigue a un archivo o una carpeta que se renombra. */
export function renombrarEn(e: Editores, de: string, a: string): Editores {
  return {
    ...e,
    grupos: e.grupos.map((x) => ({
      pestanas: x.pestanas.map((r) => moverRuta(r, de, a)),
      activa: x.activa ? moverRuta(x.activa, de, a) : null,
    })),
  };
}

/** Lo que estaba dentro de `ruta` (borrada) se cierra en todos los grupos. */
export function quitarDentro(e: Editores, ruta: string): Editores {
  const grupos = e.grupos.map((x) => {
    const pestanas = x.pestanas.filter((r) => !estaDentro(r, ruta));
    return { pestanas, activa: x.activa && estaDentro(x.activa, ruta) ? (pestanas.at(-1) ?? null) : x.activa };
  });
  return sinVacios(grupos, e.activo);
}

/** ¿Está `ruta` abierta en algún grupo? */
export function abiertaEnAlguno(e: Editores, ruta: string): boolean {
  return e.grupos.some((g) => g.pestanas.includes(ruta));
}
