// A URL in the start composer is just text (26/10). The "make one like this"
// chip used to open any pasted address 700 ms after typing, run a vision model
// on it and tell Len the user wanted its style, even when the link was their
// Instagram. Now Len looks at it himself, when he decides (`view_page` with
// `url`), so the composer asks the server nothing. Same manual react-dom +
// act() harness as tarjetas-nace-como.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { BriefFormState } from "@/components/workspace/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const usageEvents = vi.hoisted(() => [] as [string, unknown][]);
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "es",
}));
vi.mock("@/lib/uso/cliente", () => ({
  registrarUso: (name: string, data: unknown) => usageEvents.push([name, data]),
}));

import { HeroComposer } from "./start-landing";

const roots: Root[] = [];
function render(prompt: string, onGenerate = () => {}) {
  const state: BriefFormState = { prompt, setPrompt: () => {}, fotos: [], setFotos: () => {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    const root = createRoot(container);
    root.render(<HeroComposer state={state} onGenerate={onGenerate} generating={false} effort="low" onEffortChange={() => {}} />);
    roots.push(root);
  });
  return container;
}

afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  usageEvents.length = 0;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a URL in the start composer", () => {
  it("🔴 is not fetched and puts no chip above the text", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const c = render("hazme una como https://linear.app pero para mi estudio de tatuajes");
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(c.querySelector('[title="linear.app"]')).toBeNull();
  });

  it("sending records the shape of the message without a reference", () => {
    const sent = vi.fn();
    const c = render("hazme una como https://linear.app", sent);
    const send = c.querySelector<HTMLButtonElement>('button[aria-label="aiBrief.generate"]');
    expect(send).not.toBeNull();
    act(() => send!.click());
    expect(sent).toHaveBeenCalledTimes(1);
    expect(usageEvents).toContainEqual(["crear_envio", { imagenes: 0 }]);
  });
});
