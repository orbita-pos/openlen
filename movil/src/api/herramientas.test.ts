// The phone's calls for the person's tools (spec local 2026-11-04-herramientas-hechas-por-len, §4.14): the list, the
// frame of one, and its icon — fetched with the key, because an <img> can't carry it.
import { afterEach, describe, expect, it, vi } from "vitest";

import { abrirHerramienta, iconoDeHerramienta, listarHerramientas } from "./herramientas";

const tool = { id: "i1", projectId: "t1", title: "Reservas", description: "Hoy", placement: "rail", iconUrl: "/api/tools/i1/icon?v=sha1", iconTinted: true, frameUrl: "x", frameOrigin: "x", releaseSha: "sha1", enabled: true, installedAt: "2026-11-05T10:00:00Z", status: "ok" };
const cliente = (respuesta: (ruta: string, init?: RequestInit) => Response) => {
  const pedir = vi.fn(async (ruta: string, init?: RequestInit) => respuesta(ruta, init));
  return { pedir, avisarAlCerrar: vi.fn() };
};

afterEach(() => vi.unstubAllGlobals());

describe("listarHerramientas", () => {
  it("asks in the phone's language and gives the tools, the plan and the person", async () => {
    const c = cliente(() => Response.json({ tools: [tool], paid: true, person: { name: "Ana" }, suggestions: { available: true, on: false } }));
    expect(await listarHerramientas(c, "es")).toEqual({ tools: [tool], paid: true, person: { name: "Ana" } });
    expect(c.pedir).toHaveBeenCalledWith("/api/tools?locale=es");
  });

  it("tools switched off on the server: \"off\"", async () => {
    expect(await listarHerramientas(cliente(() => Response.json({ error: "tools_off" }, { status: 404 })), "es")).toBe("off");
  });

  it("any other failure throws, so the tab can offer «Reintentar»", async () => {
    await expect(listarHerramientas(cliente(() => new Response("x", { status: 500 })), "es")).rejects.toThrow();
  });

  it("an answer without a list of tools (an older server) is an empty list", async () => {
    expect(await listarHerramientas(cliente(() => Response.json({ project: {} })), "es")).toEqual({ tools: [], paid: false, person: { name: "" } });
  });
});

describe("abrirHerramienta", () => {
  it("POSTs to the phone's open route and gives the frame", async () => {
    const c = cliente(() => Response.json({ url: "https://lienzo-a.openlen.app/?v=sha1", origin: "https://lienzo-a.openlen.app" }));
    expect(await abrirHerramienta(c, "i1")).toEqual({ url: "https://lienzo-a.openlen.app/?v=sha1", origin: "https://lienzo-a.openlen.app" });
    expect(c.pedir).toHaveBeenCalledWith("/api/movil/tools/i1/open", { method: "POST" });
  });

  it("a refusal or an older server without the route: its error", async () => {
    expect(await abrirHerramienta(cliente(() => Response.json({ error: "plan_required" }, { status: 402 })), "i1")).toEqual({ error: "plan_required" });
    expect(await abrirHerramienta(cliente(() => new Response("Not found", { status: 404 })), "i1")).toEqual({ error: "404" });
  });
});

describe("iconoDeHerramienta", () => {
  it("fetches the icon with the key and gives an object URL", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:icono") }));
    const c = cliente(() => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }));
    expect(await iconoDeHerramienta(c, tool as never)).toBe("blob:icono");
    expect(c.pedir).toHaveBeenCalledWith("/api/tools/i1/icon?v=sha1");
  });

  it("no icon: null", async () => {
    expect(await iconoDeHerramienta(cliente(() => new Response("x", { status: 404 })), tool as never)).toBeNull();
  });
});
