// A TOOL ON THE PHONE (spec local 2026-11-04-herramientas-hechas-por-len, §4.14, §4.4): full screen, on the phone's own
// private host, with the app as its bridge's parent — the web's own bridge host, fed by the app's client — and what has
// an effect outside the tool drawn by the app and pressed by the person.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("use-intl", () => ({ useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k) }));
vi.mock("../viewer/phone-viewer", () => ({ PhoneViewer: ({ file }: { file: { name: string; url: string } }) => <div data-viewer={file.name} data-url={file.url} /> }));

import { WORKSPACE_TOOL_THEME } from "@/lib/tools/bridge/workspace-theme";

import { PantallaHerramienta } from "./tool-screen";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORIGIN = "https://lienzo-0123456789abcdef0123456789abcdef.openlen.app";
const TOOL = {
  id: "i1",
  projectId: "t1",
  title: "Reservas",
  description: "Hoy",
  placement: "rail" as const,
  iconUrl: "/api/tools/i1/icon",
  iconTinted: true,
  frameUrl: null,
  frameOrigin: null,
  releaseSha: "sha1",
  enabled: true,
  installedAt: "2026-11-05T10:00:00Z",
  status: "ok" as const,
};
const JOB = { id: "job-1", name: "export", title: "Exportar", status: "running", progress: null, detail: null, result: null, delivered: [], startedAt: "2026-11-05T10:00:00Z", finishedAt: null, seconds: 0, chargedCentis: 0 };
const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}), channel: "openlen-tool" });
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

type Routes = Record<string, (init?: RequestInit) => Response>;
function client(over: Routes = {}) {
  const routes: Routes = {
    "POST /api/movil/tools/i1/open": () => Response.json({ url: `${ORIGIN}/?v=sha1`, origin: ORIGIN }),
    "POST /api/tools/data-change": () => Response.json({ status: "applied", row: { id: 12 } }),
    "GET /api/tools/jobs/declared": () => Response.json({ job: { name: "export", title: "Exportar", maxMinutes: 10, mostCentis: 332 } }),
    "POST /api/tools/jobs": () => Response.json({ job: JOB }),
    "GET /api/tools/jobs": () => Response.json({ jobs: [] }),
    "GET /api/tools/jobs/job-1": () => Response.json({ job: JOB }),
    "POST /api/tools/uploads": () => Response.json({ uploads: [{ id: "up-1", name: "a.pdf", size: 1, contentType: "application/pdf" }] }),
    "POST /api/tools/deliver": () => Response.json({ url: "/api/projects/t1/deliveries/x/ab-r.pdf" }),
    "POST /api/tools/bridge": () => Response.json({ jsonrpc: "2.0", id: 1, result: [], channel: "openlen-tool" }),
    ...over,
  };
  const calls: string[] = [];
  const pedir = vi.fn(async (ruta: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${new URL(ruta, "https://openlen.com").pathname}`;
    calls.push(key);
    return (routes[key] ?? (() => new Response("{}", { status: 404 })))(init);
  });
  return { cliente: { pedir, avisarAlCerrar: vi.fn() }, calls };
}

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  document.documentElement.dataset.theme = "light";
});
afterEach(async () => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  await flush();
});

async function paint(o: { over?: Routes; proyecto?: { id: string; title: string } | null; onPrompt?: ((d: string) => void) | null; onCerrar?: () => void } = {}) {
  const c = client(o.over);
  const onCerrar = o.onCerrar ?? vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <PantallaHerramienta cliente={c.cliente} tool={TOOL} persona={{ name: "Ana" }} proyecto={o.proyecto ?? null} idioma="es" onCerrar={onCerrar} onPrompt={o.onPrompt ?? null} />,
    );
    await flush();
  });
  const iframe = document.querySelector<HTMLIFrameElement>("iframe[data-herr-marco]");
  const posted = iframe ? vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => {}) : null;
  const ask = async (data: unknown, origin = ORIGIN) =>
    act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data, origin, source: iframe!.contentWindow }));
      await flush();
    });
  const answers = () => (posted?.mock.calls ?? []).map((x) => x[0] as Record<string, unknown>);
  const click = async (sel: string) =>
    act(async () => {
      document.querySelector<HTMLElement>(sel)!.click();
      await flush();
    });
  return { ...c, iframe, ask, answers, click, onCerrar };
}

describe("PantallaHerramienta", () => {
  it("opens the tool on the phone's own host, isolated like the canvas", async () => {
    const s = await paint();
    expect(s.calls[0]).toBe("POST /api/movil/tools/i1/open");
    expect(s.iframe?.getAttribute("src")).toBe(`${ORIGIN}/?v=sha1`);
    expect(s.iframe?.getAttribute("sandbox")).toContain("allow-scripts");
  });

  it("context: the person, the project, the installed version and the workspace's colours in the phone's mode", async () => {
    document.documentElement.dataset.theme = "dark";
    const s = await paint({ proyecto: { id: "p1", title: "Café" } });
    await s.ask(rpc(1, "context"));
    expect(s.answers()[0]).toMatchObject({
      id: 1,
      result: {
        person: { name: "Ana", locale: "es" },
        project: { id: "p1", title: "Café" },
        tool: { id: "i1", version: "sha1" },
        environment: "installed",
        theme: { mode: "dark", tokens: expect.objectContaining({ "--bg": WORKSPACE_TOOL_THEME.dark["--bg"] }) },
      },
    });
  });

  it("a message from another origin is not answered", async () => {
    const s = await paint();
    await s.ask(rpc(1, "context"), "https://evil.example");
    expect(s.answers()).toEqual([]);
  });

  it("update: the app's sheet shows the change; «Aplicar» writes it, with the app's client", async () => {
    const s = await paint();
    const p = s.ask(rpc(2, "update", { projectId: "p1", table: "reservas", key: { id: 12 }, set: { estado: "confirmada" }, before: { estado: "pendiente" } }));
    await p;
    const sheet = document.querySelector("[data-herr-cambio]");
    expect(sheet?.textContent).toContain("reservas");
    expect(sheet?.textContent).toContain("pendiente");
    expect(sheet?.textContent).toContain("confirmada");
    await s.click("[data-herr-aplicar]");
    expect(s.calls).toContain("POST /api/tools/data-change");
    expect(s.answers().at(-1)).toMatchObject({ id: 2, result: { status: "applied" } });
    expect(document.querySelector("[data-herr-cambio]")).toBeNull();
  });

  it("update: «Cancelar» declines, nothing is written", async () => {
    const s = await paint();
    await s.ask(rpc(2, "update", { projectId: "p1", table: "reservas", key: { id: 12 }, set: { estado: "x" }, before: { estado: "y" } }));
    await s.click("[data-herr-cancelar]");
    expect(s.calls).not.toContain("POST /api/tools/data-change");
    expect(s.answers().at(-1)).toMatchObject({ id: 2, result: { status: "declined" } });
  });

  it("jobs.run: the sheet shows the declaration's numbers; «Ejecutar» starts it and its line shows with «Detener»", async () => {
    const s = await paint();
    await s.ask(rpc(3, "jobs.run", { name: "export" }));
    const sheet = document.querySelector("[data-herr-trabajo]");
    expect(sheet?.textContent).toContain('"minutes":10');
    expect(sheet?.textContent).toContain('"credits":"3,32"');
    await s.click("[data-herr-ejecutar]");
    expect(s.calls).toContain("POST /api/tools/jobs");
    expect(s.answers().at(-1)).toMatchObject({ id: 3, result: { status: "started" } });
    expect(document.querySelector("[data-herr-linea] [data-herr-detener]")).not.toBeNull();
  });

  it("files.pick: the app's sheet, the person's files, uploaded with the app's client", async () => {
    const s = await paint();
    await s.ask(rpc(4, "files.pick", { multiple: true }));
    const input = document.querySelector<HTMLInputElement>("[data-herr-ficheros] input[type=file]")!;
    Object.defineProperty(input, "files", { value: [new File(["x"], "a.pdf")] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
    });
    await s.click("[data-herr-usar]");
    expect(s.calls).toContain("POST /api/tools/uploads");
    expect(s.answers().at(-1)).toMatchObject({ id: 4, result: [{ id: "up-1" }] });
  });

  it("sendPrompt: unavailable in a rail tool; in a project tool, the quoted draft goes to the composer and the screen closes", async () => {
    const rail = await paint();
    await rail.ask(rpc(5, "sendPrompt", { text: "Confirma a Ana" }));
    expect(rail.answers().at(-1)).toMatchObject({ id: 5, result: { status: "unavailable" } });
    act(() => root!.unmount());
    root = null;

    const onPrompt = vi.fn();
    const s = await paint({ proyecto: { id: "p1", title: "Café" }, onPrompt });
    await s.ask(rpc(6, "sendPrompt", { text: "Confirma a Ana" }));
    expect(onPrompt).toHaveBeenCalledWith("> Confirma a Ana\n\n— Reservas\n");
    expect(s.onCerrar).toHaveBeenCalled();
  });

  it("files.deliver: the app's viewer opens what was delivered", async () => {
    const s = await paint();
    await s.ask(rpc(7, "files.deliver", { name: "r.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) }));
    expect(document.querySelector("[data-viewer]")?.getAttribute("data-url")).toBe("/api/projects/t1/deliveries/x/ab-r.pdf");
  });

  it("🔴 Review Focus 1: the back button with a sheet open closes the sheet (declined), not the screen", async () => {
    const s = await paint();
    await s.ask(rpc(8, "update", { projectId: "p1", table: "reservas", key: { id: 1 }, set: { a: 1 }, before: { a: 2 } }));
    expect(document.querySelector("[data-herr-cambio]")).not.toBeNull();
    await act(async () => {
      history.back();
      await new Promise((r) => setTimeout(r, 20));
      await flush();
    });
    expect(document.querySelector("[data-herr-cambio]")).toBeNull();
    expect(s.answers().at(-1)).toMatchObject({ id: 8, result: { status: "declined" } });
    expect(s.onCerrar).not.toHaveBeenCalled();
  });

  it("🔴 Review Focus 2: a bridge call answering 401 closes the screen", async () => {
    const s = await paint({ over: { "POST /api/tools/bridge": () => new Response("{}", { status: 401 }) } });
    await s.ask(rpc(9, "projects"));
    expect(s.onCerrar).toHaveBeenCalled();
  });

  it("🔴 Review Focus 4: an open the server doesn't answer offers «Reintentar», which asks again", async () => {
    let tries = 0;
    await paint({
      over: {
        "POST /api/movil/tools/i1/open": () => (++tries === 1 ? new Response("Not found", { status: 404 }) : Response.json({ url: `${ORIGIN}/?v=sha1`, origin: ORIGIN })),
      },
    });
    expect(document.body.textContent).toContain("noAbre");
    expect(document.querySelector("iframe")).toBeNull();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-herr-reintentar]")!.click();
      await flush();
    });
    expect(document.querySelector("iframe[data-herr-marco]")).not.toBeNull();
  });

  it("🔴 Review Focus 5: switching the phone's theme sends the tool its context again", async () => {
    const s = await paint();
    await act(async () => {
      document.documentElement.dataset.theme = "dark";
      await flush();
    });
    expect(s.answers().at(-1)).toMatchObject({ method: "context", params: { theme: { mode: "dark" } } });
  });
});
