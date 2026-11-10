// HER TAB IN LEN MÓVIL (spec local 2026-11-06-asistente-propio, §4.6.3, §4.6.2, phase 5): the three parts of her place
// on the web — Hablar (the phone's own chat, talking to her), Conversaciones and Pedidos —, and where her notices land.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k) }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
vi.mock("../api/asistente", () => ({ leerSuChat: vi.fn(), leerSusVisitas: vi.fn(), leerSusPedidos: vi.fn(), tocarPedido: vi.fn() }));
const chat = vi.hoisted(() => ({ opciones: null as Record<string, unknown> | null, props: null as Record<string, unknown> | null }));
vi.mock("../chat/use-chat", () => ({ useChat: (o: Record<string, unknown>) => ((chat.opciones = o), { trabajando: false }) }));
vi.mock("../chat/chat", () => ({ PantallaChat: (p: Record<string, unknown>) => ((chat.props = p), <div data-chat-abierto={String(p.abierto)} />) }));

import { leerSuChat, leerSusPedidos, leerSusVisitas, tocarPedido } from "../api/asistente";
import { AssistantTab } from "./assistant-tab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LUCIA = { id: "a1", name: "Lucía", slug: "lucia", shape: "blob" as const, color: "#F4A48B", tone: "friendly" as const, projectId: "p1", projectIds: ["p1"] };
const VISIT = { id: "v1", projectId: "p1", projectTitle: "Panadería", startedAt: "2026-11-09T10:00:00Z", lastAt: "2026-11-09T10:01:00Z", messageCount: 2, handedOff: false, lines: [{ role: "visitor", text: "¿Tienen pan sin gluten?", at: "2026-11-09T10:00:00Z" }] };
const CARD = { id: "c1", title: "Envíos a domicilio", visitors: 3, status: "pending", projectTitle: "Panadería" };

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
  chat.opciones = chat.props = null;
});

async function paint(o: { parte?: "hablar" | "conversaciones" | "pedidos"; tarjeta?: string | null } = {}) {
  vi.mocked(leerSuChat).mockResolvedValue([{ id: "t1" }] as never);
  vi.mocked(leerSusVisitas).mockResolvedValue([VISIT] as never);
  vi.mocked(leerSusPedidos).mockResolvedValue([CARD] as never);
  vi.mocked(tocarPedido).mockResolvedValue({ ok: true });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<AssistantTab cliente={{} as never} base="https://openlen.com" asistente={LUCIA} idioma="es" onCerrar={() => {}} {...o} />));
  await act(async () => {});
  return host;
}
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());

describe("AssistantTab", () => {
  it("🔴 talks to her: her chat loads first and every message carries her id", async () => {
    const host = await paint();
    expect(chat.opciones).toMatchObject({ projectId: "p1", assistantId: "a1", historial: [{ id: "t1" }] });
    expect(host.querySelector("[data-chat-abierto]")?.getAttribute("data-chat-abierto")).toBe("false");
    await click(host.querySelector("[data-asistente-hablar]"));
    expect(host.querySelector("[data-chat-abierto]")?.getAttribute("data-chat-abierto")).toBe("true");
    expect(chat.props).toMatchObject({ projectId: "p1", asistente: { name: "Lucía", color: "#F4A48B" } });
  });

  it("her conversations and her requests, as on the web", async () => {
    const host = await paint();
    expect(host.textContent).toContain("¿Tienen pan sin gluten?");
    await click(host.querySelector('[data-asistente-parte="pedidos"]'));
    expect(host.textContent).toContain("Envíos a domicilio");
    expect(host.textContent).toContain('own.requests.visitors {"count":3}');
  });

  it("🔴 pressing a request does it, as on the web, and reads them again", async () => {
    const host = await paint({ parte: "pedidos" });
    await click(host.querySelector("[data-pedido-hazlo]"));
    expect(tocarPedido).toHaveBeenCalledWith(expect.anything(), "a1", "c1", "accept");
    expect(leerSusPedidos).toHaveBeenCalledTimes(2);
  });

  it("🔴 a request notice's card is highlighted", async () => {
    const host = await paint({ parte: "pedidos", tarjeta: "c1" });
    expect(host.querySelector('[data-pedido="c1"]')?.getAttribute("data-resaltado")).toBe("true");
  });

  it("her turn's notice opens her chat", async () => {
    const host = await paint({ parte: "hablar" });
    expect(host.querySelector("[data-chat-abierto]")?.getAttribute("data-chat-abierto")).toBe("true");
  });

  it("an assistant that no longer exists says so", async () => {
    vi.mocked(leerSuChat).mockRejectedValueOnce(new Error("404"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    vi.mocked(leerSusVisitas).mockRejectedValue(new Error("404"));
    vi.mocked(leerSusPedidos).mockRejectedValue(new Error("404"));
    await act(async () => root.render(<AssistantTab cliente={{} as never} base="b" asistente={LUCIA} idioma="es" onCerrar={() => {}} />));
    await act(async () => {});
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("noEsta");
  });

  // Opened by a notice of one deleted since, there is no name to say (principal.tsx's stub): «Tu asistente ya no está».
  it("🔴 one deleted since, with no name to say, is «your assistant»", async () => {
    vi.mocked(leerSuChat).mockRejectedValue(new Error("404"));
    vi.mocked(leerSusVisitas).mockRejectedValue(new Error("404"));
    vi.mocked(leerSusPedidos).mockRejectedValue(new Error("404"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<AssistantTab cliente={{} as never} base="b" asistente={{ ...LUCIA, name: "" }} idioma="es" onCerrar={() => {}} />));
    await act(async () => {});
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('noEsta {"name":"own.place.yours"}');
  });
});
