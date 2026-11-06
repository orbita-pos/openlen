// La píldora Página/App del input de la portada. Mismo arnés manual de
// react-dom + act() que tarjetas-nace-como.test.tsx, con next-intl mockeado a
// un pasapuertas de claves.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { HeroKindPicker, ladoQueCabe } from "./hero-kind-picker";
import type { NaceComo } from "@/components/workspace-v2/tarjetas-nace-como";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const roots: Root[] = [];
const vistos: NaceComo[] = [];
type Opts = { conJuego?: boolean; conHerramienta?: boolean; herramientaBloqueada?: string; disabled?: boolean; piel?: "portada" | "taller" };
function Arnes(o: Opts) {
  const [v, setV] = useState<NaceComo>("pagina");
  return (
    <HeroKindPicker
      value={v}
      {...o}
      onChange={(x) => {
        vistos.push(x);
        setV(x);
      }}
    />
  );
}
function render(o: Opts = {}) {
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

// THE SAME PILL IN /new (Jesús, 06/11: «que el input tenga un select como lo tiene la page /»): the four cards
// above the composer pushed it down; now the choice lives inside it, so it also offers Herramienta.
describe("the pill inside the /new composer", () => {
  it("with games and tools on: Página, App, Juego, Herramienta — and choosing Herramienta makes the pill say it", () => {
    const c = render({ conJuego: true, conHerramienta: true, piel: "taller" });
    act(() => disparador(c).click());
    expect(opciones(c).map((o) => o.textContent)).toEqual([
      expect.stringContaining("start.kind.pageHint"),
      expect.stringContaining("start.kind.appHint"),
      expect.stringContaining("start.kind.gameHint"),
      expect.stringContaining("start.kind.toolHint"),
    ]);
    act(() => opciones(c)[3].click());
    expect(vistos).toEqual(["tool"]);
    expect(disparador(c).textContent).toContain("start.kind.tool");
  });

  it("🔴 on Free, Herramienta says why and can't be chosen", () => {
    const c = render({ conHerramienta: true, herramientaBloqueada: "Necesitas un plan de pago", piel: "taller" });
    act(() => disparador(c).click());
    const tool = opciones(c)[2];
    expect(tool.textContent).toContain("Necesitas un plan de pago");
    expect(tool.disabled).toBe(true);
    act(() => tool.click());
    expect(vistos).toEqual([]);
  });

  it("while the first message is being sent, the pill doesn't open", () => {
    const c = render({ disabled: true, piel: "taller" });
    expect(disparador(c).disabled).toBe(true);
    act(() => disparador(c).click());
    expect(opciones(c)).toHaveLength(0);
  });

  it("in the workspace it wears the workspace's tokens, not the home page's zinc", () => {
    const c = render({ piel: "taller" });
    act(() => disparador(c).click());
    const menu = c.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.className).toContain("bg-elev");
    expect(menu.className).not.toContain("bg-white");
    expect(disparador(c).className).not.toContain("zinc");
  });

  // Seen in the browser on 06/11: in /new the composer sits near the top, under the header, so a menu opening
  // upwards (as on the home page, where the input sits low) hid Página and App behind the header.
  it("🔴 in the workspace the menu opens downwards; on the home page, upwards as before", () => {
    const taller = render({ piel: "taller" });
    act(() => disparador(taller).click());
    const abajo = taller.querySelector<HTMLElement>('[role="menu"]')!.className;
    expect(abajo).toContain("top-[calc(100%+8px)]");
    expect(abajo).not.toContain("bottom-[calc(100%+8px)]");
    const portada = render();
    act(() => disparador(portada).click());
    expect(portada.querySelector<HTMLElement>('[role="menu"]')!.className).toContain("bottom-[calc(100%+8px)]");
  });
});

// Jesús, 06/11: «en el select no se ve todo, se esconde». Without its top bar /new put the box mid-screen, and the
// four options opening downwards ran off the bottom of the window: Herramienta was cut in half.
describe("the menu opens where it fits", () => {
  it("🔴 prefers its skin's side, flips when that side is short, and takes the roomier when neither fits", () => {
    expect(ladoQueCabe("abajo", 360, 400, 300)).toBe("arriba");
    expect(ladoQueCabe("abajo", 360, 400, 380)).toBe("abajo");
    expect(ladoQueCabe("abajo", 360, 100, 500)).toBe("abajo");
    expect(ladoQueCabe("arriba", 360, 100, 500)).toBe("abajo");
    expect(ladoQueCabe("arriba", 360, 400, 380)).toBe("arriba");
    expect(ladoQueCabe("abajo", 600, 300, 200)).toBe("arriba");
    expect(ladoQueCabe("abajo", 600, 200, 300)).toBe("abajo");
  });

  it("🔴 in /new with the box mid-screen and no room below, it opens upwards", () => {
    const ancla = document.createElement("div");
    ancla.getBoundingClientRect = () => ({ top: 404, bottom: 524, left: 0, right: 820, width: 820, height: 120, x: 0, y: 404, toJSON: () => ({}) });
    const offsetParent = vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(ancla);
    const offsetHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(380);
    const alto = window.innerHeight;
    window.innerHeight = 900;
    try {
      const c = render({ conJuego: true, conHerramienta: true, piel: "taller" });
      act(() => disparador(c).click());
      const menu = c.querySelector<HTMLElement>('[role="menu"]')!;
      expect(menu.dataset.lado).toBe("arriba");
      expect(menu.className).toContain("bottom-[calc(100%+8px)]");
      expect(menu.className).not.toContain("top-[calc(100%+8px)]");
    } finally {
      offsetParent.mockRestore();
      offsetHeight.mockRestore();
      window.innerHeight = alto;
    }
  });
});
