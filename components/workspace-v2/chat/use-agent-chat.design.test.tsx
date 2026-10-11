import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string) => clave,
  useLocale: () => "es",
}));

import { useAgentChat } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const ELEMENTO = {
  chain: [{ path: "/src/App.tsx", line: 7, component: null }], primary: 0, tag: "h1", text: "Hola", copies: 1, screen: "#/",
  changes: [{ property: "font-size" as const, before: "32px", after: "48px" }],
};

/** `/api/agent` contesta un SSE con los eventos dados y lo cierra. Guarda los cuerpos. */
function stubAgent(eventos: string[]) {
  const enc = new TextEncoder();
  const cuerpos: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/agent" && init?.method === "POST") {
        cuerpos.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            for (const e of eventos) c.enqueue(enc.encode(e));
            c.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return cuerpos;
}

async function render(onDesignSettled: (ok: boolean) => void) {
  function Chat() {
    useAgentChat({
      projectId: "p1",
      projectHtml: "",
      onLocalUpdate: () => {},
      pendingDraft: "Cambios de diseño · 1 elementos",
      pendingDraftAutoSend: true,
      pendingAttachments: { images: [], styleDirection: null, design: { elements: [ELEMENTO] } },
      onPendingDraftConsumed: () => {},
      onDesignSettled,
    } as Parameters<typeof useAgentChat>[0]);
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Chat />));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

const TURNO = `event: turno\ndata: ${JSON.stringify({ turnoId: "t1" })}\n\n`;
const DONE = `event: done\ndata: ${JSON.stringify({ turns: 1, toolCalls: 1 })}\n\n`;
const ERROR = `event: error\ndata: ${JSON.stringify({ message: "falló", code: "provider_error" })}\n\n`;

describe("«Aplicar» del modo Diseño en el chat", () => {
  it("🔴 el turno lleva `design` en el cuerpo de /api/agent", async () => {
    const cuerpos = stubAgent([TURNO, DONE]);
    await render(() => {});
    expect(cuerpos).toHaveLength(1);
    expect((cuerpos[0]!.design as { elements: { tag: string }[] }).elements[0]!.tag).toBe("h1");
  });

  it("al acabar entero, onDesignSettled(true)", async () => {
    stubAgent([TURNO, DONE]);
    const settled = vi.fn();
    await render(settled);
    expect(settled).toHaveBeenCalledWith(true);
  });

  it("🔴 con error, onDesignSettled(false): los pendientes se quedan", async () => {
    stubAgent([TURNO, ERROR]);
    const settled = vi.fn();
    await render(settled);
    expect(settled).toHaveBeenCalledWith(false);
  });
});
