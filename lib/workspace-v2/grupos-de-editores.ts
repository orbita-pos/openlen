/**
 * LOS GRUPOS DE EDITORES de la lente «Código», como en VS Code: uno, o varios
 * lado a lado («Dividir», Ctrl+\, o soltar una pestaña en el borde). Cada grupo
 * tiene sus pestañas, en el orden que les dé el dueño, y la suya activa; un
 * mismo archivo puede estar abierto en varios (y lo escrito en uno se ve en los
 * otros: el texto es del archivo, no del grupo). Puro: lo prueba vitest.
 */
import { estaDentro, moverRuta } from "./explorador";

export interface Grupo {
  readonly pestanas: readonly string[];
  readonly activa: string | null;
}

export interface Editores {
  /** De uno a `MAX_GRUPOS`. */
  readonly grupos: readonly Grupo[];
  /** El grupo donde se abre lo que se pulsa en el árbol. */
  readonly activo: number;
}

/** Más de cuatro en una lente que comparte la pantalla con el chat no se lee. */
export const MAX_GRUPOS = 4;

/** `ruta` en `pestanas`, delante de `antesDe` (al final si no se dice o no está). */
function colocar(pestanas: readonly string[], ruta: string, antesDe: string | null = null): string[] {
  // Soltada sobre sí misma: se queda donde estaba.
  if (antesDe === ruta && pestanas.includes(ruta)) return [...pestanas];
  const sin = pestanas.filter((r) => r !== ruta);
  const i = antesDe === null ? -1 : sin.indexOf(antesDe);
  return i < 0 ? [...sin, ruta] : [...sin.slice(0, i), ruta, ...sin.slice(i)];
}

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

/** ¿Cabe otro grupo? */
export const cabeOtro = (e: Editores) => e.grupos.length < MAX_GRUPOS;

/** «Dividir a la derecha»: el archivo activo del grupo `g`, también en un grupo
 *  nuevo JUSTO a su derecha. Sin sitio para otro, va al grupo de al lado. */
export function dividir(e: Editores, g: number): Editores {
  const grupo = e.grupos[g];
  if (!grupo?.activa) return e;
  if (!cabeOtro(e)) return abrirEn(e, g + 1 < e.grupos.length ? g + 1 : g - 1, grupo.activa);
  const grupos = [...e.grupos.slice(0, g + 1), { pestanas: [grupo.activa], activa: grupo.activa }, ...e.grupos.slice(g + 1)];
  return { grupos, activo: g + 1 };
}

/** Abre `ruta` en un grupo NUEVO a la derecha de todo (soltar en el borde). Sin sitio, en el último. */
export function abrirEnNuevo(e: Editores, ruta: string): Editores {
  if (!cabeOtro(e)) return abrirEn(e, e.grupos.length - 1, ruta);
  return { grupos: [...e.grupos, { pestanas: [ruta], activa: ruta }], activo: e.grupos.length };
}

/**
 * Lleva la pestaña `ruta` del grupo `de` al grupo `a`, delante de `antesDe` (al
 * final si es `null`). Dentro del mismo grupo, la REORDENA. Un `a` que no
 * existe es un grupo nuevo a la derecha de todo.
 */
export function moverPestana(e: Editores, de: number, a: number, ruta: string, antesDe: string | null = null): Editores {
  if (de === a) {
    const grupo = e.grupos[a];
    if (!grupo) return e;
    return { grupos: conGrupo(e, a, { pestanas: colocar(grupo.pestanas, ruta, antesDe), activa: ruta }), activo: a };
  }
  const nuevo = a >= e.grupos.length;
  if (nuevo && !cabeOtro(e)) return e;
  const base: Editores = nuevo ? { ...e, grupos: [...e.grupos, { pestanas: [], activa: null }] } : e;
  const destino = nuevo ? base.grupos.length - 1 : a;
  const grupo = base.grupos[destino]!;
  const conLaPestana: Editores = {
    grupos: conGrupo(base, destino, { pestanas: colocar(grupo.pestanas, ruta, antesDe), activa: ruta }),
    activo: destino,
  };
  const sinElla = cerrarEn(conLaPestana, de, ruta);
  // `cerrarEn` pudo quitar el grupo de origen; el de destino sigue siendo el activo.
  const i = sinElla.grupos.findIndex((x, j) => x.activa === ruta && (j === destino || j === destino - 1) && x.pestanas.includes(ruta));
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
