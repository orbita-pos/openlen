"use client";

// components/workspace-v2/use-mando-desplegable.ts — CERRAR Y NAVEGAR, una vez
// para los dos mandos del taller (el de modelo en Crear y el de esfuerzo de Len).
//
// UN GANCHO Y NO DOS COPIAS: los dos son la misma cosa —un disparador y una
// lista de `menuitemradio` encima— y cuando esto vivía en ninguno de los dos,
// los dos tenían el MISMO hueco: no se cerraban ni con Esc ni haciendo clic
// fuera. Copiarlo habría sido la misma capacidad quedándose a medias en dos
// sitios.
//
// LO QUE DICE CLAUDE CODE. Su contexto `Select` declara, literal:
//
//
// De ahí se porta lo que significa lo mismo en un navegador: **Esc cancela**,
// **↑/↓ recorren** y **Inicio/Fin van a los extremos**. `enter` ya lo da el
// navegador sobre un `<button>`. Y su selector pasó a llevar
// `…` en la raíz, o sea que al abrirse **mete el foco
// dentro**: eso también se porta.
//
// LO QUE NO SE PORTA, y por qué:
//   · `j`/`k` y `ctrl+n`/`ctrl+p` son idioma de terminal. En una web, `j`
//     escrita sobre un menú no significa «baja».
//   · `pageup`/`pagedown` son para listas largas. Estos mandos tienen tres y
//     seis opciones.
//
// 🔴 EL CLIC FUERA NO SALE DCLAUDE CODE — no tiene ratón, así que no puede
// contestarlo. Es la convención del navegador, y es el equivalente exacto de su
// `escape: "select:cancel"`: salir sin elegir. Pedido por Jesús el 2026-09-13.

import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

/** Las opciones navegables del menú. Se leen del DOM y no de una lista en JS a
 *  propósito: lo que hay que recorrer es lo que está PINTADO —una fila
 *  deshabilitada no se recorre— y el DOM es la única fuente que no puede
 *  discrepar de lo que ve la persona. */
function opcionesDe(contenedor: HTMLElement | null): HTMLElement[] {
  if (!contenedor) return [];
  return Array.from(
    contenedor.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'),
  );
}

export interface MandoDesplegable {
  /** Envuelve disparador + menú. Sin él no se puede saber qué es «fuera». */
  readonly refContenedor: RefObject<HTMLDivElement | null>;
  /** El disparador, para devolverle el foco al cerrar. */
  readonly refDisparador: RefObject<HTMLButtonElement | null>;
  /** Va en el contenedor, no en cada botón. */
  readonly alPulsarTecla: (e: KeyboardEvent<HTMLElement>) => void;
}

export function useMandoDesplegable({
  abierto,
  cerrar,
}: {
  abierto: boolean;
  /** Cierra el menú. No hace falta que sea estable: se guarda en una ref para
   *  que el oyente del documento no se resuscriba en cada render. */
  cerrar: () => void;
}): MandoDesplegable {
  const refContenedor = useRef<HTMLDivElement>(null);
  const refDisparador = useRef<HTMLButtonElement>(null);
  const refCerrar = useRef(cerrar);
  refCerrar.current = cerrar;

  /** Cierra y DEVUELVE EL FOCO al disparador. Sin lo segundo, quien navega con
   *  teclado cierra el menú y se queda sin sitio: el foco se pierde en el
   *  `<body>` y el siguiente Tab empieza desde el principio de la página. */
  const cerrarYDevolverFoco = useCallback(() => {
    refCerrar.current();
    refDisparador.current?.focus();
  }, []);

  // CLIC FUERA. `pointerdown` en fase de captura, no `click`: así cierra antes
  // de que el destino reaccione, que es lo que hace que pulsar otro botón de la
  // barra no tenga que pulsarse dos veces.
  //
  // NO devuelve el foco al disparador: quien hace clic fuera está yendo a otro
  // sitio, y robarle el foco de vuelta le quitaría aquello que acaba de pulsar.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      const c = refContenedor.current;
      if (c && e.target instanceof Node && !c.contains(e.target)) refCerrar.current();
    };
    document.addEventListener("pointerdown", fuera, true);
    return () => document.removeEventListener("pointerdown", fuera, true);
  }, [abierto]);

  // AL ABRIR, EL FOCO ENTRA — en la opción marcada si la hay, si no en la
  // primera. Es el `…` que su selector estrenó, y sin esto
  // las flechas no tendrían desde dónde empezar.
  useEffect(() => {
    if (!abierto) return;
    const items = opcionesDe(refContenedor.current);
    const marcada = items.find((b) => b.getAttribute("aria-checked") === "true");
    (marcada ?? items[0])?.focus();
  }, [abierto]);

  const alPulsarTecla = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (!abierto) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cerrarYDevolverFoco();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") {
        return;
      }
      const items = opcionesDe(refContenedor.current);
      if (items.length === 0) return;
      e.preventDefault();
      const actual = items.indexOf(document.activeElement as HTMLElement);
      // Da la vuelta, igual que su `_7e` con los niveles: desde la última, ↓
      // lleva a la primera. Un menú corto en el que la flecha deja de responder
      // se lee como que se ha colgado.
      const destino =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : actual === -1
              ? 0
              : (actual + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[destino]?.focus();
    },
    [abierto, cerrarYDevolverFoco],
  );

  return { refContenedor, refDisparador, alPulsarTecla };
}
