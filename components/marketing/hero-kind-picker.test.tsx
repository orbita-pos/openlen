// La píldora Página/App del input de la portada. Mismo arnés manual de
// react-dom + act() que tarjetas-nace-como.test.tsx, con next-intl mockeado a
// un pasapuertas de claves.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { HeroKindPicker } from "./hero-kind-picker";
import type { NaceComo } from "@/components/workspace-v2/tarjetas-nace-como";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const roots: Root[] = [];
const vistos: NaceComo[] = [];
function Arnes({ conJuego = false }: { conJuego?: boolean }) {
  const [v, setV] = useState<NaceComo>("pagina");
  return (
    <HeroKindPicker
      value={v}
      conJuego={conJuego}
      onChange={(x) => {
        vistos.push(x);
        setV(x);
      }}
    />
  );
}
function render(o: { conJuego?: boolean } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    const root = createRoot(container);
    root.render(<Arnes {...o} />);
    roots.push(root);
  });
  return container;
}
const disparador = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const opciones = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vistos.length = 0;
});

describe("la píldora Página/App de la portada", () => {
  it("cerrada, dice lo elegido: Página por defecto", () => {
    const c = render();
    expect(disparador(c).textContent).toContain("start.kind.page");
    expect(disparador(c).getAttribute("aria-expanded")).toBe("false");
    expect(opciones(c)).toHaveLength(0);
  });

  it("abierta, enseña las dos con su línea y marca la elegida", () => {
    const c = render();
    act(() => disparador(c).click());
    const [pagina, app] = opciones(c);
    expect(pagina.textContent).toContain("start.kind.pageHint");
    expect(app.textContent).toContain("start.kind.appHint");
    expect(pagina.getAttribute("aria-checked")).toBe("true");
    expect(app.getAttribute("aria-checked")).toBe("false");
  });

  it("🔴 elegir App la cambia, cierra el menú y la píldora dice App", () => {
    const c = render();
    act(() => disparador(c).click());
    act(() => opciones(c)[1].click());
    expect(vistos).toEqual(["app"]);
    expect(opciones(c)).toHaveLength(0);
    expect(disparador(c).textContent).toContain("start.kind.app");
  });

  // THE GAME MODE (spec local 2026-11-05-modo-juego-design, §8.2): Kimi has 3D Make on its home page.
  it("with games on, it offers Juego third, and choosing it makes the pill say Juego", () => {
    const c = render({ conJuego: true });
    act(() => disparador(c).click());
    expect(opciones(c)).toHaveLength(3);
    expect(opciones(c)[2].textContent).toContain("start.kind.gameHint");
    act(() => opciones(c)[2].click());
    expect(vistos).toEqual(["game"]);
    expect(disparador(c).textContent).toContain("start.kind.game");
  });
});
