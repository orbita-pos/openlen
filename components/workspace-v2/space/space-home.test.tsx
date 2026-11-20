// @vitest-environment jsdom
// THE PERSON'S SPACE (spec local 2026-11-19-agentes-para-todos, §6.2–6.3): a view of Len's chat only, where the home's
// Agente arrives. The home's one-use ticket is sent once; anything else only fills the box.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => router,
}));
vi.mock("../toast", () => ({ ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
// Len's chat panel is a mark that says what it was given.
vi.mock("../chat/new-chat-panel", () => ({
  NewChatPanel: (p: { flatProjectId: string; pendingDraft?: string | null; pendingDraftAutoSend?: boolean; centered?: boolean; flatProjectChat?: unknown[]; disclaimer?: string }) => (
    <i
      data-chat={p.flatProjectId}
      data-draft={p.pendingDraft ?? ""}
      data-auto={String(Boolean(p.pendingDraftAutoSend))}
      data-centered={String(Boolean(p.centered))}
      data-turns={String(p.flatProjectChat?.length ?? 0)}
      data-disclaimer={p.disclaimer ?? ""}
    />
  ),
}));

import { leaveFirstMessage, takeFirstMessage } from "@/lib/marketing/first-message-in-transit";

import { SpaceHome } from "./space-home";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BRIEF = "Quiero un profesor de inglés";
const roots: Root[] = [];
beforeEach(() => {
  window.history.replaceState(null, "", "/es/space");
  router.replace.mockReset();
});
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  sessionStorage.clear();
});

function mount(props: { arrivalBrief?: string | null; draft?: string | null }) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(<SpaceHome projectId="space-1" initialChat={[]} arrivalBrief={props.arrivalBrief ?? null} draft={props.draft ?? null} />));
  return el;
}
const chat = (el: HTMLElement) => el.querySelector<HTMLElement>("[data-chat]")!;

describe("the space", () => {
  it("is Len's chat in the space, in the middle, with the way home", () => {
    const el = mount({});
    expect(chat(el).dataset.chat).toBe("space-1");
    expect(chat(el).dataset.centered).toBe("true");
    expect(chat(el).dataset.draft).toBe("");
    expect(el.querySelector<HTMLAnchorElement>("[data-space-home]")!.getAttribute("href")).toBe("/");
    // Nothing to clean from a bare address.
    expect(router.replace).not.toHaveBeenCalled();
  });

  // Walked with a real turn (20/11): the line under the box spoke of a page to publish, and the space has none.
  it("🔴 the line under Len's box is the space's, not a page's", () => {
    const el = mount({});
    expect(chat(el).dataset.disclaimer).toBe("space.disclaimer");
  });

  it("🔴 sends the home's ticket once, as the person's own send, and spends it", () => {
    window.history.replaceState(null, "", `/es/space?brief=${encodeURIComponent(BRIEF)}`);
    leaveFirstMessage({ brief: BRIEF, kind: "agent" });
    const el = mount({ arrivalBrief: BRIEF });
    expect(chat(el).dataset.draft).toBe(BRIEF);
    expect(chat(el).dataset.auto).toBe("true");
    expect(takeFirstMessage(BRIEF)).toBeNull();
    // The address loses it through the router, so a refresh after the turn doesn't bring it back (walked 20/11), and a
    // reload doesn't write it again.
    expect(router.replace).toHaveBeenCalledWith("/space", { scroll: false });
  });

  it("🔴 without the ticket — a link from elsewhere, a reload — the brief only fills the box", () => {
    const el = mount({ arrivalBrief: BRIEF });
    expect(chat(el).dataset.draft).toBe(BRIEF);
    expect(chat(el).dataset.auto).toBe("false");
  });

  it("🔴 a ticket for a page is not sent from here", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "pagina" });
    const el = mount({ arrivalBrief: BRIEF });
    expect(chat(el).dataset.auto).toBe("false");
  });

  it("a draft («Cambiar a…») fills without sending, and leaves the address", () => {
    window.history.replaceState(null, "", "/es/space?draft=Cambiar%20a%20Coach");
    const el = mount({ draft: "Cambiar a Coach" });
    expect(chat(el).dataset.draft).toBe("Cambiar a Coach");
    expect(chat(el).dataset.auto).toBe("false");
    expect(router.replace).toHaveBeenCalledWith("/space", { scroll: false });
  });
});
