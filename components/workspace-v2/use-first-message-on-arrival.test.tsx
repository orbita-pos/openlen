// @vitest-environment jsdom
// /new sends what the home sent (Jesús, 06/11: «dos inputs así es duplicación»): once the blank project is open, the
// home's ticket becomes the first message to Len — once, and only for the brief the tab arrived with. And since /new
// has no box of its own (Jesús, 06/11: «¿para qué tener 2 inputs?»), with nothing to send it goes back to the home's.
// Same manual react-dom + act() harness as the marketing tests.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { hasFirstMessage, leaveFirstMessage } from "@/lib/marketing/first-message-in-transit";
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

type Props = { arrivalBrief: string | null; ready: boolean; send: (m: FirstMessage) => void; onNothing: () => void };

function Probe(props: Props) {
  useFirstMessageOnArrival(props);
  return null;
}

function mount(props: Props) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(<Probe {...props} />));
  return (next: Props) => act(() => root.render(<Probe {...next} />));
}

describe("/new on arrival from the home", () => {
  it("🔴 sends the home's message once the blank project is open, not before", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "app" });
    const send = vi.fn();
    const onNothing = vi.fn();
    const rerender = mount({ arrivalBrief: BRIEF, ready: false, send, onNothing });
    expect(send).not.toHaveBeenCalled();
    rerender({ arrivalBrief: BRIEF, ready: true, send, onNothing });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ brief: BRIEF, kind: "app" });
    expect(onNothing).not.toHaveBeenCalled();
  });

  it("🔴 sends it once, even if the page renders again or another blank project opens", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "pagina" });
    const send = vi.fn();
    const onNothing = vi.fn();
    const rerender = mount({ arrivalBrief: BRIEF, ready: true, send, onNothing });
    rerender({ arrivalBrief: BRIEF, ready: false, send, onNothing });
    leaveFirstMessage({ brief: BRIEF, kind: "pagina" });
    rerender({ arrivalBrief: BRIEF, ready: true, send, onNothing });
    expect(send).toHaveBeenCalledTimes(1);
    expect(onNothing).not.toHaveBeenCalled();
  });

  it("🔴 nothing the home sent (a ?brief= link from elsewhere, a reload): nothing is sent, and back to the home's box", () => {
    const send = vi.fn();
    const onNothing = vi.fn();
    mount({ arrivalBrief: BRIEF, ready: true, send, onNothing });
    expect(send).not.toHaveBeenCalled();
    expect(onNothing).toHaveBeenCalledTimes(1);
  });
});

describe("whether /new arrives with something to send", () => {
  it("🔴 says so WITHOUT spending the ticket — /new looks before opening a blank project, and sends after", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "pagina" });
    expect(hasFirstMessage(BRIEF)).toBe(true);
    expect(hasFirstMessage(BRIEF)).toBe(true);
    expect(hasFirstMessage("Otro brief distinto que no es el del pase")).toBe(false);
    expect(hasFirstMessage(null)).toBe(false);
    const send = vi.fn();
    mount({ arrivalBrief: BRIEF, ready: true, send, onNothing: vi.fn() });
    expect(send).toHaveBeenCalledTimes(1);
    expect(hasFirstMessage(BRIEF)).toBe(false);
  });

  it("a stale ticket is nothing to send", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "pagina" }, 0);
    expect(hasFirstMessage(BRIEF, 31 * 60_000)).toBe(false);
  });
});
