// Las dos tarjetas del principio, Página o App. Mismo arnés manual de
// react-dom + act() que reference-field.test.tsx, con next-intl mockeado a un
// pasapuertas de claves.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { TarjetasNaceComo, type NaceComo } from "./tarjetas-nace-como";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const roots: Root[] = [];
const vistos: NaceComo[] = [];
function Arnes() {
  const [v, setV] = useState<NaceComo>("pagina");
  return (
    <TarjetasNaceComo
      value={v}
      onChange={(x) => {
        vistos.push(x);
        setV(x);
      }}
    />
  );
}
function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    const root = createRoot(container);
    root.render(<Arnes />);
    roots.push(root);
  });
  return container;
}
const radios = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('[role="radio"]'));

afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  vistos.length = 0;
  document.body.innerHTML = "";
});

describe("las tarjetas Página / App", () => {
  it("son un grupo de radios con Página marcada por defecto", () => {
    const c = render();
    expect(c.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("start.kind.label");
    const [pagina, app] = radios(c);
    expect(pagina!.textContent).toContain("start.kind.page");
    expect(pagina!.textContent).toContain("start.kind.pageHint");
    expect(app!.textContent).toContain("start.kind.appHint");
    expect(pagina!.getAttribute("aria-checked")).toBe("true");
    expect(app!.getAttribute("aria-checked")).toBe("false");
    // Una sola parada de tabulador: la elegida.
    expect(pagina!.tabIndex).toBe(0);
    expect(app!.tabIndex).toBe(-1);
  });

  it("un clic en App la elige", () => {
    const c = render();
    act(() => radios(c)[1]!.click());
    expect(vistos).toEqual(["app"]);
    expect(radios(c)[1]!.getAttribute("aria-checked")).toBe("true");
    expect(radios(c)[0]!.getAttribute("aria-checked")).toBe("false");
  });

  it("las flechas pasan a la otra y la eligen, como un grupo de radios nativo", () => {
    const c = render();
    act(() => {
      radios(c)[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(vistos).toEqual(["app"]);
    expect(document.activeElement).toBe(radios(c)[1]);
    act(() => {
      radios(c)[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(vistos).toEqual(["app", "pagina"]);
  });
});

describe("lo que la tarjeta App añade al primer mensaje", () => {
  it("una página no añade nada; una app, `naceComo` y el idioma", async () => {
    const { camposDeNacer } = await import("./chat/nace-como");
    expect(camposDeNacer(null)).toEqual({});
    expect(camposDeNacer({ idioma: "es" })).toEqual({});
    expect(camposDeNacer({ naceComo: "app", idioma: "ja" })).toEqual({ naceComo: "app", idioma: "ja" });
    expect(camposDeNacer({ naceComo: "app" })).toEqual({ naceComo: "app" });
  });
});
