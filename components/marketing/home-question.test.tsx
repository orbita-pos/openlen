// The home's question (Jesús, 06/11): the server renders the neutral one (what crawlers and no-JS visitors read); in
// the browser it becomes one of the questions of the visitor's time of day, faded in so the swap isn't seen. Same
// manual react-dom + act() harness as hero-kind-picker.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";

const QUESTIONS: Record<string, string[]> = {
  "hero.questions.morning": ["m0", "m1", "m2"],
  "hero.questions.afternoon": ["a0", "a1", "a2"],
  "hero.questions.evening": ["e0", "e1", "e2"],
  "hero.questions.night": ["n0", "n1", "n2"],
};
vi.mock("next-intl", () => {
  const t = (key: string) => (key === "hero.question" ? "default question" : key);
  (t as unknown as { raw: (k: string) => unknown }).raw = (k: string) => QUESTIONS[k] ?? [];
  return { useTranslations: () => t };
});

import { HomeQuestion } from "./home-question";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});
const at = (h: number) => () => new Date(2026, 10, 6, h, 30);

describe("the home's question", () => {
  it("🔴 the server renders the neutral question, as the H1, waiting to fade in", () => {
    const html = renderToString(<HomeQuestion now={at(9)} random={() => 0} />);
    expect(html).toContain("<h1");
    expect(html).toContain("default question");
    expect(html).toContain("opacity-0");
  });

  it("🔴 in the browser it becomes a question of the visitor's time of day, and shows", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(<HomeQuestion now={at(22)} random={() => 0.5} />));
    const h1 = host.querySelector("h1")!;
    expect(h1.textContent).toBe("e1");
    expect(h1.className).not.toContain("opacity-0");
  });

  it("at night, a night question", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(<HomeQuestion now={at(2)} random={() => 0} />));
    expect(host.querySelector("h1")!.textContent).toBe("n0");
  });
});
