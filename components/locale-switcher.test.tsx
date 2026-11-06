// The language list opens towards the side with more room and never taller than that room (final review of the home,
// 06/11): in the home's one-row footer, in a short window, it opened DOWNWARDS (it only opened up with ≥ 296 px above)
// and the home's wrapper (`overflow-clip`) cut it off. Same manual react-dom + act() harness as the marketing tests.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useLocale: () => "es", useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/generation-busy", () => ({ useGenerationBusy: () => false }));

import { LocaleSwitcher } from "./locale-switcher";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function openAt(rect: { top: number; bottom: number }, innerHeight: number) {
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(innerHeight);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<LocaleSwitcher />));
  const wrapper = host.firstElementChild as HTMLElement;
  wrapper.getBoundingClientRect = () => ({ top: rect.top, bottom: rect.bottom, left: 0, right: 0, width: 0, height: rect.bottom - rect.top, x: 0, y: rect.top, toJSON: () => ({}) });
  act(() => host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!.click());
  return host.querySelector<HTMLElement>('[role="listbox"]')!;
}

describe("where the language list opens", () => {
  it("🔴 at the bottom of a short window, up, and no taller than the room above", () => {
    // A 330 px tall window, the switcher in the footer row near the bottom: 290 px above, 2 px below.
    const list = openAt({ top: 290, bottom: 328 }, 330);
    expect(list.className).toContain("bottom-full");
    expect(list.style.maxHeight).toBe("282px");
  });

  it("near the top (the menu), down as before, at its usual height", () => {
    const list = openAt({ top: 10, bottom: 40 }, 800);
    expect(list.className).not.toContain("bottom-full");
    expect(list.style.maxHeight).toBe("288px");
  });
});
