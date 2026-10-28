import { useCallback, useLayoutEffect, useRef } from "react";

type Opciones = { encogida: boolean; alCambiar: (encogida: boolean) => void };

// La hoja conserva su tamaño: sólo cambia su posición. El cuerpo nunca sale
// del layout y su opacidad sigue al dedo, también al invertir el gesto.
export function useHojaDeslizable(op: Opciones) {
  const ultimo = useRef(op);
  const sincronizar = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { ultimo.current = op; });
  useLayoutEffect(() => { sincronizar.current?.(); }, [op.encogida]);

  return useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const cuerpo = el.querySelector<HTMLElement>(".lm-body");
    if (!cuerpo) return;
    let recorrido = 0;
    let posicion = 0;
    let inicio: { x: number; y: number; posicion: number; escala: number; scroll: HTMLElement | null } | null = null;
    let arrastrando = false;
    let puntero: number | null = null;
    let muestras: { y: number; t: number }[] = [];
    let limpiarClic: (() => void) | undefined;

    const poner = (y: number) => {
      posicion = Math.max(0, Math.min(recorrido, y));
      el.style.setProperty("--hoja-y", `${posicion}px`);
      cuerpo.style.opacity = String(recorrido ? 1 - posicion / recorrido : 1);
    };
    const animar = (encogida: boolean) => {
      delete el.dataset.arrastrando;
      // Aplica la transición antes de fijar el destino tras seguir al dedo.
      void el.offsetHeight;
      poner(encogida ? recorrido : 0);
    };
    const medir = () => {
      const fraccion = recorrido ? posicion / recorrido : Number(ultimo.current.encogida);
      recorrido = cuerpo.offsetHeight;
      poner(arrastrando ? fraccion * recorrido : ultimo.current.encogida ? recorrido : 0);
    };
    const scrollDe = (target: Element) => {
      for (let p: HTMLElement | null = target as HTMLElement; p && p !== el; p = p.parentElement) {
        if (p.scrollHeight > p.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
      }
      return null;
    };
    const empezar = (x: number, y: number, target: EventTarget | null) => {
      if (inicio || !(target instanceof Element) || target.closest('[data-no-deslizar],input,textarea,select,[contenteditable="true"]')) return;
      const transform = getComputedStyle(el).transform;
      const actual = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
      inicio = { x, y, posicion: actual, escala: el.getBoundingClientRect().width / el.offsetWidth || 1, scroll: scrollDe(target) };
      arrastrando = false;
      muestras = [];
    };
    const mover = (x: number, y: number, t: number, evento: Event) => {
      if (!inicio) return;
      const dx = x - inicio.x, dy = y - inicio.y;
      if (!arrastrando) {
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= 8) { inicio = null; return; }
        if (Math.abs(dy) < 8) return;
        const s = inicio.scroll;
        // Los textos largos conservan el scroll nativo. Bajar desde el inicio
        // del contenido, o subir la hoja encogida, mueve el panel entero.
        if (!ultimo.current.encogida && s && (dy < 0 && s.scrollTop + s.clientHeight < s.scrollHeight - 1 || dy > 0 && s.scrollTop > 0)) {
          inicio = null;
          return;
        }
        if (!evento.cancelable) { inicio = null; return; }
        arrastrando = true;
        el.dataset.arrastrando = "";
        if (puntero !== null) el.setPointerCapture(puntero);
      }
      evento.preventDefault();
      poner(inicio.posicion + dy / inicio.escala);
      muestras.push({ y: dy / inicio.escala, t });
      while (muestras.length > 2 && t - muestras[0].t > 100) muestras.shift();
    };
    const terminar = (cancelado: boolean) => {
      const esRaton = puntero !== null;
      inicio = null;
      puntero = null;
      if (!arrastrando) return;
      arrastrando = false;
      const a = muestras[0], b = muestras.at(-1);
      const velocidad = a && b && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
      const encogida = cancelado ? ultimo.current.encogida : posicion + velocidad * 140 > recorrido / 2;
      animar(encogida);
      if (!cancelado) ultimo.current.alCambiar(encogida);
      // Un arrastre que empezó sobre «Llamar» no debe convertirse en llamada.
      // En táctil, preventDefault en touchmove ya elimina ese clic sintético;
      // bloquear el siguiente también se comería un toque nuevo del usuario.
      if (cancelado || !esRaton) return;
      limpiarClic?.();
      const tragar = (e: Event) => { e.preventDefault(); e.stopPropagation(); limpiarClic?.(); };
      const timer = setTimeout(() => limpiarClic?.(), 0);
      limpiarClic = () => { clearTimeout(timer); el.removeEventListener("click", tragar, true); limpiarClic = undefined; };
      el.addEventListener("click", tragar, true);
    };
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { terminar(true); return; }
      const p = e.touches[0]; empezar(p.clientX, p.clientY, e.target);
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) { terminar(true); return; }
      const p = e.touches[0]; mover(p.clientX, p.clientY, e.timeStamp, e);
    };
    const touchEnd = () => terminar(false);
    const cancelar = () => terminar(true);
    const pointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      puntero = e.pointerId; empezar(e.clientX, e.clientY, e.target);
    };
    const pointerMove = (e: PointerEvent) => { if (e.pointerId === puntero) mover(e.clientX, e.clientY, e.timeStamp, e); };
    const pointerUp = (e: PointerEvent) => { if (e.pointerId === puntero) terminar(e.type !== "pointerup"); };
    const sync = () => animar(ultimo.current.encogida);
    sincronizar.current = sync;
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(el); observer.observe(cuerpo);
    el.addEventListener("touchstart", touchStart, { passive: true });
    el.addEventListener("touchmove", touchMove, { passive: false });
    el.addEventListener("touchend", touchEnd);
    el.addEventListener("touchcancel", cancelar);
    el.addEventListener("pointerdown", pointerDown);
    el.addEventListener("pointermove", pointerMove);
    el.addEventListener("pointerup", pointerUp);
    el.addEventListener("pointercancel", pointerUp);
    return () => {
      if (sincronizar.current === sync) sincronizar.current = null;
      observer.disconnect(); limpiarClic?.();
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchmove", touchMove);
      el.removeEventListener("touchend", touchEnd);
      el.removeEventListener("touchcancel", cancelar);
      el.removeEventListener("pointerdown", pointerDown);
      el.removeEventListener("pointermove", pointerMove);
      el.removeEventListener("pointerup", pointerUp);
      el.removeEventListener("pointercancel", pointerUp);
    };
  }, []);
}
