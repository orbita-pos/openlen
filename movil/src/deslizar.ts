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

export interface Deslizar {
  /** hacia dónde se cierra: «abajo» la quita o la encoge; «arriba» la abre; «derecha» la quita (el chat) */
  hacia: "abajo" | "arriba" | "derecha";
  /** lo que pasa al completar el gesto (cerrar, encoger, abrir) */
  alSoltar: () => void;
  /** px del lienzo que se mueve la capa al completar: por defecto, su alto
   *  (su ancho hacia la derecha). Con «arriba» se mide DESPUÉS de abrir (lo que creció). */
  recorrido?: (el: HTMLElement) => number;
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
    // derecha: el hilo del chat sí se desplaza en vertical, así que sólo se
    // le quita lo horizontal.
    el.style.touchAction = vertical(ultimo.current.hacia) ? "none" : "pan-y";
    let inicio: { id: number; x: number; y: number } | null = null;
    let arrastrando = false;
    let escala = 1;
    let crudo = 0; // px del lienzo hacia donde cierra, sin resistencia
    let muestras: { t: number; d: number }[] = [];

    const visible = (d: number) => {
      const { hacia } = ultimo.current;
      if (d < 0) return d * CONTRA;
      return hacia === "arriba" ? d * SUBE : d;
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
      setTimeout(() => el.removeEventListener("click", tragar, { capture: true }), 0);
    };
    const volver = () => {
      el.style.transition = VUELTA;
      el.style.transform = "";
      setTimeout(() => {
        if (!arrastrando) el.style.transition = "";
      }, 340);
    };
    // Al terminar: React pinta el nuevo estado YA (flushSync) y la capa queda
    // donde el dedo la dejó, sin salto.
    const completar = (d: number) => {
      const { hacia, alSoltar, recorrido = (x) => (vertical(hacia) ? x.offsetHeight : x.offsetWidth) } = ultimo.current;
      if (hacia !== "arriba") {
        el.style.transition = SALIDA;
        poner(recorrido(el));
        let hecho = false;
        const fin = (e?: TransitionEvent) => {
          if (hecho || (e && (e.target !== el || e.propertyName !== "transform"))) return;
          hecho = true;
          el.removeEventListener("transitionend", fin);
          flushSync(() => ultimo.current.alSoltar());
          el.style.transition = "none";
          el.style.transform = "";
          void el.offsetHeight;
          el.style.transition = "";
        };
        el.addEventListener("transitionend", fin);
        setTimeout(fin, 280);
      } else {
        flushSync(alSoltar);
        // Ya abierta, la capa creció hacia arriba: se coloca donde estaba y sube.
        el.style.transition = "none";
        el.style.transform = `translateY(${recorrido(el) - d}px)`;
        void el.offsetHeight;
        el.style.transition = VUELTA;
        el.style.transform = "";
        setTimeout(() => {
          el.style.transition = "";
        }, 340);
      }
    };

    const baja = (e: PointerEvent) => {
      if (inicio || (e.pointerType === "mouse" && e.button !== 0)) return;
      // Lo que tiene su propio gesto (el micrófono, el campo de texto) no arrastra la capa.
      if ((e.target as Element | null)?.closest?.("[data-no-deslizar]")) return;
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
        arrastrando = true;
        escala = el.getBoundingClientRect().width / el.offsetWidth || 1;
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
      const { hacia, recorrido = (x) => (vertical(hacia) ? x.offsetHeight : x.offsetWidth) } = ultimo.current;
      const umbral = hacia !== "arriba" ? Math.min(recorrido(el) * 0.3, 120) : 40;
      const basta = crudo > umbral || (crudo > 20 && velocidad > TIRON);
      if (e.type === "pointerup" && basta) completar(visible(crudo));
      else volver();
    };

    el.addEventListener("pointerdown", baja);
    el.addEventListener("pointermove", mueve);
    el.addEventListener("pointerup", suelta);
    el.addEventListener("pointercancel", suelta);
    return () => {
      el.removeEventListener("pointerdown", baja);
      el.removeEventListener("pointermove", mueve);
      el.removeEventListener("pointerup", suelta);
      el.removeEventListener("pointercancel", suelta);
    };
  }, []);
}
