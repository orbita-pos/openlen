// @vitest-environment jsdom
// /new sends what the home sent (Jesús, 06/11: «dos inputs así es duplicación»): once the blank project is open, the
// home's ticket becomes the first message to Len — once, and only for the brief the tab arrived with. Same manual
// react-dom + act() harness as the marketing tests.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { leaveFirstMessage } from "@/lib/marketing/first-message-in-transit";
import { useFirstMessageOnArrival } from "./use-first-message-on-arrival";
import type { FirstMessage } from "@/lib/marketing/first-message-in-transit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BRIEF = "Una tienda de bicicletas con reservas de taller";

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  sessionStorage.clear();
});

function Probe(props: { arrivalBrief: string | null; ready: boolean; send: (m: FirstMessage) => void }) {
  useFirstMessageOnArrival(props);
  return null;
}

function mount(props: { arrivalBrief: string | null; ready: boolean; send: (m: FirstMessage) => void }) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(<Probe {...props} />));
  return (next: typeof props) => act(() => root.render(<Probe {...next} />));
}

describe("/new on arrival from the home", () => {
  it("🔴 sends the home's message once the blank project is open, not before", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "app" });
    const send = vi.fn();
    const rerender = mount({ arrivalBrief: BRIEF, ready: false, send });
    expect(send).not.toHaveBeenCalled();
    rerender({ arrivalBrief: BRIEF, ready: true, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ brief: BRIEF, kind: "app" });
  });

  it("🔴 sends it once, even if the page renders again or another blank project opens", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "pagina" });
    const send = vi.fn();
    const rerender = mount({ arrivalBrief: BRIEF, ready: true, send });
    rerender({ arrivalBrief: BRIEF, ready: false, send });
    leaveFirstMessage({ brief: BRIEF, kind: "pagina" });
    rerender({ arrivalBrief: BRIEF, ready: true, send });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("🔴 a ?brief= link from elsewhere, with no ticket from the home, only fills: nothing is sent", () => {
    const send = vi.fn();
    mount({ arrivalBrief: BRIEF, ready: true, send });
    expect(send).not.toHaveBeenCalled();
  });
});
