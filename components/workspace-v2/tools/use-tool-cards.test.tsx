// THE CHAT'S «CREAR» CARDS (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): one store per page, fed by the
// stream's `tool_card` and by GET /api/tool-cards — on load, every 60 s, every 5 s while one is creating or installing,
// and when a turn ends. A press posts the verb with the person's language and zone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useLocale: () => "es" }));

import type { ToolCardView } from "@/lib/tools/cards/types";

import { pressToolCard, toolCardsLive, useToolCards } from "./use-tool-cards";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  toolCardsLive.forget();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const card = (over: Partial<ToolCardView> = {}): ToolCardView => ({
  id: "card-1",
  chatRowId: "row-1",
  title: "Reservas de hoy",
  brief: "Ver las reservas del día.",
  initialContent: null,
  placement: "rail",
  customLocation: null,
  phase: "proposed",
  toolProjectId: null,
  installationId: null,
  error: null,
  review: null,
  ...over,
});
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

function Probe({ busy }: { busy: boolean }) {
  useToolCards("p1", busy);
  return null;
}
function mount(busy = false) {
  const host = document.createElement("div");
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<Probe busy={busy} />));
  return (b: boolean) => act(() => root.render(<Probe busy={b} />));
}
const gets = () => fetchMock.mock.calls.filter(([, init]) => !(init as RequestInit | undefined)?.method).length;

describe("useToolCards", () => {
  it("loads the project's cards and the cap", async () => {
    fetchMock.mockResolvedValue(json({ cards: [card()], capCredits: 25 }));
    mount();
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith("/api/tool-cards?projectId=p1");
    expect(toolCardsLive.of("p1", "row-1").map((c) => c.id)).toEqual(["card-1"]);
    expect(toolCardsLive.capCredits()).toBe(25);
  });

  it("every 60 s; every 5 s while one is creating", async () => {
    fetchMock.mockResolvedValue(json({ cards: [card()], capCredits: 25 }));
    mount();
    await act(async () => {});
    const first = gets();
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(gets()).toBe(first);
    await act(async () => vi.advanceTimersByTime(55_000));
    expect(gets()).toBe(first + 1);
    fetchMock.mockResolvedValue(json({ cards: [card({ phase: "creating" })], capCredits: 25 }));
    await act(async () => vi.advanceTimersByTime(60_000));
    const busyFrom = gets();
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(gets()).toBe(busyFrom + 1);
  });

  it("when a turn ends, it looks again", async () => {
    fetchMock.mockResolvedValue(json({ cards: [], capCredits: 25 }));
    const rerender = mount(true);
    await act(async () => {});
    const before = gets();
    rerender(false);
    await act(async () => {});
    expect(gets()).toBe(before + 1);
  });
});

describe("pressToolCard", () => {
  it("posts the verb with the person's language and zone, and puts a settled card in the store", async () => {
    fetchMock.mockResolvedValue(json({ status: "settled", card: card({ phase: "dismissed" }) }));
    const r = await pressToolCard("p1", "card-1", "dismiss", { placement: "rail" }, { locale: "es", timeZone: "Europe/Madrid" });
    expect(r).toEqual({ status: "settled", card: expect.objectContaining({ phase: "dismissed" }) });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/tool-cards/card-1");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ verb: "dismiss", payload: { placement: "rail" }, locale: "es", timeZone: "Europe/Madrid" });
    expect(toolCardsLive.of("p1", "row-1")[0]!.phase).toBe("dismissed");
  });

  it("a refusal comes back with its reason; a network failure as «network»", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: "refused", reason: "plan_required" }, 402));
    expect(await pressToolCard("p1", "card-1", "create", {}, { locale: "es", timeZone: "UTC" })).toEqual({ status: "refused", reason: "plan_required" });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await pressToolCard("p1", "card-1", "create", {}, { locale: "es", timeZone: "UTC" })).toEqual({ status: "refused", reason: "network" });
  });
});

describe("🔴 I3: a card that installs or uninstalls in the background tells the installed-tools list", () => {
  it("creating → installed, and installed → removed, each announce once; nothing else does", () => {
    const heard = vi.fn();
    window.addEventListener("openlen:tools-changed", heard);
    toolCardsLive.event("p1", card({ phase: "creating" }));
    toolCardsLive.fromServer("p1", [card({ phase: "creating" })]);
    expect(heard).not.toHaveBeenCalled();
    toolCardsLive.fromServer("p1", [card({ phase: "installed", installationId: "inst-1" })]);
    expect(heard).toHaveBeenCalledTimes(1);
    toolCardsLive.fromServer("p1", [card({ phase: "installed", installationId: "inst-1" })]);
    expect(heard).toHaveBeenCalledTimes(1);
    toolCardsLive.fromServer("p1", [card({ phase: "removed", installationId: "inst-1" })]);
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener("openlen:tools-changed", heard);
  });

  it("a card first seen already installed (a reload) announces nothing", () => {
    const heard = vi.fn();
    window.addEventListener("openlen:tools-changed", heard);
    toolCardsLive.fromServer("p1", [card({ phase: "installed", installationId: "inst-1" })]);
    expect(heard).not.toHaveBeenCalled();
    window.removeEventListener("openlen:tools-changed", heard);
  });
});

describe("the balance hears what the creator spent in the background", () => {
  it("a card leaving creating (the creator settled and was charged) asks the balance to refresh, once", () => {
    const heard = vi.fn();
    window.addEventListener("openlen:credits-changed", heard);
    toolCardsLive.event("p1", card({ phase: "proposed" }));
    toolCardsLive.fromServer("p1", [card({ phase: "creating" })]);
    expect(heard).not.toHaveBeenCalled();
    toolCardsLive.fromServer("p1", [card({ phase: "installing" })]);
    expect(heard).toHaveBeenCalledTimes(1);
    toolCardsLive.fromServer("p1", [card({ phase: "installed", installationId: "inst-1" })]);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener("openlen:credits-changed", heard);
  });
});

describe("toolCardsLive.event", () => {
  it("a stream card is sanitized: one without an id or a known phase is dropped", () => {
    toolCardsLive.event("p1", { ...card(), phase: "exploded" });
    toolCardsLive.event("p1", { ...card(), id: 7 });
    expect(toolCardsLive.of("p1", "row-1")).toEqual([]);
    toolCardsLive.event("p1", card());
    expect(toolCardsLive.of("p1", "row-1")).toHaveLength(1);
  });
});
