// WHAT THE PROJECT IS BORN AS, INSIDE THE COMPOSER (Jesús, 06/11: «que el input tenga un select como lo tiene la
// page /, porque así como lo tenemos con un grid baja el input y se ve feo»). The four cards above the composer
// pushed it down; the home page's pill (`hero-kind-picker.tsx`) now sits in the composer's own row, between the
// microphone and «send», and the cards are gone. Same harness as start-landing.url.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { BriefFormState } from "@/components/workspace/types";
import type { NaceComo } from "./tarjetas-nace-como";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => {
  const t = (key: string) => key;
  (t as unknown as { raw: (k: string) => unknown }).raw = (k: string) => (k.startsWith("hero.questions.") ? ["q0", "q1", "q2"] : []);
  return { useTranslations: () => t, useLocale: () => "es" };
});
vi.mock("@/lib/uso/cliente", () => ({ registrarUso: () => {} }));
vi.mock("./use-templates", () => ({ useTemplates: () => ({ templates: [], isLoading: false, error: null }) }));

import { HeroComposer, StartLanding } from "./start-landing";

const roots: Root[] = [];
const vistos: NaceComo[] = [];
const pegados: number[] = [];
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
      onPaste={() => pegados.push(1)}
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
  pegados.length = 0;
});

describe("the /new start screen is the home's (Jesús, 06/11: «/new y / quiero que sea compartido»)", () => {
  it("🔴 the question of the time of day over the box, and nothing under it: no gallery, no paste link", () => {
    const c = mount(<Landing />);
    const question = c.querySelector(".home-question");
    expect(question).not.toBeNull();
    // /new already has its own (hidden) h1: the question is the screen's h2 here.
    expect(question!.tagName).toBe("H2");
    expect(question!.textContent).toMatch(/^q[012]$/);
    expect(c.textContent).not.toContain("start.galleryHeading");
    expect(c.textContent).not.toContain("start.pasteHtml");
  });

  // Jesús, 06/11: «el input de 660 … que sea menos ancho», like Gemini's. The home's hero has the same width.
  it("🔴 the box is 660 px wide at most, like Gemini's, on /new and on the home", () => {
    const c = mount(<Landing />);
    const wrapper = c.querySelector("[data-prompt-box]")!.parentElement!;
    expect(wrapper.className.split(/\s+/)).toContain("max-w-[660px]");
    const hero = readFileSync(join(process.cwd(), "components/marketing/hero.tsx"), "utf8");
    expect(hero).toContain("max-w-[660px]");
    expect(hero).not.toContain("max-w-3xl");
  });

  it("🔴 the light is there in both themes: nothing hides it in the light one (it has its own, home-glow.css)", () => {
    const c = mount(<Landing />);
    const glow = c.querySelector("[data-home-glow]");
    expect(glow).not.toBeNull();
    expect(glow!.parentElement!.className.split(/\s+/)).not.toContain("hidden");
  });

  it("🔴 «Pegar HTML» moved into the box's + menu, and opens the paste flow", () => {
    const c = mount(<Landing />);
    act(() => c.querySelector<HTMLButtonElement>('button[aria-label="newChat.composer.plus"]')!.click());
    const paste = [...c.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.includes("start.pasteTitle"))!;
    expect(paste.textContent).toContain("start.pasteHint");
    act(() => paste.click());
    expect(pegados).toEqual([1]);
  });
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

  it("choosing Juego in the pill changes what the project is born as, and the box's placeholder follows", () => {
    const c = mount(<Landing />);
    act(() => pill(c)!.click());
    const juego = [...c.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((b) => b.textContent?.includes("start.kind.gameHint"))!;
    act(() => juego.click());
    expect(vistos).toEqual(["game"]);
    expect(c.querySelector("textarea")?.getAttribute("placeholder")).toBe("start.kind.gamePlaceholder");
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
