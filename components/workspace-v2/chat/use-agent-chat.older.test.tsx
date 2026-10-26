// @vitest-environment jsdom
//
// A11 · EL CHAT ENSEÑA LA CONVERSACIÓN ENTERA. El proyecto trae las 50 más
// recientes; al llegar arriba, el chat pide las de antes (`GET …/chat?before=`)
// y las pone delante. Cuando el servidor manda otra vez sus 50 (otro turno, otra
// pestaña), lo traído —y la que se salió de esas 50— sigue delante, en su orden.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string) => clave,
  useLocale: () => "es",
}));

import type { StoredChatTurn } from "@/lib/projects/types";
import { useAgentChat } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const turno = (id: string, appliedAt: number): StoredChatTurn => ({ id, userText: id, assistantReasoning: "Hecho.", status: "applied", appliedAt });

describe("A11 · lo de antes, al llegar arriba", () => {
  it("🔴 pide las de antes del turno más viejo, las pone delante y no vuelve a pedir si no queda nada", async () => {
    const pedidas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        pedidas.push(String(url));
        if (String(url).includes("/chat?before=")) {
          return new Response(JSON.stringify({ turns: [turno("a", 500), turno("b", 600)], hasMore: false }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );
    let chat: ReturnType<typeof useAgentChat> | null = null;
    function Sonda({ initialChat }: { initialChat: StoredChatTurn[] }) {
      chat = useAgentChat({ projectId: "p1", projectHtml: "<p>x</p>", onLocalUpdate: () => {}, initialChat } as Parameters<typeof useAgentChat>[0]);
      return null;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<Sonda initialChat={[turno("t1", 1000), turno("t2", 2000)]} />));

    await act(async () => {
      await chat!.loadOlder();
    });
    expect(pedidas.filter((u) => u.includes("before="))).toEqual(["/api/projects/p1/chat?before=t1"]);
    expect(chat!.turns.map((t) => t.id)).toEqual(["a", "b", "t1", "t2"]);

    await act(async () => {
      await chat!.loadOlder();
    });
    expect(pedidas.filter((u) => u.includes("before="))).toHaveLength(1);

    // El servidor vuelve a mandar sus más recientes: t1 ya no está entre ellas.
    await act(async () => root!.render(<Sonda initialChat={[turno("t2", 2000), turno("t3", 3000)]} />));
    expect(chat!.turns.map((t) => t.id)).toEqual(["a", "b", "t1", "t2", "t3"]);
  });
});
