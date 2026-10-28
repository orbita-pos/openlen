// Desliza para cerrar (Jesús, 01/10): la hoja de Len, «Tus páginas», la
// llamada y el chat (éste, hacia la derecha) siguen al dedo; al soltar, si
// pasó del umbral o fue un tirón, terminan el gesto, y si no, vuelven a su
// sitio. El lienzo está escalado (lienzo.ts): el dedo se mueve en px del
// teléfono y la capa en px del lienzo, por eso se divide entre la escala.
//
// Es un ref de función (React 19 limpia con lo que devuelve): la hoja y la
// llamada entran y salen del DOM, y un efecto con dependencias fijas se
// quedaría enganchado al elemento viejo o a ninguno.
import { useCallback, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { movimientoReducido } from "./movimiento";

export interface Deslizar {
  /** hacia dónde se cierra: «abajo» la quita o la encoge; «arriba» la abre; «derecha» la quita (el chat) */
  hacia: "abajo" | "arriba" | "derecha";
  /** lo que pasa al completar el gesto (cerrar, encoger, abrir) */
  alSoltar: () => void;
  /** px del lienzo que se mueve la capa al completar: por defecto, su alto
   *  (su ancho hacia la derecha). Con «arriba» se mide DESPUÉS de abrir (lo que creció). */
  recorrido?: (el: HTMLElement) => number;
  /** Una zona de agarre deja que el resto de la hoja se desplace normalmente. */
  desde?: string;
  /** Salidas de navegación breves; las hojas conservan su ritmo. */
  rapido?: boolean;
  activo?: boolean;
  /** Cancela un arrastre al navegar a otro paso sin remontar su contenido. */
  clave?: string;
}

const ARRANQUE = 8; // px del teléfono: menos que esto es un toque, no un arrastre
const TIRON = 0.5; // px del lienzo por ms: más rápido que esto, basta con soltar
const CONTRA = 0.25; // hacia el lado que no cierra, la capa apenas se mueve
const SUBE = 0.4; // al abrir sube con resistencia: si siguiera al dedo, dejaría un hueco debajo
const VUELTA = "transform .32s cubic-bezier(.2,.85,.25,1)";
const SALIDA = "transform .22s cubic-bezier(.4,0,1,1)";

const vertical = (hacia: Deslizar["hacia"]) => hacia !== "derecha";

export function useDeslizar(op: Deslizar) {
  const ultimo = useRef(op);
  useLayoutEffect(() => {
    ultimo.current = op;
  });

  return useCallback((el: HTMLElement | null) => {
    if (!el) return;
    // Vertical: Chrome no se queda nada (ni recargar ni desplazar). Hacia la
    // derecha: permite scroll nativo (incluidos carruseles); touchmove sólo
    // lo cancela cuando ya ganó el gesto de navegación.
    el.style.touchAction = vertical(ultimo.current.hacia) && !ultimo.current.desde ? "none" : vertical(ultimo.current.hacia) ? "pan-y" : "auto";
    let inicio: { id: number; x: number; y: number } | null = null;
    let arrastrando = false;
    let finalizando = false;
    let escala = 1;
    let crudo = 0; // px del lienzo hacia donde cierra, sin resistencia
    let tope = 0; // px del lienzo hasta donde termina el gesto (se mide al empezar a arrastrar)
    let muestras: { t: number; d: number }[] = [];
    let vivo = true;
    const tiempos = new Set<ReturnType<typeof setTimeout>>();
    let vuelta: ReturnType<typeof setTimeout> | undefined;
    const limpiezas = new Set<() => void>();
    const luego = (hacer: () => void, demora: number) => {
      const id = setTimeout(() => { tiempos.delete(id); if (vivo) hacer(); }, demora);
      tiempos.add(id);
      return id;
    };
    const cancelarVuelta = () => {
      if (vuelta === undefined) return;
      clearTimeout(vuelta); tiempos.delete(vuelta); vuelta = undefined;
    };

    const recorridoDe = (x: HTMLElement) => {
      const { hacia, recorrido } = ultimo.current;
      return recorrido ? recorrido(x) : vertical(hacia) ? x.offsetHeight : x.offsetWidth;
    };
    const visible = (d: number) => {
      const { hacia } = ultimo.current;
      if (d < 0) return d * CONTRA;
      if (hacia === "arriba") return d * SUBE;
      // Más allá de donde termina el gesto, se resiste: si siguiera al dedo, al
      // soltar tendría que volver hacia atrás (Jesús, 01/10: «sube un poco y
      // después baja»).
      return d > tope ? tope + (d - tope) * CONTRA : d;
    };
    const poner = (d: number) => {
      const { hacia } = ultimo.current;
      el.style.transform = hacia === "derecha" ? `translateX(${d}px)` : `translateY(${hacia === "abajo" ? d : -d}px)`;
    };
    const tragarClic = () => {
      const tragar = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      };
      el.addEventListener("click", tragar, { capture: true, once: true });
      const limpiar = () => el.removeEventListener("click", tragar, { capture: true });
      limpiezas.add(limpiar);
      luego(() => { limpiar(); limpiezas.delete(limpiar); }, 0);
    };
    const volver = () => {
      cancelarVuelta();
      el.style.transition = movimientoReducido() ? "none" : ultimo.current.rapido ? "transform .18s cubic-bezier(.2,.85,.25,1)" : VUELTA;
      el.style.transform = "";
      vuelta = luego(() => {
        vuelta = undefined;
        if (arrastrando) return;
        el.style.transition = "";
        el.style.willChange = "";
      }, ultimo.current.rapido ? 200 : 340);
    };
    // Al terminar: React pinta el nuevo estado YA (flushSync) y la capa queda
    // donde el dedo la dejó, sin salto.
    const completar = (d: number) => {
      const { hacia, alSoltar, rapido } = ultimo.current;
      if (movimientoReducido()) {
        el.style.transition = "none"; el.style.transform = ""; el.style.willChange = "";
        flushSync(alSoltar);
        return;
      }
      if (hacia !== "arriba") {
        finalizando = true;
        el.style.transition = rapido ? "transform .16s cubic-bezier(.4,0,1,1)" : SALIDA;
        poner(tope);
        let hecho = false;
        const fin = (e?: TransitionEvent) => {
          if (hecho || (e && (e.target !== el || e.propertyName !== "transform"))) return;
          hecho = true;
          finalizando = false;
          limpiarFin();
          flushSync(() => ultimo.current.alSoltar());
          el.style.transition = "none";
          el.style.transform = "";
          void el.offsetHeight;
          el.style.transition = "";
          el.style.willChange = "";
        };
        const limpiarFin = () => { el.removeEventListener("transitionend", fin); limpiezas.delete(limpiarFin); };
        limpiezas.add(limpiarFin);
        el.addEventListener("transitionend", fin);
        luego(fin, rapido ? 210 : 280);
      } else {
        flushSync(alSoltar);
        // Ya abierta, la capa creció hacia arriba: se coloca donde estaba y sube.
        el.style.transition = "none";
        el.style.transform = `translateY(${recorridoDe(el) - d}px)`;
        void el.offsetHeight;
        el.style.transition = VUELTA;
        el.style.transform = "";
        luego(() => {
          el.style.transition = "";
          el.style.willChange = "";
        }, 340);
      }
    };

    const baja = (e: PointerEvent) => {
      if (ultimo.current.activo === false || finalizando || inicio || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (ultimo.current.desde && !(e.target as Element | null)?.closest?.(ultimo.current.desde!)) return;
      // Lo que tiene su propio gesto (el micrófono, el campo de texto) no arrastra la capa.
      const objetivo = e.target as Element | null;
      if (objetivo?.closest?.('[data-no-deslizar],input,textarea,select,[contenteditable]:not([contenteditable="false"]),iframe')) return;
      if (!vertical(ultimo.current.hacia)) {
        for (let nodo = objetivo; nodo && nodo !== el; nodo = nodo.parentElement) {
          if (nodo.scrollWidth > nodo.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(nodo).overflowX)) return;
        }
      }
      inicio = { id: e.pointerId, x: e.clientX, y: e.clientY };
      arrastrando = false;
      crudo = 0;
      muestras = [];
    };
    const mueve = (e: PointerEvent) => {
      if (!inicio || e.pointerId !== inicio.id) return;
      const vert = vertical(ultimo.current.hacia);
      const d1 = vert ? e.clientY - inicio.y : e.clientX - inicio.x; // a lo largo del gesto
      const d2 = vert ? e.clientX - inicio.x : e.clientY - inicio.y; // de través
      if (!arrastrando) {
        if (Math.abs(d2) >= ARRANQUE && Math.abs(d2) > Math.abs(d1)) {
          inicio = null; // de través: no es esto
          return;
        }
        if (Math.abs(d1) < ARRANQUE) return;
        cancelarVuelta();
        arrastrando = true;
        escala = el.getBoundingClientRect().width / el.offsetWidth || 1;
        tope = recorridoDe(el);
        // Su propia capa mientras dura el gesto: así el teléfono la mueve sin
        // volver a pintar su sombra en cada cuadro (en un Galaxy A07 se trababa).
        el.style.willChange = "transform";
        try {
          el.setPointerCapture(e.pointerId); // que el dedo no se lo quede la vista previa (un iframe)
        } catch {
          // un puntero que el navegador ya soltó: se sigue sin captura
        }
        el.style.transition = "none";
      }
      crudo = (d1 / escala) * (ultimo.current.hacia === "arriba" ? -1 : 1);
      poner(visible(crudo));
      muestras.push({ t: e.timeStamp, d: crudo });
      while (muestras.length > 2 && e.timeStamp - muestras[0].t > 100) muestras.shift();
    };
    const suelta = (e: PointerEvent) => {
      if (!inicio || e.pointerId !== inicio.id) return;
      inicio = null;
      if (!arrastrando) return;
      arrastrando = false;
      tragarClic();
      const a = muestras[0];
      const b = muestras.at(-1);
      const velocidad = a && b && b.t > a.t ? (b.d - a.d) / (b.t - a.t) : 0;
      const { hacia } = ultimo.current;
      const umbral = hacia !== "arriba" ? Math.min(tope * 0.3, 120) : 40;
      const basta = crudo > umbral || (crudo > 20 && velocidad > TIRON);
      if (e.type === "pointerup" && basta) completar(visible(crudo));
      else volver();
    };

    // touch-action:auto permite carruseles dentro de la pantalla. Sólo se
    // cancela el desplazamiento nativo cuando ya ganó el gesto horizontal.
    const tactil = (e: TouchEvent) => {
      if (arrastrando && !vertical(ultimo.current.hacia) && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", tactil, { passive: false });
    el.addEventListener("pointerdown", baja);
    el.addEventListener("pointermove", mueve);
    el.addEventListener("pointerup", suelta);
    el.addEventListener("pointercancel", suelta);
    return () => {
      vivo = false;
      el.style.transform = ""; el.style.transition = ""; el.style.willChange = ""; el.style.touchAction = "";
      tiempos.forEach(clearTimeout); limpiezas.forEach(limpiar => limpiar());
      el.removeEventListener("touchmove", tactil);
      el.removeEventListener("pointerdown", baja);
      el.removeEventListener("pointermove", mueve);
      el.removeEventListener("pointerup", suelta);
      el.removeEventListener("pointercancel", suelta);
    };
  // Cambiar de paso/actividad reinstala el ref y cancela sus gestos pendientes.
  // Los handlers leen ultimo para no reinstalarlo al cambiar sólo el callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.clave, op.activo]);
}
