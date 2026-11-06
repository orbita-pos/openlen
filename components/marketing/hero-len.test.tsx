// What the PERSON is doing in the hero's box (spec local 2026-11-06-portada-solo-input): the home's light rises only
// with it. The face's own state also lights up for things nobody does — the box typing its own examples (`ghost`) and
// the sign-in dialog after sending (`sent`) — so it can't be the light's signal. Same harness as hero-kind-picker.test.tsx.
import { afterEach, describe, expect, it } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import { HeroLenProvider, personActive, useHeroLenPersonActive, useHeroLenReport, type Signals } from "./hero-len";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base: Signals = { focused: false, hasText: false, listening: false, sent: false, ghost: false };

describe("personActive", () => {
  it("nothing, nobody", () => expect(personActive(base)).toBe(false));
  it("🔴 the box typing its own examples is not the person", () => expect(personActive({ ...base, ghost: true })).toBe(false));
  it("🔴 the sign-in dialog open after sending is not the person typing", () => expect(personActive({ ...base, sent: true })).toBe(false));
  // Final review, 06/11: sending with Enter keeps the box focused and full while the sign-in dialog is open.
  it("🔴 sent with Enter (box still focused, with text) is not typing either", () =>
    expect(personActive({ ...base, focused: true, hasText: true, sent: true })).toBe(false));
  it("focus without text is not typing", () => expect(personActive({ ...base, focused: true })).toBe(false));
  it("focus with text is", () => expect(personActive({ ...base, focused: true, hasText: true })).toBe(true));
  it("dictating is", () => expect(personActive({ ...base, listening: true })).toBe(true));
});

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});
function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

let reportNow: (patch: Partial<Signals>) => void = () => {};
function Reporter() {
  const report = useHeroLenReport();
  useEffect(() => {
    reportNow = report;
  }, [report]);
  return null;
}
function Reader() {
  return <span id="active">{String(useHeroLenPersonActive())}</span>;
}

describe("useHeroLenPersonActive", () => {
  it("follows what the box reports", () => {
    const host = mount(
      <HeroLenProvider>
        <Reporter />
        <Reader />
      </HeroLenProvider>,
    );
    const read = () => host.querySelector("#active")?.textContent;
    expect(read()).toBe("false");
    act(() => reportNow({ focused: true, hasText: true }));
    expect(read()).toBe("true");
    act(() => reportNow({ focused: false }));
    expect(read()).toBe("false");
  });

  it("is false outside any provider", () => {
    const host = mount(<Reader />);
    expect(host.querySelector("#active")?.textContent).toBe("false");
  });
});
