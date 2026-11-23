// AN AGENT'S TOOLS ON THE PHONE (spec local 2026-11-22-herramienta-dentro-del-agente, §2, §4): header button only when
// the agent has tools, opens full screen on the phone's own label (`POST /api/movil/agent-tools/[id]/open`, never the
// list's workspace frameUrl), streams live changes with fetch reader + crearLectorSse (reconnecting for a fresh
// baseline on drop; stopping and removing only on `gone`), restricted bridge, `sendPrompt` fills composer without
// sending, and remove asks confirmation then calls DELETE.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("use-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k),
}));

import { BRIDGE_CHANNEL, METHOD_NOT_FOUND } from "@/lib/tools/bridge/protocol";

import { PantallaChat } from "../chat/chat";
import type { Chat } from "../chat/use-chat";
import { PantallaHerramientaDeAgente } from "./agent-tools";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WORKSPACE_ORIGIN = "https://lienzo-web.openlen.app";
const PHONE_ORIGIN = "https://lienzo-phone.openlen.app";
const ENCODER = new TextEncoder();

function sseStream() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return {
    response: new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    push(event: string, data: unknown) {
      ctrl.enqueue(ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    end() {
      ctrl.close();
    },
  };
}

function makeChat(): Chat {
  return {
    elementos: [],
    trabajando: false,
    estado: "libre",
    aviso: null,
    mandar: vi.fn(),
    mandarNota: vi.fn(),
    dirigir: vi.fn(),
    parar: vi.fn(),
    reintentar: vi.fn(),
    refrescar: vi.fn(),
    visualState: vi.fn(),
  } as unknown as Chat;
}

const rpc = (id: number, method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params !== undefined ? { params } : {}),
  channel: BRIDGE_CHANNEL,
});

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

const roots: Root[] = [];
function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

beforeEach(() => {
  document.documentElement.dataset.theme = "light";
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("mobile agent tools", () => {
  it("shows the header button in the agent's chat ONLY when the agent has tools", async () => {
    const withTools = {
      pedir: vi.fn(async (ruta: string) =>
        ruta === "/api/agent-tools?assistantId=a1"
          ? Response.json([{ id: "t1", slug: "recorrido", title: "Recorrido", frameUrl: `${WORKSPACE_ORIGIN}/?v=1`, frameOrigin: WORKSPACE_ORIGIN }])
          : Response.json({}),
      ),
      avisarAlCerrar: vi.fn(),
    };
    const host1 = mount(
      <PantallaChat
        abierto
        chat={makeChat()}
        cliente={withTools}
        projectId="space-1"
        idioma="es"
        conPip={false}
        onCerrar={vi.fn()}
        onLlamar={vi.fn()}
        asistente={{ id: "a1", name: "Ana", color: "#19c3b1" }}
      />,
    );
    await act(flush);
    expect(host1.querySelector("[data-agent-tools-btn]")).not.toBeNull();

    // Empty list -> no button.
    const empty = {
      pedir: vi.fn(async () => Response.json([])),
      avisarAlCerrar: vi.fn(),
    };
    const host2 = mount(
      <PantallaChat
        abierto
        chat={makeChat()}
        cliente={empty}
        projectId="space-1"
        idioma="es"
        conPip={false}
        onCerrar={vi.fn()}
        onLlamar={vi.fn()}
        asistente={{ id: "a1", name: "Ana", color: "#19c3b1" }}
      />,
    );
    await act(flush);
    expect(host2.querySelector("[data-agent-tools-btn]")).toBeNull();

    // Len's chat (no asistente) -> never fetches or shows agent tools button.
    const lenClient = {
      pedir: vi.fn(async () => Response.json([])),
      avisarAlCerrar: vi.fn(),
    };
    const host3 = mount(
      <PantallaChat abierto chat={makeChat()} cliente={lenClient} projectId="p1" idioma="es" conPip={false} onCerrar={vi.fn()} onLlamar={vi.fn()} />,
    );
    await act(flush);
    expect(host3.querySelector("[data-agent-tools-btn]")).toBeNull();
    expect(lenClient.pedir.mock.calls.some(([r]) => String(r).includes("/api/agent-tools"))).toBe(false);
  });

  it("opens on the phone URL from POST /api/movil/agent-tools/[id]/open, restricts methods, streams changes, reconnects on drop, and stops on gone", async () => {
    vi.useFakeTimers();
    const s1 = sseStream();
    const s2 = sseStream();
    let followCount = 0;
    const calls: string[] = [];

    const cliente = {
      pedir: vi.fn(async (ruta: string, init?: RequestInit) => {
        const key = `${init?.method ?? "GET"} ${ruta}`;
        calls.push(key);
        if (key === "POST /api/movil/agent-tools/t1/open") {
          return Response.json({ url: `${PHONE_ORIGIN}/?v=sha1`, origin: PHONE_ORIGIN });
        }
        if (key === "GET /api/agent-tools/t1/follow") {
          followCount += 1;
          return followCount === 1 ? s1.response : s2.response;
        }
        return Response.json({});
      }),
      avisarAlCerrar: vi.fn(),
    };

    const onCerrar = vi.fn();
    const onPrompt = vi.fn();
    const onRemoved = vi.fn();
    mount(
      <PantallaHerramientaDeAgente
        cliente={cliente}
        tool={{ id: "t1", slug: "recorrido", title: "Recorrido" }}
        idioma="es"
        onCerrar={onCerrar}
        onPrompt={onPrompt}
        onRemoved={onRemoved}
      />,
    );
    await act(flush);

    expect(calls[0]).toBe("POST /api/movil/agent-tools/t1/open");
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-agent-tool-frame="t1"]')!;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("src")).toBe(`${PHONE_ORIGIN}/?v=sha1`);

    const posted: unknown[] = [];
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation((msg) => posted.push(msg));

    // Method outside AGENT_TOOL_BRIDGE_METHODS is refused.
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { origin: PHONE_ORIGIN, source: iframe.contentWindow, data: rpc(1, "projects") }));
      await flush();
    });
    expect(posted.at(-1)).toMatchObject({ id: 1, error: { code: METHOD_NOT_FOUND } });

    // data.subscribe answers { ok: true } immediately and opens the fetch follow stream.
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { origin: PHONE_ORIGIN, source: iframe.contentWindow, data: rpc(2, "data.subscribe") }));
      await flush();
    });
    expect(posted.at(-1)).toMatchObject({ id: 2, result: { ok: true } });
    expect(followCount).toBe(1);

    // Baseline and change arrive and are forwarded untouched.
    const baseline1 = { kind: "baseline", docs: [] };
    const change1 = {
      kind: "change",
      by: "agent",
      docs: [{ collection: "lessons", docId: "3", data: { unlocked: true }, updatedAt: "2026-11-22T12:00:00Z", updatedBy: "agent" }],
      deleted: [],
    };
    await act(async () => {
      s1.push("baseline", baseline1);
      s1.push("change", change1);
      await flush();
    });
    expect(posted.at(-2)).toMatchObject({ method: "data.changed", params: baseline1 });
    expect(posted.at(-1)).toMatchObject({ method: "data.changed", params: change1 });

    // Stream ends -> reconnects after backoff and replays the fresh baseline!
    await act(async () => {
      s1.end();
      await flush();
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await flush();
    });
    expect(followCount).toBe(2);
    const baseline2 = { kind: "baseline", docs: change1.docs };
    await act(async () => {
      s2.push("baseline", baseline2);
      await flush();
    });
    expect(posted.at(-1)).toMatchObject({ method: "data.changed", params: baseline2 });

    // `gone` stops reconnecting, calls onRemoved and closes the screen.
    await act(async () => {
      s2.push("gone", {});
      await flush();
    });
    expect(onRemoved).toHaveBeenCalledWith("t1");
    expect(onCerrar).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await flush();
    });
    expect(followCount).toBe(2);
  });

  it("sendPrompt fills the chat draft without sending, and remove confirms before calling DELETE", async () => {
    const deletes: string[] = [];
    const chat = makeChat();
    const cliente = {
      pedir: vi.fn(async (ruta: string, init?: RequestInit) => {
        if (ruta === "/api/agent-tools?assistantId=a1") {
          return Response.json([{ id: "t1", slug: "recorrido", title: "Recorrido", frameUrl: `${WORKSPACE_ORIGIN}/?v=1`, frameOrigin: WORKSPACE_ORIGIN }]);
        }
        if (ruta === "/api/movil/agent-tools/t1/open" && init?.method === "POST") {
          return Response.json({ url: `${PHONE_ORIGIN}/?v=sha1`, origin: PHONE_ORIGIN });
        }
        if (ruta === "/api/agent-tools/t1" && init?.method === "DELETE") {
          deletes.push(ruta);
          return Response.json({ ok: true });
        }
        return Response.json({});
      }),
      avisarAlCerrar: vi.fn(),
    };

    const host = mount(
      <PantallaChat
        abierto
        chat={chat}
        cliente={cliente}
        projectId="space-1"
        idioma="es"
        conPip={false}
        onCerrar={vi.fn()}
        onLlamar={vi.fn()}
        asistente={{ id: "a1", name: "Ana", color: "#19c3b1" }}
      />,
    );
    await act(flush);

    // Open tool from header button (single tool opens directly).
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-agent-tools-btn]")!.click();
      await flush();
    });
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-agent-tool-frame="t1"]')!;
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => {});

    // sendPrompt fills the composer without sending and closes the tool screen.
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { origin: PHONE_ORIGIN, source: iframe.contentWindow, data: rpc(5, "sendPrompt", { text: "Revísame la lección 3" }) }));
      await flush();
    });
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Revísame la lección 3");
    expect(chat.mandar).not.toHaveBeenCalled();
    expect(document.querySelector('iframe[data-agent-tool-frame="t1"]')).toBeNull();

    // Open again and remove with confirmation.
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-agent-tools-btn]")!.click();
      await flush();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-agent-tool-remove]")!.click();
      await flush();
    });
    expect(deletes).toEqual([]);
    const sheet = document.querySelector<HTMLElement>("[data-agent-tool-confirm-sheet]")!;
    expect(sheet).not.toBeNull();
    expect(sheet.textContent).toContain("Recorrido");

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-agent-tool-confirm-remove]")!.click();
      await flush();
    });
    expect(deletes).toEqual(["/api/agent-tools/t1"]);
    expect(document.querySelector('iframe[data-agent-tool-frame="t1"]')).toBeNull();
    // Tool removed -> header button is gone!
    expect(host.querySelector("[data-agent-tools-btn]")).toBeNull();
  });

  it("opens a picker sheet when the agent has multiple tools, relays data.* via cliente.pedir, and refreshes after a turn finishes", async () => {
    let toolsList: Array<{ id: string; slug: string; title: string; frameUrl: string; frameOrigin: string }> = [];
    const dataCalls: Array<{ ruta: string; body: unknown }> = [];
    const cliente = {
      pedir: vi.fn(async (ruta: string, init?: RequestInit) => {
        if (ruta === "/api/agent-tools?assistantId=a1") return Response.json(toolsList);
        if (ruta === "/api/movil/agent-tools/t2/open" && init?.method === "POST") {
          return Response.json({ url: `${PHONE_ORIGIN}/?v=sha2`, origin: PHONE_ORIGIN });
        }
        if (ruta === "/api/agent-tools/t2/data" && init?.method === "POST") {
          dataCalls.push({ ruta, body: JSON.parse(String(init.body ?? "{}")) });
          return Response.json({ ok: true, doc: { collection: "notes", docId: "1", data: { text: "hola" }, updatedAt: "2026-11-22T12:00:00Z", updatedBy: "person" } });
        }
        return Response.json({});
      }),
      avisarAlCerrar: vi.fn(),
    };

    const hostEl = document.createElement("div");
    document.body.appendChild(hostEl);
    const root = createRoot(hostEl);
    roots.push(root);

    const renderChat = (trabajando: boolean) => {
      act(() => {
        root.render(
          <PantallaChat
            abierto
            chat={{ ...makeChat(), trabajando }}
            cliente={cliente}
            projectId="space-1"
            idioma="es"
            conPip={false}
            onCerrar={vi.fn()}
            onLlamar={vi.fn()}
            asistente={{ id: "a1", name: "Ana", color: "#19c3b1" }}
          />,
        );
      });
    };

    // Start while agent is working and has no tools yet.
    renderChat(true);
    await act(flush);
    expect(hostEl.querySelector("[data-agent-tools-btn]")).toBeNull();

    // Agent finishes turn having published two tools -> list refreshes and button appears.
    toolsList = [
      { id: "t1", slug: "recorrido", title: "Recorrido", frameUrl: `${WORKSPACE_ORIGIN}/?v=1`, frameOrigin: WORKSPACE_ORIGIN },
      { id: "t2", slug: "notas", title: "Notas", frameUrl: `${WORKSPACE_ORIGIN}/?v=2`, frameOrigin: WORKSPACE_ORIGIN },
    ];
    renderChat(false);
    await act(flush);
    expect(hostEl.querySelector("[data-agent-tools-btn]")).not.toBeNull();

    // Multiple tools -> opens picker sheet; picking t2 opens its phone URL.
    await act(async () => {
      hostEl.querySelector<HTMLButtonElement>("[data-agent-tools-btn]")!.click();
      await flush();
    });
    expect(document.querySelector("[data-agent-tools-picker]")).not.toBeNull();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-agent-tool-pick="t2"]')!.click();
      await flush();
    });
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-agent-tool-frame="t2"]')!;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("src")).toBe(`${PHONE_ORIGIN}/?v=sha2`);

    const posted: unknown[] = [];
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation((msg) => posted.push(msg));
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: PHONE_ORIGIN,
          source: iframe.contentWindow,
          data: rpc(9, "data.set", { collection: "notes", docId: "1", data: { text: "hola" } }),
        }),
      );
      await flush();
    });
    expect(dataCalls).toEqual([{ ruta: "/api/agent-tools/t2/data", body: { op: "set", collection: "notes", docId: "1", data: { text: "hola" } } }]);
    expect(posted.at(-1)).toMatchObject({ id: 9, result: { ok: true } });
  });

  it("isolates tools across agent switches, layers Escape without closing the chat, handles repeated data.subscribe and DELETE failure", async () => {
    const signals: AbortSignal[] = [];
    let deleteStatus = 500;
    const onCerrarChat = vi.fn();
    let resolveAgentB!: (r: Response) => void;
    const cliente = {
      pedir: vi.fn(async (ruta: string, init?: RequestInit) => {
        if (ruta === "/api/agent-tools?assistantId=a1") {
          return Response.json([
            { id: "t1", slug: "recorrido", title: "Recorrido", frameUrl: `${WORKSPACE_ORIGIN}/?v=1`, frameOrigin: WORKSPACE_ORIGIN },
            { id: "t2", slug: "notas", title: "Notas", frameUrl: `${WORKSPACE_ORIGIN}/?v=2`, frameOrigin: WORKSPACE_ORIGIN },
          ]);
        }
        if (ruta === "/api/agent-tools?assistantId=a2") {
          return await new Promise<Response>((r) => {
            resolveAgentB = r;
          });
        }
        if (ruta === "/api/movil/agent-tools/t1/open" && init?.method === "POST") {
          return Response.json({ url: `${PHONE_ORIGIN}/?v=sha1`, origin: PHONE_ORIGIN });
        }
        if (ruta === "/api/agent-tools/t1/follow") {
          if (init?.signal) signals.push(init.signal);
          return sseStream().response;
        }
        if (ruta === "/api/agent-tools/t1" && init?.method === "DELETE") {
          return new Response(JSON.stringify({ error: "boom" }), { status: deleteStatus });
        }
        return Response.json({});
      }),
      avisarAlCerrar: vi.fn(),
    };

    const hostEl = document.createElement("div");
    document.body.appendChild(hostEl);
    const root = createRoot(hostEl);
    roots.push(root);

    const renderFor = (id: string, name: string) =>
      act(() => {
        root.render(
          <PantallaChat
            abierto
            chat={makeChat()}
            cliente={cliente}
            projectId={`space-${id}`}
            idioma="es"
            conPip={false}
            onCerrar={onCerrarChat}
            onLlamar={vi.fn()}
            asistente={{ id, name, color: "#19c3b1" }}
          />,
        );
      });

    renderFor("a1", "Ana");
    await act(flush);
    expect(hostEl.querySelector("[data-agent-tools-btn]")).not.toBeNull();

    // Open picker -> has lm-m tokens; Escape closes ONLY the picker, not the chat.
    await act(async () => {
      hostEl.querySelector<HTMLButtonElement>("[data-agent-tools-btn]")!.click();
      await flush();
    });
    const picker = document.querySelector<HTMLElement>("[data-agent-tools-picker]")!;
    expect(picker.classList.contains("lm-m")).toBe(true);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await flush();
    });
    expect(document.querySelector("[data-agent-tools-picker]")).toBeNull();
    expect(onCerrarChat).not.toHaveBeenCalled();

    // Open picker again -> pick t1 -> screen has lm-m; repeated data.subscribe aborts stream 1 and opens stream 2.
    await act(async () => {
      hostEl.querySelector<HTMLButtonElement>("[data-agent-tools-btn]")!.click();
      await flush();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-agent-tool-pick="t1"]')!.click();
      await flush();
    });
    const screen = document.querySelector<HTMLElement>('[data-agent-tool-screen="t1"]')!;
    expect(screen.classList.contains("lm-m")).toBe(true);
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-agent-tool-frame="t1"]')!;
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => {});

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { origin: PHONE_ORIGIN, source: iframe.contentWindow, data: rpc(1, "data.subscribe") }));
      await flush();
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { origin: PHONE_ORIGIN, source: iframe.contentWindow, data: rpc(2, "data.subscribe") }));
      await flush();
    });
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    // DELETE failure keeps the confirm sheet open and shows error; Escape closes ONLY the confirm sheet, then screen.
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-agent-tool-remove]")!.click();
      await flush();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-agent-tool-confirm-remove]")!.click();
      await flush();
    });
    expect(document.querySelector("[data-agent-tool-confirm-sheet]")).not.toBeNull();
    expect(document.querySelector("[data-agent-tool-confirm-sheet]")!.textContent).toContain("quitarFallo");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await flush();
    });
    expect(document.querySelector("[data-agent-tool-confirm-sheet]")).toBeNull();
    expect(document.querySelector('[data-agent-tool-screen="t1"]')).not.toBeNull();
    expect(onCerrarChat).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await flush();
    });
    expect(document.querySelector('[data-agent-tool-screen="t1"]')).toBeNull();
    expect(signals[1].aborted).toBe(true);
    expect(onCerrarChat).not.toHaveBeenCalled();

    // Switch to Agent B while its fetch is still in flight -> Agent A's button disappears immediately!
    deleteStatus = 200;
    renderFor("a2", "Beto");
    expect(hostEl.querySelector("[data-agent-tools-btn]")).toBeNull();
    resolveAgentB(Response.json([]));
    await act(flush);
    expect(hostEl.querySelector("[data-agent-tools-btn]")).toBeNull();
  });
});
