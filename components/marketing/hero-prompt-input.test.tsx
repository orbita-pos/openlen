// @vitest-environment jsdom
// The home's box (Jesús, 06/11: «dos inputs así es duplicación»): pressing send here IS the send. It leaves the
// one-use ticket that /new sends on arrival, goes to /new with the brief (which still fills the box there if the
// storage is blocked), and, signed out, keeps the ticket through the sign-in dialog — unless the visitor closes it.
// Same manual react-dom + act() harness as the other marketing tests.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const push = vi.fn();
let status: "authenticated" | "unauthenticated" | "loading" = "authenticated";

vi.mock("next-intl", () => {
  const t = (key: string) => key;
  (t as unknown as { raw: (k: string) => unknown }).raw = () => [];
  (t as unknown as { rich: (k: string) => unknown }).rich = (k: string) => k;
  return { useTranslations: () => t, useLocale: () => "es" };
});
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status }) }));
vi.mock("@/components/workspace-v2/use-games-available", () => ({ useGamesAvailable: () => false }));

import { HeroPromptInput } from "./hero-prompt-input";
import { takeFirstMessage } from "@/lib/marketing/first-message-in-transit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BRIEF = "Una página para mi panadería, con pedidos por WhatsApp";

const roots: Root[] = [];
beforeEach(() => {
  push.mockReset();
  status = "authenticated";
});
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  sessionStorage.clear();
});

function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(<HeroPromptInput />));
  return el;
}

function type(el: HTMLElement, text: string) {
  const ta = el.querySelector<HTMLTextAreaElement>("#hero-prompt")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const sendButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button[aria-label="heroPrompt.generate"]')!;

describe("the home's box", () => {
  it("🔴 is the same box as /new's: the shared PromptBox, in the home's colours", () => {
    const el = mount();
    expect(el.querySelector('[data-prompt-box="portada"]')).not.toBeNull();
    expect(el.querySelector('[data-prompt-box="portada"] #hero-prompt')).not.toBeNull();
  });

  it("🔴 signed in, sending leaves the ticket /new sends on arrival, and goes to /new with the brief", () => {
    const el = mount();
    type(el, BRIEF);
    act(() => sendButton(el).click());
    expect(push).toHaveBeenCalledWith(`/new?brief=${encodeURIComponent(BRIEF)}`);
    expect(takeFirstMessage(BRIEF)).toEqual({ brief: BRIEF, kind: "pagina" });
  });

  it("🔴 Enter sends too", () => {
    const el = mount();
    type(el, BRIEF);
    const ta = el.querySelector<HTMLTextAreaElement>("#hero-prompt")!;
    act(() => {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(takeFirstMessage(BRIEF)).not.toBeNull();
  });

  it("🔴 signed out, the ticket waits through the sign-in dialog", () => {
    status = "unauthenticated";
    const el = mount();
    type(el, BRIEF);
    act(() => sendButton(el).click());
    expect(push).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(takeFirstMessage(BRIEF)).toEqual({ brief: BRIEF, kind: "pagina" });
  });

  it("🔴 closing the sign-in dialog drops the ticket: the visitor cancelled", () => {
    status = "unauthenticated";
    const el = mount();
    type(el, BRIEF);
    act(() => sendButton(el).click());
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="signInDialog.close"]')!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(takeFirstMessage(BRIEF)).toBeNull();
  });

  it("does not send a brief too short to send", () => {
    const el = mount();
    type(el, "hola");
    act(() => sendButton(el).click());
    expect(push).not.toHaveBeenCalled();
    expect(takeFirstMessage("hola")).toBeNull();
  });
});
