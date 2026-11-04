// THE «HERRAMIENTA» CARD (spec local 2026-11-04-herramientas-hechas-por-len, §4.9 door 2): DeepSeek's mode picker,
// beside Página and App — only when tools are on, and closed on the Free plan with its reason.
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

function render(value: NaceComo, o: { conHerramienta?: boolean; herramientaBloqueada?: string } = {}) {
  const onChange = vi.fn();
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  roots.push(root);
  act(() => root.render(<TarjetasNaceComo value={value} onChange={onChange} {...o} />));
  return { onChange, radios: () => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')] };
}

const key = (el: HTMLElement, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

describe("TarjetasNaceComo with tools", () => {
  it("without tools: two cards, as before", () => {
    expect(render("pagina").radios()).toHaveLength(2);
  });

  it("with tools: three, and the arrows go round the three", () => {
    const a = render("app", { conHerramienta: true });
    expect(a.radios()).toHaveLength(3);
    key(a.radios()[1]!, "ArrowRight");
    expect(a.onChange).toHaveBeenLastCalledWith("tool");
    document.body.innerHTML = "";
    const b = render("tool", { conHerramienta: true });
    key(b.radios()[2]!, "ArrowRight");
    expect(b.onChange).toHaveBeenLastCalledWith("pagina");
    key(b.radios()[2]!, "ArrowLeft");
    expect(b.onChange).toHaveBeenLastCalledWith("app");
  });

  it("on Free the tool card can't be chosen and says why", () => {
    const r = render("pagina", { conHerramienta: true, herramientaBloqueada: "Necesitas un plan de pago" });
    const tool = r.radios()[2]!;
    expect(tool.disabled).toBe(true);
    expect(tool.textContent).toContain("Necesitas un plan de pago");
  });
});
