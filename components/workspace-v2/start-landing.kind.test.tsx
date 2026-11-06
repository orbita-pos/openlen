// WHAT THE PROJECT IS BORN AS, INSIDE THE COMPOSER (Jesús, 06/11: «que el input tenga un select como lo tiene la
// page /, porque así como lo tenemos con un grid baja el input y se ve feo»). The four cards above the composer
// pushed it down; the home page's pill (`hero-kind-picker.tsx`) now sits in the composer's own row, between the
// microphone and «send», and the cards are gone. Same harness as start-landing.url.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { BriefFormState } from "@/components/workspace/types";
import type { NaceComo } from "./tarjetas-nace-como";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "es",
}));
vi.mock("@/lib/uso/cliente", () => ({ registrarUso: () => {} }));
vi.mock("./use-templates", () => ({ useTemplates: () => ({ templates: [], isLoading: false, error: null }) }));

import { HeroComposer, StartLanding } from "./start-landing";

const roots: Root[] = [];
const vistos: NaceComo[] = [];
const state: BriefFormState = { prompt: "", setPrompt: () => {}, fotos: [], setFotos: () => {} };

function Landing() {
  const [v, setV] = useState<NaceComo>("pagina");
  return (
    <StartLanding
      aiState={state}
      onGenerate={() => {}}
      generating={false}
      effort="low"
      onEffortChange={() => {}}
      onPreviewTemplate={() => {}}
      onPaste={() => {}}
      naceComo={v}
      onNaceComoChange={(x) => {
        vistos.push(x);
        setV(x);
      }}
      conJuego
      conHerramienta
    />
  );
}
function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    const root = createRoot(container);
    root.render(node);
    roots.push(root);
  });
  return container;
}
const pill = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"][title="start.kind.label"]');

afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  vistos.length = 0;
});

describe("the kind choice on the /new start screen", () => {
  it("🔴 no grid of cards above the composer: the choice is a pill inside it, in the row with «send»", () => {
    const c = mount(<Landing />);
    expect(c.querySelector('[role="radiogroup"]')).toBeNull();
    const p = pill(c);
    expect(p).not.toBeNull();
    const composer = c.querySelector(".nc-composer")!;
    expect(composer.contains(p)).toBe(true);
    const send = composer.querySelector('button[aria-label="aiBrief.generate"]')!;
    expect(send.parentElement!.contains(p)).toBe(true);
  });

  it("choosing Juego in the pill changes what the project is born as, and the headline follows", () => {
    const c = mount(<Landing />);
    act(() => pill(c)!.click());
    const juego = [...c.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((b) => b.textContent?.includes("start.kind.gameHint"))!;
    act(() => juego.click());
    expect(vistos).toEqual(["game"]);
    expect(c.querySelector("h2")?.textContent).toBe("start.kind.gameHeadline");
    expect(pill(c)!.textContent).toContain("start.kind.game");
  });

  it("🔴 is the same box as the home's: the shared PromptBox, in the workspace's colours (Jesús, 06/11)", () => {
    const c = mount(<Landing />);
    const box = c.querySelector('[data-prompt-box="taller"]');
    expect(box).not.toBeNull();
    expect(box!.contains(pill(c))).toBe(true);
  });

  it("without a kind choice, the composer has no pill (as everywhere else it is used)", () => {
    const c = mount(<HeroComposer state={state} onGenerate={() => {}} generating={false} effort="low" onEffortChange={() => {}} />);
    expect(pill(c)).toBeNull();
  });
});
