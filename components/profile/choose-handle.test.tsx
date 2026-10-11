// @vitest-environment jsdom
//
// /me SIN @: la ventana del @ de siempre (HandleDialog llama a onSaved Y LUEGO a
// onClose). 🔴 Al guardar se va al perfil nuevo, no a /new.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: m.replace }) }));

import ChooseHandle from "./choose-handle";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

describe("elegir el @ desde «Tu perfil»", () => {
  it("🔴 al guardar va a /@<handle>, una sola vez", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, handle: "ana" }) })) as unknown as typeof fetch;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(<ChooseHandle />));
    const input = host.querySelector("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "ana");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...host.querySelectorAll("button")].find((b) => b.textContent === "Save")!;
    await act(async () => save.click());
    expect(m.replace).toHaveBeenCalledTimes(1);
    expect(m.replace).toHaveBeenCalledWith("/@ana");
  });
});
