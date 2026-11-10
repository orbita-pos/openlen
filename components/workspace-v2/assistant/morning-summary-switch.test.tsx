// THE MORNING SUMMARY'S SWITCH IN HER PLACE (spec local 2026-11-06-asistente-propio, §6.9, phase 4D).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string) => clave,
  useLocale: () => "es",
}));

import { MorningSummarySwitch } from "./morning-summary-switch";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ morningSummary: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

describe("MorningSummarySwitch", () => {
  it("her place's switch PATCHes it with the page's language", async () => {
    const host = mount(<MorningSummarySwitch assistantId="a1" initial={false} />);
    const sw = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await act(async () => sw.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/assistants/a1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ morningSummary: true, locale: "es" }) }));
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toContain("ownAssistant.summary.hint");
  });

  it("a failed save puts it back", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const host = mount(<MorningSummarySwitch assistantId="a1" initial={false} />);
    const sw = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(async () => sw.click());
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });
});
