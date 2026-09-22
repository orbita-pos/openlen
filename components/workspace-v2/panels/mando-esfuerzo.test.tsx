import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { NIVELES, NIVEL_POR_DEFECTO } from "@/lib/agent/esfuerzo";
import { MandoEsfuerzo } from "./mando-esfuerzo";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
// El traductor devuelve la CLAVE, no una traducción: lo que se comprueba es qué
// cadena pide el componente, no cómo suena en español. Así la prueba no se cae
// el día que alguien reescriba una etiqueta.
const t = (clave: string, valores?: Record<string, string>) =>
  valores ? `${clave}(${Object.values(valores).join(",")})` : clave;

function montar(props: Partial<Parameters<typeof MandoEsfuerzo>[0]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      <MandoEsfuerzo
        esfuerzo="auto"
        niveles={NIVELES}
        resuelveA={NIVEL_POR_DEFECTO}
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

afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
});

describe("el mando de esfuerzo tiene la forma de Claude Code", () => {
  it("ofrece los cinco niveles más `auto`", () => {
    expect(opciones(montar())).toHaveLength(NIVELES.length + 1);
  });

  // Como en Claude Code, los cinco son los peldaños y `auto` se añade suelto DETRÁS. Arriba se leería
  // como «el más bajo», y no es un peldaño.
  it("`auto` va el ÚLTIMO, no el primero", () => {
    const textos = opciones(montar()).map((b) => b.textContent ?? "");
    expect(textos[0]).toContain("composer.low");
    expect(textos[textos.length - 1]).toContain("composer.effortAutoNow");
  });

  it("los niveles salen en el orden de la escalera", () => {
    const textos = opciones(montar()).map((b) => b.textContent ?? "");
    NIVELES.forEach((n, i) => expect(textos[i]).toContain(`composer.${n}`));
  });

  // 🔴 LA REGLA DE ESTE MANDO. Claude Code imprime `Effort level: auto
  // (currently high)` y nunca deja al usuario sin saber en qué nivel corre.
  it("`auto` se enseña RESUELTO: dice a qué nivel equivale", () => {
    const auto = opciones(montar({ resuelveA: "high" })).at(-1);
    expect(auto?.textContent).toContain("composer.effortAutoNow(composer.high)");
  });

  // 🔴 LA ESCALERA LA MANDA EL SERVIDOR, no una constante del cliente.
  //
  // Claude Code ofrece los peldaños POR MODELO, y eso es lo que se copia. ⚰️ Lo que decía aquí de su reserva para un modelo
  // desconocido —`["low","medium","high"]`— es falso: la suya es permisiva. La
  // nuestra es más estricta a propósito y se gana MIDIENDO el dial del modelo.
  //
  // Sin esta prueba el componente podía volver a pintar `NIVELES` importado y
  // todo seguiria verde — que es como llego a haber un `niveles` en la
  // respuesta del GET que no leia nadie.
  it("pinta los peldaños que le dan, no los cinco de la constante", () => {
    const host = montar({ niveles: ["low", "medium", "high"] });
    const textos = opciones(host).map((b) => b.textContent ?? "");
    // tres peldaños + auto
    expect(textos).toHaveLength(4);
    expect(textos.join(" ")).not.toContain("composer.xhigh");
    expect(textos.join(" ")).not.toContain("composer.max");
  });

  // BRAZO DE CONTROL del de arriba: que diga «high» no puede ser una constante
  // escrita en el componente. Con otro `resuelveA` tiene que decir otro nivel.
  it("BRAZO DE CONTROL: el nivel mostrado sigue a `resuelveA`", () => {
    const auto = opciones(montar({ resuelveA: "low" })).at(-1);
    expect(auto?.textContent).toContain("composer.effortAutoNow(composer.low)");
    expect(auto?.textContent).not.toContain("composer.high");
  });

  it("marca cuál está elegido, y sólo ése", () => {
    const marcados = opciones(montar({ esfuerzo: "xhigh" })).filter(
      (b) => b.getAttribute("aria-checked") === "true",
    );
    expect(marcados).toHaveLength(1);
    expect(marcados[0]?.textContent).toContain("composer.xhigh");
  });

  it("elegir avisa del nivel y cierra el menú", () => {
    const onChange = vi.fn();
    const onAbrir = vi.fn();
    const host = montar({ onChange, onAbrir });
    act(() => {
      opciones(host)[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("low");
    expect(onAbrir).toHaveBeenCalledWith(false);
  });

  it("cerrado no pinta el menú, sólo el botón", () => {
    const host = montar({ abierto: false });
    expect(opciones(host)).toHaveLength(0);
    expect(host.querySelector("button[aria-expanded]")).not.toBeNull();
  });

  // Ninguna etiqueta habla de tokens: describen el TRABAJO, que es lo que hacen
  // las de Claude Code. La clave `*Desc` es la que lo lleva.
  it("cada nivel trae su descripción de RESULTADO", () => {
    const textos = opciones(montar()).map((b) => b.textContent ?? "");
    NIVELES.forEach((n, i) => expect(textos[i]).toContain(`composer.${n}Desc`));
    expect(textos.at(-1)).toContain("composer.effortAutoDesc");
  });
});
