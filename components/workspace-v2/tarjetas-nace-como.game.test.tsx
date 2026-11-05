// THE «JUEGO» CARD (spec local 2026-11-05-modo-juego-design, §8.2): Kimi's «Select type», beside Página and App —
// only when games are on — and before Herramienta when tools are on too.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { TarjetasNaceComo, type NaceComo } from "./tarjetas-nace-como";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function render(value: NaceComo, o: { conJuego?: boolean; conHerramienta?: boolean } = {}) {
  const onChange = vi.fn();
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  roots.push(root);
  act(() => root.render(<TarjetasNaceComo value={value} onChange={onChange} {...o} />));
  return {
    onChange,
    group: () => document.querySelector<HTMLElement>('[role="radiogroup"]')!,
    radios: () => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')],
  };
}

const key = (el: HTMLElement, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

describe("TarjetasNaceComo with games", () => {
  it("without games: no Juego card, as before", () => {
    expect(render("pagina").radios().map((r) => r.textContent)).not.toContainEqual(expect.stringContaining("start.kind.game"));
  });

  it("with games: Página, App, Juego — and the third is the game", () => {
    const r = render("pagina", { conJuego: true });
    expect(r.radios()).toHaveLength(3);
    expect(r.radios()[2]!.textContent).toContain("start.kind.game");
    expect(r.radios()[2]!.textContent).toContain("start.kind.gameHint");
    act(() => r.radios()[2]!.click());
    expect(r.onChange).toHaveBeenLastCalledWith("game");
  });

  it("with games and tools: four cards, two by two, Juego before Herramienta, and the arrows go round the four", () => {
    const r = render("game", { conJuego: true, conHerramienta: true });
    expect(r.radios().map((b) => (b.textContent ?? "").replace(/Hint$/, ""))).toEqual([
      expect.stringContaining("start.kind.page"),
      expect.stringContaining("start.kind.app"),
      expect.stringContaining("start.kind.game"),
      expect.stringContaining("start.kind.tool"),
    ]);
    expect(r.group().className).toContain("grid-cols-2");
    expect(r.group().className).not.toContain("grid-cols-3");
    key(r.radios()[2]!, "ArrowRight");
    expect(r.onChange).toHaveBeenLastCalledWith("tool");
    key(r.radios()[2]!, "ArrowLeft");
    expect(r.onChange).toHaveBeenLastCalledWith("app");
  });
});
