// HER TAB IN LEN MÓVIL (spec local 2026-11-06-asistente-propio, §4.6.3, §4.6.2, phase 5): «Hablar con {name}» (her chat
// itself is the main screen's, over the tab — final review I1), «Conversaciones» and «Pedidos» as her place on the web.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k) }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
vi.mock("../api/asistente", () => ({ leerSusVisitas: vi.fn(), leerSusPedidos: vi.fn(), tocarPedido: vi.fn(), marcarSusVisitasLeidas: vi.fn(), figurasEncendidas: vi.fn(async () => false) }));

import { leerSusPedidos, leerSusVisitas, marcarSusVisitasLeidas, tocarPedido } from "../api/asistente";
import { AssistantTab } from "./assistant-tab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LUCIA = { id: "a1", name: "Lucía", slug: "lucia", look: { v: 1, shape: "drop", color: "#f4a48b", eyes: "oval", eyewear: "none", accessory: "none" } as const, color: "#f4a48b", tone: "friendly" as const, projectId: "p1", projectIds: ["p1"] };
const line = (role: string, text: string, i: number) => ({ role, text, at: `2026-11-09T10:0${i}:00Z` });
const VISIT = { id: "v1", projectId: "p1", projectTitle: "Panadería", startedAt: "2026-11-09T10:00:00Z", lastAt: "2026-11-09T10:05:00Z", messageCount: 6, handedOff: false, lines: [line("visitor", "Hola", 0), line("visitor", "Mi teléfono es 55 1234 5678", 1), line("assistant", "Gracias", 2), line("visitor", "¿Abren hoy?", 3), line("assistant", "Sí, hasta las 7", 4), line("visitor", "¿Tienen pan sin gluten?", 5)] };
const CARD = { id: "c1", projectId: "p2", title: "Envíos a domicilio", visitors: 3, status: "pending", failure: null, projectTitle: "Tienda" };

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

async function paint(o: { parte?: "hablar" | "conversaciones" | "pedidos"; tarjeta?: string | null; cards?: unknown[]; onHablar?: () => void; onVerLen?: (projectId: string) => void } = {}) {
  vi.mocked(leerSusVisitas).mockResolvedValue([VISIT] as never);
  vi.mocked(leerSusPedidos).mockResolvedValue((o.cards ?? [CARD]) as never);
  vi.mocked(tocarPedido).mockResolvedValue({ ok: true });
  vi.mocked(marcarSusVisitasLeidas).mockResolvedValue(true);
  Element.prototype.scrollIntoView = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(<AssistantTab cliente={{} as never} asistente={LUCIA} idioma="es" onCerrar={() => {}} onHablar={o.onHablar ?? (() => {})} onVerLen={o.onVerLen ?? (() => {})} parte={o.parte} tarjeta={o.tarjeta} />),
  );
  await act(async () => {});
  return host;
}
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());

// Phase 6 (spec local 2026-11-10-figuras-del-asistente, §5.8): her figure in the header, from the catalog.
describe("AssistantTab wears her figure", () => {
  it("🔴 her header holds her figure — flat while the figures are off — on a tint of her color, and the dot is gone", async () => {
    const host = await paint();
    const header = host.querySelector<HTMLElement>(".asist-cabecera")!;
    expect(header.querySelectorAll("[data-figure]")).toHaveLength(1);
    expect(header.querySelector("[data-figure]")!.getAttribute("data-figure")).toBe("flat");
    expect(header.querySelector('[data-part="body"]')).not.toBeNull();
    expect(header.style.getPropertyValue("--asist-suave")).toMatch(/^#[0-9a-f]{6}$/);
    expect(host.querySelector(".asist-figura")).toBeNull();
    expect(header.textContent).toContain("Lucía");
  });

  it("one opened by a notice of an assistant deleted since still draws: the default figure", async () => {
    vi.mocked(leerSusVisitas).mockResolvedValue([] as never);
    vi.mocked(leerSusPedidos).mockResolvedValue([] as never);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    const gone = { id: "x", name: "", slug: "", color: "transparent", tone: "friendly" as const, projectId: "", projectIds: [] } as never;
    await act(async () => root.render(<AssistantTab cliente={{} as never} asistente={gone} idioma="es" onCerrar={() => {}} onHablar={() => {}} onVerLen={() => {}} />));
    expect(host.querySelector('.asist-cabecera [data-part="body"]')).not.toBeNull();
  });
});

describe("AssistantTab marks what it shows as read (phase 4E)", () => {
  it("🔴 marks them read when «Conversaciones» is on screen, once", async () => {
    await paint();
    expect(marcarSusVisitasLeidas).toHaveBeenCalledTimes(1);
    expect(vi.mocked(marcarSusVisitasLeidas).mock.calls[0]!.slice(1)).toEqual(["a1", [{ id: "v1", lastAt: "2026-11-09T10:05:00Z" }]]);
  });

  it("🔴 not when the tab opens on «Pedidos» or under her chat; tapping «Conversaciones» marks them", async () => {
    const host = await paint({ parte: "pedidos" });
    expect(marcarSusVisitasLeidas).not.toHaveBeenCalled();
    await click(host.querySelector('[data-asistente-parte="conversaciones"]'));
    expect(marcarSusVisitasLeidas).toHaveBeenCalledTimes(1);
    vi.mocked(marcarSusVisitasLeidas).mockClear();
    const under = await paint({ parte: "hablar" });
    expect(marcarSusVisitasLeidas).not.toHaveBeenCalled();
    await click(under.querySelector('[data-asistente-parte="conversaciones"]'));
    expect(marcarSusVisitasLeidas).toHaveBeenCalledTimes(1);
  });
});

describe("AssistantTab", () => {
  it("🔴 «Hablar con» asks the main screen to open her chat; the tab holds no chat of its own", async () => {
    const onHablar = vi.fn();
    const host = await paint({ onHablar });
    await click(host.querySelector("[data-asistente-hablar]"));
    expect(onHablar).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".lm-chat")).toBeNull();
  });

  it("🔴 every line of a conversation, with who said it and when, as on the web", async () => {
    const host = await paint();
    expect(host.textContent).toContain("Mi teléfono es 55 1234 5678");
    expect(host.querySelectorAll("[data-visita-linea]")).toHaveLength(6);
    expect(host.querySelector("[data-visita-linea] .asist-sr")?.textContent).toContain("own.place.visitor");
    expect(host.querySelector("time")?.getAttribute("dateTime")).toBe("2026-11-09T10:05:00Z");
  });

  it("her requests, pending first, as on the web", async () => {
    const done = { ...CARD, id: "c0", title: "Galletas", status: "accepted" };
    const host = await paint({ parte: "pedidos", cards: [done, CARD] });
    expect([...host.querySelectorAll("[data-pedido]")].map((x) => x.getAttribute("data-pedido"))).toEqual(["c1", "c0"]);
    expect(host.textContent).toContain('own.requests.visitors {"count":3}');
  });

  it("🔴 pressing a request does it, as on the web, and reads them again", async () => {
    const host = await paint({ parte: "pedidos" });
    await click(host.querySelector("[data-pedido-hazlo]"));
    expect(tocarPedido).toHaveBeenCalledWith(expect.anything(), "a1", "c1", "accept");
    expect(leerSusPedidos).toHaveBeenCalledTimes(2);
  });

  it("🔴 a press the server refuses says so", async () => {
    const host = await paint({ parte: "pedidos" });
    vi.mocked(tocarPedido).mockResolvedValueOnce({ ok: false, error: "not_pending" });
    await click(host.querySelector("[data-pedido-hazlo]"));
    expect(host.querySelector('[data-pedido="c1"] [role="alert"]')?.textContent).toBe("own.requests.failed");
  });

  it("🔴 a request Len couldn't start says why, as on the web", async () => {
    const host = await paint({ parte: "pedidos", cards: [{ ...CARD, failure: "no_credits" }] });
    expect(host.querySelector('[data-pedido="c1"] [role="alert"]')?.textContent).toBe("own.requests.noCredits");
  });

  it("🔴 a request passed to Len offers to see Len in the chat of its project", async () => {
    const onVerLen = vi.fn();
    const host = await paint({ parte: "pedidos", cards: [{ ...CARD, status: "accepted" }], onVerLen });
    await click(host.querySelector("[data-pedido-ver-len]"));
    expect(onVerLen).toHaveBeenCalledWith("p2");
  });

  it("🔴 a request notice's card is highlighted and brought into view", async () => {
    const host = await paint({ parte: "pedidos", tarjeta: "c1" });
    expect(host.querySelector('[data-pedido="c1"]')?.getAttribute("data-resaltado")).toBe("true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("an assistant that no longer exists says so", async () => {
    vi.mocked(leerSusVisitas).mockRejectedValue(new Error("404"));
    vi.mocked(leerSusPedidos).mockRejectedValue(new Error("404"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<AssistantTab cliente={{} as never} asistente={LUCIA} idioma="es" onCerrar={() => {}} onHablar={() => {}} onVerLen={() => {}} />));
    await act(async () => {});
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("noEsta");
  });

  // Opened by a notice of one deleted since, there is no name to say (principal.tsx's stub): «Tu asistente ya no está».
  it("🔴 one deleted since, with no name to say, is «your assistant»", async () => {
    vi.mocked(leerSusVisitas).mockRejectedValue(new Error("404"));
    vi.mocked(leerSusPedidos).mockRejectedValue(new Error("404"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<AssistantTab cliente={{} as never} asistente={{ ...LUCIA, name: "" }} idioma="es" onCerrar={() => {}} onHablar={() => {}} onVerLen={() => {}} />));
    await act(async () => {});
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('noEsta {"name":"own.place.yours"}');
  });
});
