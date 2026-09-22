import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ESCRITORES_ELEGIBLES } from "@/lib/ai/provider-switch";
import { multiploDeSalida } from "@/lib/generation/model-policy";

import { SelectorDeModelo } from "./selector-de-modelo";

// EL SELECTOR DE MODELO DE CREAR. Dos familias de reglas y las dos importan:
//
//  1. LO QUE ENSEÑA. La fila de defecto primero con el «(ahora: …)» vivo, y la
//     del razonador APAGADA con el motivo en el sitio de la descripción cuando
//     hay una imagen. Es la forma del selector de modelo de Claude Code, cuyas filas
//     deshabilitadas llevan el motivo dentro y se hunden al fondo.
//  2. CÓMO SE SALE. Esc y clic fuera. Iban en el gancho compartido
//     `use-mando-desplegable`, así que probarlas aquí cubre también el mando de
//     esfuerzo de Len, que tenía el mismo hueco.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

// El traductor devuelve la CLAVE, no una traducción: lo que se comprueba es qué
// cadena pide el componente, no cómo suena en español. Mismo criterio que
// `mando-esfuerzo.test.tsx`.
const t = (clave: string, valores?: Record<string, string | number>) =>
  valores ? `${clave}(${Object.values(valores).join(",")})` : clave;

function montar(props: Partial<Parameters<typeof SelectorDeModelo>[0]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      <SelectorDeModelo
        escritor={null}
        hasImages={false}
        onChange={() => undefined}
        abierto
        onAbrir={() => undefined}
        t={t}
        {...props}
      />,
    );
  });
  return host;
}

const opciones = (host: HTMLElement) =>
  [...host.querySelectorAll('[role="menuitemradio"]')] as HTMLButtonElement[];

const teclaEn = (el: HTMLElement, key: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
});

describe("lo que enseña", () => {
  it("la primera fila es el defecto, y dice quién escribiría AHORA", () => {
    const host = montar();
    const primera = opciones(host)[0]!;
    expect(primera.textContent).toContain("modelo.auto");
    // Desde el 2026-09-14 el defecto de Crear es el papel con visión, con imagen
    // o sin ella. El «(ahora: …)» sale de la misma función que el cable, así que
    // si el defecto cambia otra vez esta prueba lo dice.
    expect(primera.textContent).toContain("DeepSeek V4.1 Flash");
  });

  it("con imagen adjunta, el «ahora» de la fila de defecto cambia solo", () => {
    const host = montar({ hasImages: true });
    expect(opciones(host)[0]!.textContent).toContain("DeepSeek V4.1 Flash");
  });

  // 🔴 LA REGLA DE LA VISIÓN, VISIBLE. El razonador no tiene ojos, así que con
  // una imagen delante su fila no se puede elegir — y el motivo ocupa el sitio
  // de la descripción, que es como lo hace Claude Code.
  it("con imagen, la fila del razonador se apaga y dice por qué", () => {
    const host = montar({ hasImages: true });
    const fila = opciones(host).find((b) => b.textContent?.includes("DeepSeek V4 Flash"))!;
    expect(fila.disabled).toBe(true);
    expect(fila.textContent).toContain("modelo.sinVision");
    expect(fila.textContent).not.toContain("modelo.reasonerDesc");
  });

  it("sin imagen no se apaga ninguna", () => {
    expect(montar().querySelectorAll("[disabled]")).toHaveLength(0);
  });

  // ─── EL SUFIJO DE COSTE ────────────────────────────────────────────────────
  //
  // 🔴 ESTE SELECTOR ESTUVO OCHO DÍAS DICIENDO QUE LAS DOS FILAS COSTABAN LO
  // MISMO. Su comentario afirmaba «los dos papeles comparten tarifa exacta», y
  // era falso desde el 2026-09-12: el papel con visión corre en
  // `deepseek-v4p1-flash`, cuya salida es 1,82x la del razonador. Nadie lo vio
  // porque la afirmación era PROSA — no había nada que pudiera ponerse rojo.
  //
  // Estas tres pruebas son ese algo. No fijan el número 1,8 a mano: comprueban
  // que el sufijo SALE de la tabla, así que si mañana los precios se igualan la
  // primera se pone roja y hay que venir a decidir, en vez de seguir enseñando
  // un múltiplo muerto.
  it("la fila cara lleva el múltiplo, y sale de la tarifa", () => {
    const esperado = multiploDeSalida("visual_critic", ESCRITORES_ELEGIBLES);
    expect(esperado, "si esto es 1, los precios se igualaron: revisa el sufijo").toBeGreaterThan(1.1);
    // `.slice(1)` salta la fila de «Automático»: su descripción nombra al
    // modelo que escribiría hoy —V4.1— así que un `find` por nombre la pilla a
    // ella y no a la fila del papel.
    const fila = opciones(montar())
      .slice(1)
      .find((b) => b.textContent?.includes("DeepSeek V4.1 Flash"))!;
    expect(fila.textContent).toContain(`modelo.masCaro(${Math.round(esperado * 10) / 10})`);
  });

  it("la fila barata no lleva ninguno", () => {
    const fila = opciones(montar()).find((b) => b.textContent?.includes("DeepSeek V4 Flash"))!;
    expect(fila.textContent).toContain("modelo.reasonerDesc");
    expect(fila.textContent).not.toContain("modelo.masCaro");
  });

  // Una fila que no se puede elegir no necesita que le pongan precio: el motivo
  // ocupa el sitio de la descripción, y el sufijo se cuelga de la descripción.
  it("la fila apagada no lleva múltiplo", () => {
    const fila = opciones(montar({ hasImages: true })).find((b) =>
      b.textContent?.includes("DeepSeek V4 Flash"),
    )!;
    expect(fila.textContent).not.toContain("modelo.masCaro");
  });

  // Las deshabilitadas al fondo, como en el suyo.
  it("la fila apagada se hunde al fondo de la lista", () => {
    const textos = opciones(montar({ hasImages: true })).map((b) => b.textContent ?? "");
    expect(textos[textos.length - 1]).toContain("DeepSeek V4 Flash");
  });

  it("elegir una fila avisa y cierra", () => {
    const onChange = vi.fn();
    const onAbrir = vi.fn();
    const host = montar({ onChange, onAbrir });
    act(() => {
      // `.slice(1)` salta la fila de «Automático», cuya descripción TAMBIÉN
      // nombra a V4.1 desde el cambio de defecto. Sin esto la prueba pulsaría el
      // defecto creyendo pulsar el modelo, y afirmaría lo contrario de lo suyo.
      opciones(host).slice(1).find((b) => b.textContent?.includes("V4.1"))!.click();
    });
    expect(onChange).toHaveBeenCalledWith("visual_critic");
    expect(onAbrir).toHaveBeenCalledWith(false);
  });

  // «Automático» es NULL, no una cadena: es lo que significa la columna.
  it("elegir «Automático» manda null", () => {
    const onChange = vi.fn();
    const host = montar({ escritor: "reasoner", onChange });
    act(() => opciones(host)[0]!.click());
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("cómo se sale", () => {
  // 🔴 EL HUECO QUE TENÍAN LOS DOS MANDOS. Sin esto se abría y sólo se cerraba
  // eligiendo o volviendo a pulsar el botón. Claude Code tiene
  // `escape: "select:cancel"` en su contexto `Select`.
  it("Esc cierra sin elegir nada", () => {
    const onChange = vi.fn();
    const onAbrir = vi.fn();
    const host = montar({ onChange, onAbrir });
    teclaEn(opciones(host)[0]!, "Escape");
    expect(onAbrir).toHaveBeenCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Esc devuelve el foco al disparador, para no perder el sitio", () => {
    const host = montar();
    const disparador = host.querySelector("button")!;
    teclaEn(opciones(host)[0]!, "Escape");
    expect(document.activeElement).toBe(disparador);
  });

  it("un clic fuera cierra sin elegir nada", () => {
    const onChange = vi.fn();
    const onAbrir = vi.fn();
    montar({ onChange, onAbrir });
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(onAbrir).toHaveBeenCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  // La otra mitad, y sin ella la de arriba pasaría por casualidad: un clic
  // DENTRO no puede cerrar, o elegir sería imposible.
  it("un clic dentro no cierra", () => {
    const onAbrir = vi.fn();
    const host = montar({ onAbrir });
    act(() => {
      opciones(host)[0]!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(onAbrir).not.toHaveBeenCalled();
  });

  it("cerrado no escucha nada: un clic fuera no avisa", () => {
    const onAbrir = vi.fn();
    montar({ abierto: false, onAbrir });
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(onAbrir).not.toHaveBeenCalled();
  });
});

describe("las flechas", () => {
  it("al abrir, el foco entra en la lista", () => {
    const host = montar();
    expect(document.activeElement).toBe(opciones(host)[0]);
  });

  it("al abrir con algo fijado, el foco entra en LO ELEGIDO", () => {
    const host = montar({ escritor: "visual_critic" });
    expect(document.activeElement?.textContent).toContain("DeepSeek V4.1 Flash");
  });

  it("abajo y arriba recorren, e Inicio/Fin van a los extremos", () => {
    const host = montar();
    const items = opciones(host);
    teclaEn(items[0]!, "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    teclaEn(items[1]!, "ArrowUp");
    expect(document.activeElement).toBe(items[0]);
    teclaEn(items[0]!, "End");
    expect(document.activeElement).toBe(items[items.length - 1]);
    teclaEn(items[items.length - 1]!, "Home");
    expect(document.activeElement).toBe(items[0]);
  });

  // Da la vuelta: un menú corto donde la flecha deja de responder se lee como
  // que se ha colgado.
  it("desde la última, abajo vuelve a la primera", () => {
    const host = montar();
    const items = opciones(host);
    teclaEn(items[0]!, "End");
    teclaEn(items[items.length - 1]!, "ArrowDown");
    expect(document.activeElement).toBe(items[0]);
  });

  // Una fila apagada no se recorre: las opciones se leen del DOM y el selector
  // excluye `[disabled]`.
  it("las flechas se saltan la fila apagada", () => {
    const host = montar({ hasImages: true });
    const navegables = opciones(host).filter((b) => !b.disabled);
    expect(navegables).toHaveLength(2);
    teclaEn(navegables[0]!, "End");
    expect(document.activeElement).toBe(navegables[1]);
  });
});
