// Opening a delivered HTML or SVG to look at it (spec local 2026-10-31-len-movil, §5.1): it runs on the
// canvas host, never here; anything else is downloaded from the deliveries route as before.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn() }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: vi.fn() }));
vi.mock("@/lib/agent/skills/deliveries", () => ({ deliveryStore: vi.fn() }));
vi.mock("@/lib/lienzo/host", () => ({ lienzoApagado: vi.fn(() => false) }));
vi.mock("@/lib/lienzo/open-delivered", () => ({ openDeliveredHtml: vi.fn() }));

import { deliveryStore } from "@/lib/agent/skills/deliveries";
import { lienzoApagado } from "@/lib/lienzo/host";
import { openDeliveredHtml } from "@/lib/lienzo/open-delivered";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";
import { POST } from "./route";

const files = new Map<string, Uint8Array>([
  ["deliveries/p1/t-1/ab12cd34-panel.html", new TextEncoder().encode("<h1>Panel</h1>")],
  ["deliveries/p1/t-1/ab12cd34-chart.svg", new TextEncoder().encode("<svg></svg>")],
  ["deliveries/p1/t-1/ab12cd34-a.pdf", new TextEncoder().encode("%PDF-")],
]);
const post = (file: string) =>
  POST(new Request(`http://localhost:3000/api/projects/p1/deliveries/t-1/${file}/view`, { method: "POST", headers: { host: "localhost:3000", origin: "https://localhost" } }), {
    params: Promise.resolve({ id: "p1", turn: "t-1", file }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usuarioDeLaPeticion).mockResolvedValue("ana");
  vi.mocked(exigirAcceso).mockResolvedValue({ rol: "lector", duenoId: "dueno-1" });
  vi.mocked(deliveryStore).mockReturnValue({ put: vi.fn(), get: vi.fn(async (k: string) => files.get(k) ?? null) });
  vi.mocked(lienzoApagado).mockReturnValue(false);
  vi.mocked(openDeliveredHtml).mockReturnValue({ ok: true, url: "http://lz-abc.localhost:3000/?__lienzo=d1" });
});

describe("POST /api/projects/[id]/deliveries/[turn]/[file]/view", () => {
  it("opens a delivered HTML on the canvas host, for whoever can see the project", async () => {
    const res = await post("ab12cd34-panel.html");
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toBe("http://lz-abc.localhost:3000/?__lienzo=d1");
    expect(url).not.toContain("/api/");
    expect(exigirAcceso).toHaveBeenCalledWith("p1", "ana", "ver");
    expect(openDeliveredHtml).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", personId: "ana", html: "<h1>Panel</h1>", svg: false, requestHost: "localhost:3000" }));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });

  it("an SVG is opened as a page", async () => {
    await post("ab12cd34-chart.svg");
    expect(openDeliveredHtml).toHaveBeenCalledWith(expect.objectContaining({ html: "<svg></svg>", svg: true }));
  });

  it("anything else is not for this route", async () => {
    const res = await post("ab12cd34-a.pdf");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_html" });
  });

  it("a file that isn't there is 404", async () => {
    expect((await post("ab12cd34-nada.html")).status).toBe(404);
  });

  it("with no canvas host it is 503", async () => {
    vi.mocked(lienzoApagado).mockReturnValue(true);
    expect((await post("ab12cd34-panel.html")).status).toBe(503);
  });

  it("someone outside the project gets the access refusal", async () => {
    vi.mocked(exigirAcceso).mockResolvedValue(new Response(null, { status: 404 }));
    expect((await post("ab12cd34-panel.html")).status).toBe(404);
    expect(openDeliveredHtml).not.toHaveBeenCalled();
  });

  it("without a person it is 401", async () => {
    vi.mocked(usuarioDeLaPeticion).mockResolvedValue(null);
    expect((await post("ab12cd34-panel.html")).status).toBe(401);
  });
});
