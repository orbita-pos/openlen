// THE BACKDROP FOLLOWS LEN (spec local 2026-11-27-temas-del-workspace, §4.4–4.5): a `set_theme` or a `publish` that went
// through in the stream makes the workspace read its themes again; one that failed, or any other tool, does not.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string) => clave,
  useLocale: () => "es",
}));
vi.mock("../theme/use-workspace-theme", () => ({ reloadWorkspaceThemes: vi.fn() }));

import { reloadWorkspaceThemes } from "../theme/use-workspace-theme";

import { useAgentChat } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.mocked(reloadWorkspaceThemes).mockReset();
});

const action = (tool: string, status: string) => `event: action\ndata: ${JSON.stringify({ type: "action", tool, status, summary: tool })}\n\n`;

async function runTurn(events: string[]) {
  const enc = new TextEncoder();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/agent" && init?.method === "POST") {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            for (const e of [`event: turno\ndata: ${JSON.stringify({ turnoId: "t1" })}\n\n`, ...events, `event: done\ndata: ${JSON.stringify({ turns: 1, toolCalls: 1 })}\n\n`]) {
              c.enqueue(enc.encode(e));
            }
            c.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  function Chat() {
    useAgentChat({
      projectId: "p1",
      projectHtml: "",
      onLocalUpdate: () => {},
      pendingDraft: "Ponme el tema del estanque",
      pendingDraftAutoSend: true,
      onPendingDraftConsumed: () => {},
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

describe("Len's theme tools repaint the workspace", () => {
  it("a set_theme that went through reloads the themes once, when it settles", async () => {
    await runTurn([action("set_theme", "running"), action("set_theme", "done")]);
    expect(reloadWorkspaceThemes).toHaveBeenCalledTimes(1);
  });

  it("a publish that went through (a theme installed) reloads them too", async () => {
    await runTurn([action("publish", "running"), action("publish", "done")]);
    expect(reloadWorkspaceThemes).toHaveBeenCalledTimes(1);
  });

  it("a failed set_theme or publish, and any other tool, reload nothing", async () => {
    await runTurn([action("set_theme", "error"), action("publish", "error"), action("Write", "done")]);
    expect(reloadWorkspaceThemes).not.toHaveBeenCalled();
  });
});
