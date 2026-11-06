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
const transit = vi.hoisted(() => ({ left: [] as File[][], dropped: 0 }));
const usage = vi.hoisted(() => ({ events: [] as [string, unknown][] }));
vi.mock("@/lib/uso/cliente", () => ({
  registrarUso: (name: string, data: unknown) => void usage.events.push([name, data]),
}));
vi.mock("@/lib/marketing/files-in-transit", () => ({
  leaveFilesInTransit: async (files: readonly File[]) => {
    transit.left.push([...files]);
    return true;
  },
  dropFilesInTransit: async () => {
    transit.dropped += 1;
  },
}));

import { HeroPromptInput } from "./hero-prompt-input";
import { HomeDropZone } from "./home-drop";
import { takeFirstMessage } from "@/lib/marketing/first-message-in-transit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BRIEF = "Una página para mi panadería, con pedidos por WhatsApp";

const roots: Root[] = [];
beforeEach(() => {
  push.mockReset();
  status = "authenticated";
  transit.left.length = 0;
  transit.dropped = 0;
  usage.events.length = 0;
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
  sessionStorage.clear();
});

function mount({ tools = false }: { tools?: boolean } = {}) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(<HeroPromptInput tools={tools} />));
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
// Sending waits for the files to be left in IndexedDB before going: the press, then its promise.
const press = async (b: HTMLElement) => {
  await act(async () => {
    b.click();
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("the home's box", () => {
  it("🔴 is the same box as /new's: the shared PromptBox, in the home's colours", () => {
    const el = mount();
    expect(el.querySelector('[data-prompt-box="portada"]')).not.toBeNull();
    expect(el.querySelector('[data-prompt-box="portada"] #hero-prompt')).not.toBeNull();
  });

  it("🔴 signed in, sending leaves the ticket /new sends on arrival, and goes to /new with the brief", async () => {
    const el = mount();
    type(el, BRIEF);
    await press(sendButton(el));
    expect(push).toHaveBeenCalledWith(`/new?brief=${encodeURIComponent(BRIEF)}`);
    expect(takeFirstMessage(BRIEF)).toEqual({ brief: BRIEF, kind: "pagina" });
  });

  it("🔴 Enter sends too", async () => {
    const el = mount();
    type(el, BRIEF);
    const ta = el.querySelector<HTMLTextAreaElement>("#hero-prompt")!;
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(takeFirstMessage(BRIEF)).not.toBeNull();
  });

  it("🔴 signed out, the ticket waits through the sign-in dialog", async () => {
    status = "unauthenticated";
    const el = mount();
    type(el, BRIEF);
    await press(sendButton(el));
    expect(push).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(takeFirstMessage(BRIEF)).toEqual({ brief: BRIEF, kind: "pagina" });
  });

  it("🔴 closing the sign-in dialog drops the ticket and its files: the visitor cancelled", async () => {
    status = "unauthenticated";
    const el = mount();
    type(el, BRIEF);
    await press(sendButton(el));
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="signInDialog.close"]')!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(takeFirstMessage(BRIEF)).toBeNull();
    expect(transit.dropped).toBe(1);
  });

  it("does not send a brief too short to send", async () => {
    const el = mount();
    type(el, "hola");
    await press(sendButton(el));
    expect(push).not.toHaveBeenCalled();
    expect(takeFirstMessage("hola")).toBeNull();
  });
});

// Jesús, 06/11: «en el select del input, cuando estoy en /new aparece Tools y en / no aparece». The home's pill offers
// Herramienta as /new's does — whenever tools are on —, locked with /new's own line until the plan is known to be paid.
describe("Herramienta in the home's pill", () => {
  const openPill = (el: HTMLElement) =>
    act(() => [...el.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')].find((b) => b.textContent?.includes("start.kind.page"))!.click());
  const toolOption = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((b) => b.textContent?.includes("start.kind.tool"));
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const usage = (plan: string) =>
    vi.fn(async (url: string) => (url === "/api/usage" ? { ok: true, json: async () => ({ plan }) } : { ok: false, json: async () => null }));

  it("with tools off, it isn't offered", () => {
    const el = mount();
    openPill(el);
    expect(toolOption(el)).toBeUndefined();
  });

  it("🔴 signed out, it is offered and locked, with the paid-plan line — and the visitor costs no request", () => {
    status = "unauthenticated";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const el = mount({ tools: true });
    openPill(el);
    const tool = toolOption(el)!;
    expect(tool.disabled).toBe(true);
    expect(tool.textContent).toContain("tools.planRequired");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("🔴 on Free it stays locked; on a paid plan it can be chosen and the box says what a tool is", async () => {
    vi.stubGlobal("fetch", usage("free"));
    const free = mount({ tools: true });
    await flush();
    openPill(free);
    expect(toolOption(free)!.disabled).toBe(true);

    vi.stubGlobal("fetch", usage("pro"));
    const pro = mount({ tools: true });
    await flush();
    openPill(pro);
    const tool = toolOption(pro)!;
    expect(tool.disabled).toBe(false);
    expect(tool.textContent).toContain("start.kind.toolHint");
    act(() => tool.click());
    expect(pro.querySelector<HTMLTextAreaElement>("#hero-prompt")!.getAttribute("placeholder")).toBe("start.kind.toolPlaceholder");
    vi.unstubAllGlobals();
  });
});

// Jesús, 06/11: «el input de /new tiene attach files y el de / no; sólo debe haber un input y debe ser el que tenga
// todo». The home's box has what /new's has: files in the `+`, dropped anywhere on the home, «Pegar HTML» for a page,
// and URLs painted blue.
describe("the home's box has everything /new's has", () => {
  const plusMenu = (el: HTMLElement) => {
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="newChat.composer.plus"]')!.click());
    return [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((b) => b.querySelector("b")?.textContent);
  };
  const pdf = () => new File(["%PDF-1.4"], "menu.pdf", { type: "application/pdf" });
  const pickFile = (el: HTMLElement, file: File) => {
    const input = [...el.querySelectorAll<HTMLInputElement>('input[type="file"]')].find((i) => !i.accept.startsWith("image/"))!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => void input.dispatchEvent(new Event("change", { bubbles: true })));
  };

  it("🔴 the `+` offers photos, files and «Pegar HTML», like /new's; with App chosen, no HTML to paste", () => {
    const el = mount();
    expect(plusMenu(el)).toEqual(["heroPrompt.attachImages", "composer.attachFile", "start.pasteTitle"]);
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="newChat.composer.plus"]')!.click());
    act(() => [...el.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')].find((b) => b.textContent?.includes("start.kind.page"))!.click());
    act(() => [...el.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((b) => b.textContent?.includes("start.kind.appHint"))!.click());
    expect(plusMenu(el)).toEqual(["heroPrompt.attachImages", "composer.attachFile"]);
  });

  it("🔴 «Pegar HTML» opens /new's paste flow — after signing in, without an account", () => {
    const el = mount();
    plusMenu(el);
    act(() => [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.includes("start.pasteTitle"))!.click());
    expect(push).toHaveBeenCalledWith("/new?mode=paste");

    status = "unauthenticated";
    const out = mount();
    plusMenu(out);
    act(() => [...out.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.includes("start.pasteTitle"))!.click());
    expect(push).toHaveBeenLastCalledWith(`/login?next=${encodeURIComponent("/new?mode=paste")}`);
  });

  it("🔴 a file picked goes in as a chip, and sending leaves it for /new before going", async () => {
    const el = mount();
    const file = pdf();
    pickFile(el, file);
    expect(el.querySelector('[data-prompt-box] [title="menu.pdf"]')).not.toBeNull();
    type(el, BRIEF);
    await press(sendButton(el));
    expect(transit.left.at(-1)).toEqual([file]);
    expect(push).toHaveBeenCalledWith(`/new?brief=${encodeURIComponent(BRIEF)}`);
  });

  it("🔴 a file dropped anywhere on the home goes into the box", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() =>
      root.render(
        <HomeDropZone className="zone">
          <p data-elsewhere>somewhere else on the home</p>
          <HeroPromptInput />
        </HomeDropZone>,
      ),
    );
    const elsewhere = host.querySelector("[data-elsewhere]")!;
    const drag = (type: string, files: File[] = []) => {
      const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
      e.dataTransfer = { types: ["Files"], files, dropEffect: "none" };
      act(() => void elsewhere.dispatchEvent(e));
    };
    drag("dragenter");
    expect(host.textContent).toContain("composer.dropHere");
    drag("drop", [pdf()]);
    expect(host.querySelector('[data-prompt-box] [title="menu.pdf"]')).not.toBeNull();
    expect(host.textContent).not.toContain("composer.dropHere");
  });

  it("🔴 a URL turns blue as it's written, as in /new", () => {
    const el = mount();
    type(el, "Como https://example.com pero para mi panadería");
    const link = el.querySelector("[data-link-copy] [data-link]");
    expect(link?.textContent).toBe("https://example.com");
    const painted = el.querySelector<HTMLTextAreaElement>("#hero-prompt")!.className;
    expect(painted).toContain("text-transparent");
    // Seen in the browser on 06/11: the skin's `dark:text-zinc-100` on the textarea outranks `text-transparent` and
    // covered the blue copy. With a link, the textarea carries no text colour of its own; the copy does.
    expect(painted).not.toMatch(/(^|\s)(dark:)?text-zinc-/);
    expect(el.querySelector("[data-link-copy]")!.className).toContain("dark:text-zinc-100");
    type(el, "Sin enlaces ya");
    expect(el.querySelector("[data-link-copy]")).toBeNull();
    expect(el.querySelector<HTMLTextAreaElement>("#hero-prompt")!.className).toContain("dark:text-zinc-100");
  });
});

// Jesús, 06/11: «¿para qué tener 2 inputs?». /new's box is gone: what it did, this one does — a ✕ takes a file off, a
// URL is never fetched, the create funnel counts here, and a link that carried a brief or a kind to /new fills this
// box instead.
describe("the only box", () => {
  const pdf = () => new File(["%PDF-1.4"], "menu.pdf", { type: "application/pdf" });

  it("🔴 a file's ✕ takes it off, and what an earlier send left for /new with it", () => {
    const el = mount();
    const input = [...el.querySelectorAll<HTMLInputElement>('input[type="file"]')].find((i) => !i.accept.startsWith("image/"))!;
    Object.defineProperty(input, "files", { value: [pdf()], configurable: true });
    act(() => void input.dispatchEvent(new Event("change", { bubbles: true })));
    const dropped = transit.dropped;
    act(() => el.querySelector<HTMLButtonElement>('[title="menu.pdf"] button[aria-label="composer.removeFile"]')!.click());
    expect(el.querySelector('[title="menu.pdf"]')).toBeNull();
    expect(transit.dropped).toBe(dropped + 1);
  });

  it("🔴 a URL in the text is not fetched and puts no chip above it", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    try {
      const el = mount();
      type(el, "hazme una como https://linear.app pero para mi estudio de tatuajes");
      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(el.querySelector('[title="linear.app"]')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("🔴 signed in, the create funnel counts here: seen, wrote once, sent with how many images — never the text", async () => {
    const el = mount();
    expect(usage.events).toContainEqual(["crear_vista", {}]);
    type(el, BRIEF);
    type(el, `${BRIEF} con fotos`);
    expect(usage.events.filter(([n]) => n === "crear_escribio")).toHaveLength(1);
    await press(sendButton(el));
    expect(usage.events).toContainEqual(["crear_envio", { imagenes: 0 }]);
    expect(JSON.stringify(usage.events)).not.toContain("panadería");
  });

  it("signed out, nothing is counted: /api/uso would drop it anyway", async () => {
    status = "unauthenticated";
    const el = mount();
    type(el, BRIEF);
    await press(sendButton(el));
    expect(usage.events).toEqual([]);
  });

  it("🔴 a link that carried a brief and a kind fills the box — never sends — and leaves the address clean", () => {
    window.history.replaceState(null, "", `/?brief=${encodeURIComponent(BRIEF)}&kind=app`);
    const el = mount();
    expect(el.querySelector<HTMLTextAreaElement>("#hero-prompt")!.value).toBe(BRIEF);
    expect(el.querySelector('button[aria-haspopup="menu"][aria-label$="start.kind.app"]')).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });
});
