// THE CHIP OVER THE COMPOSER with what a visual reported for the next message (updateModelContext). It is text the
// person didn't write, so it is shown whole on demand — one truncated line hides what the model is about to read —
// and it can be dropped; the label of that button is in the person's language.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { VisualContextChip } from "./visual-context-chip";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(text: string, onClear = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<VisualContextChip text={text} onClear={onClear} />));
  return { host, onClear };
}

const LONG = "Selected rows:\nMarzo ($1,200)\nAbril ($980)\nMayo ($1,410) — and a long note the person could not read on one truncated line";

describe("VisualContextChip", () => {
  it("🔴 starts as one truncated line and shows the whole text, line breaks kept, when it is opened", () => {
    const { host } = mount(LONG);
    const toggle = host.querySelector<HTMLButtonElement>("[data-testid='visual-context-toggle']")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("[data-testid='visual-context-text']")!.className).toContain("truncate");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const text = host.querySelector("[data-testid='visual-context-text']")!;
    expect(text.className).toContain("whitespace-pre-wrap");
    expect(text.className).not.toContain("truncate");
    expect(text.textContent).toContain(LONG);
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("the text is plain text, never markup", () => {
    const { host } = mount("<img src=x onerror=alert(1)>");
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("🔴 the clear button is named in the person's language, not hard-coded English, and clears", () => {
    const { host, onClear } = mount("Selected: Marzo");
    const clear = host.querySelector<HTMLButtonElement>("button[aria-label]")!;
    expect(clear.getAttribute("aria-label")).toBe("visualContextClear");
    act(() => clear.click());
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
