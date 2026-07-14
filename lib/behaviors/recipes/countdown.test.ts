import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { countdown } from "./countdown";
import { mount, trackDocumentListeners } from "./test-helpers";

// Reloj fijo compartido por todo el archivo: cada test calcula su fecha
// límite como NOW + delta, así que el ISO que le llega al runtime siempre
// nace ya calculado (nunca se re-deriva "hoy" dentro de un test).
const NOW = new Date("2026-01-01T00:00:00.000Z").getTime();
const iso = (deltaMs: number) => new Date(NOW + deltaMs).toISOString();

describe("countdown", () => {
  // Por qué el tracking de listeners es obligatorio aquí (y no un extra): ver
  // el comentario en test-helpers.ts. countdown no llama a
  // document.addEventListener (se dispara por reloj, no por evento), así que
  // no hay nada que fugue por esa vía específica — pero es el patrón
  // compartido de todas las recetas de este catálogo, y deja el archivo listo
  // si algún día countdown ganara un listener.
  trackDocumentListeners();

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pinta de inmediato al montar (no espera 1s) con los dígitos correctos", () => {
    // 2 días, 3 horas, 4 minutos, 9 segundos — los 4 campos con valores
    // distintos, para que la prueba no pase por accidente si dos campos se
    // intercambiaran entre sí.
    const deltaMs = (2 * 86400 + 3 * 3600 + 4 * 60 + 9) * 1000;
    mount(`<div data-ol-countdown="${iso(deltaMs)}">
      <span data-ol-cd="days">00</span>
      <span data-ol-cd="hours">00</span>
      <span data-ol-cd="mins">00</span>
      <span data-ol-cd="secs">00</span>
    </div>`);
    expect(document.querySelector('[data-ol-cd="days"]')!.textContent).toBe("02");
    expect(document.querySelector('[data-ol-cd="hours"]')!.textContent).toBe("03");
    expect(document.querySelector('[data-ol-cd="mins"]')!.textContent).toBe("04");
    expect(document.querySelector('[data-ol-cd="secs"]')!.textContent).toBe("09");
  });

  it("avanzar el reloj 1000ms cambia los segundos", () => {
    mount(`<div data-ol-countdown="${iso(30_000)}"><span data-ol-cd="secs">00</span></div>`);
    expect(document.querySelector('[data-ol-cd="secs"]')!.textContent).toBe("30");
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('[data-ol-cd="secs"]')!.textContent).toBe("29");
  });

  it("relleno a 2 dígitos: 5 segundos se escriben \"05\", no \"5\"", () => {
    mount(`<div data-ol-countdown="${iso(5000)}"><span data-ol-cd="secs">00</span></div>`);
    expect(document.querySelector('[data-ol-cd="secs"]')!.textContent).toBe("05");
  });

  it("al expirar: congela los dígitos en 00, revela [data-ol-cd-ended] SIN esconder la raíz, y limpia el intervalo", () => {
    mount(`<div data-ol-countdown="${iso(2000)}" id="cd">
      <span data-ol-cd="secs">00</span>
      <p data-ol-cd-ended style="display:none">¡Terminó!</p>
    </div>`);

    vi.advanceTimersByTime(2100); // cruza el umbral de expiración (2000ms)

    const root = document.getElementById("cd")!;
    const ended = document.querySelector<HTMLElement>("[data-ol-cd-ended]")!;
    // La raíz JAMÁS se esconde: [data-ol-cd-ended] vive DENTRO de ella, así
    // que un display:none en la raíz haría el mensaje invisible en un
    // navegador real aunque su propio display quede limpio. El test viejo
    // afirmaba exactamente eso mirando atributos en vez de visibilidad —
    // 5ª instancia del patrón efecto-no-causa (revisión Fable, 2026-07-13).
    expect(root.style.display, "la raíz nunca se esconde — el mensaje de fin vive dentro").not.toBe("none");
    expect(ended.style.display, "el mensaje de fin se revela").toBe("");
    // Y ningún elemento entre el mensaje y la raíz lo esconde.
    for (let el: HTMLElement | null = ended; el && el !== root.parentElement; el = el.parentElement) {
      expect(el.style.display, `un ancestro (${el.tagName}) esconde el mensaje de fin`).not.toBe("none");
    }
    // Los dígitos se congelan en 00 — no se quedan en el último valor visto.
    expect(document.querySelector('[data-ol-cd="secs"]')!.textContent).toBe("00");

    // Prueba de que el intervalo de verdad se limpió, no solo que el estado
    // "se ve" estable: plantamos un centinela después de expirar y avanzamos
    // mucho más el reloj. Si el setInterval siguiera vivo, tick() volvería a
    // correr y lo pisaría (con "00" o lo que sea, pero NUNCA con el centinela
    // intacto).
    const secsEl = document.querySelector<HTMLElement>('[data-ol-cd="secs"]')!;
    secsEl.textContent = "CENTINELA";
    vi.advanceTimersByTime(10_000);
    expect(secsEl.textContent).toBe("CENTINELA");

    // El centinela de arriba prueba el efecto ("no reescribe"), pero no la
    // causa: si alguien borrara el clearInterval(iv) en un refactor futuro,
    // la rama d<=0 retornaría ANTES de tocar los spans, y el centinela
    // seguiría intacto con el setInterval igual vivo — un tick por segundo
    // para siempre en una página publicada que puede quedar abierta horas.
    // vi.getTimerCount() caza la fuga directamente, sin pasar por el DOM.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("se calla en modo edición: avanzar el reloj no cambia el DOM (no le corrompe el cursor al creador)", () => {
    document.body.setAttribute("data-openlen-edit-mode", "");
    mount(`<div data-ol-countdown="${iso(10_000)}"><span data-ol-cd="secs">00</span></div>`);
    // Ni la pintura inmediata al montar...
    expect(document.querySelector('[data-ol-cd="secs"]')!.textContent).toBe("00");
    // ...ni los ticks posteriores tocan el DOM.
    vi.advanceTimersByTime(5000);
    expect(document.querySelector('[data-ol-cd="secs"]')!.textContent).toBe("00");
    document.body.removeAttribute("data-openlen-edit-mode");
  });

  it("declara control-inert: sin runtime se ven los ceros que escribió la IA", () => {
    expect(countdown.degradation).toBe("control-inert");
  });
});
