// @vitest-environment jsdom
//
// EN UNA APP, EL CHAT HABLA DE LA APP (09/10): mientras Len trabaja decía
// «Leyendo tu página» / «Cambiando la página», y «Nueva charla» prometía que se
// quedaban «las notas de la página». Y «Comparar antes y después» no se ofrece:
// compara el HTML del turno en marcos sin scripts, y el de una app es sólo el
// cascarón (`#root` vacío): saldrían dos marcos en blanco.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => {
  const t = Object.assign((clave: string) => clave, { rich: (clave: string) => clave });
  return { useTranslations: () => t, useLocale: () => "es" };
});

import { ChangesCard } from "./changes-card";
import { ChatHeader } from "./chat-header";
import { LiveBar } from "./live-bar";
import { TurnClose } from "./turn-close";
import type { useConversations } from "./use-conversations";
import type { DesignTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom no tiene matchMedia; la cara de Len pregunta por el movimiento reducido.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
})) as unknown as typeof window.matchMedia;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function montar(nodo: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(nodo));
  return host;
}

describe("la barra viva", () => {
  const trabajando = (activity: "reading" | "editing" | "photos") =>
    ({ kind: "working", face: "escribiendo", activity, startedAt: null, onServer: false }) as const;

  it("🔴 en una app: «leyendo tu app», «cambiando la app»", () => {
    expect(montar(<LiveBar status={trabajando("reading")} onStop={() => {}} esApp />).textContent).toContain("newChat.activity.readingApp");
    expect(montar(<LiveBar status={trabajando("editing")} onStop={() => {}} esApp />).textContent).toContain("newChat.activity.editingApp");
  });

  it("lo que no nombra la página es igual en una app; y en una página, como siempre", () => {
    expect(montar(<LiveBar status={trabajando("photos")} onStop={() => {}} esApp />).textContent).toContain("newChat.activity.photos");
    expect(montar(<LiveBar status={trabajando("reading")} onStop={() => {}} />).textContent).toContain("newChat.activity.reading");
    expect(montar(<LiveBar status={trabajando("reading")} onStop={() => {}} />).textContent).not.toContain("readingApp");
  });
});

describe("«Nueva charla»", () => {
  const conversations = {
    archived: [],
    pending: false,
    load: async () => {},
    startNew: async () => "ok",
    reopen: async () => "ok",
  } as unknown as ReturnType<typeof useConversations>;
  const cabecera = (esApp: boolean) =>
    montar(
      <ChatHeader
        layout="docked"
        onLayout={() => {}}
        conversations={conversations}
        busy={false}
        relativeTime={() => ""}
        esApp={esApp}
      />,
    );
  const pista = (host: HTMLElement) => {
    act(() => (host.querySelector('[aria-label="newChat.header.conversations"]') as HTMLButtonElement).click());
    return host.querySelector('[role="menuitem"] small')?.textContent;
  };

  it("🔴 en una app, se quedan las notas de la app", () => {
    expect(pista(cabecera(true))).toBe("newChat.header.newChatHintApp");
  });

  it("en una página, las de la página", () => {
    expect(pista(cabecera(false))).toBe("newChat.header.newChatHint");
  });
});

describe("«Comparar antes y después»", () => {
  const turno = {
    id: "t1",
    userText: "cambia el título",
    assistantReasoning: "",
    status: "applied",
    preEditHtml: "<div id=\"root\"></div>",
    postEditHtml: "<div id=\"root\"></div><!-- otro -->",
    page: null,
  } as unknown as DesignTurn;
  const comparar = (host: HTMLElement) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("newChat.changes.compare"));

  it("🔴 en una app no se ofrece: el cascarón sin scripts son dos marcos en blanco", () => {
    expect(comparar(montar(<ChangesCard turn={turno} projectId="p1" samePage esApp />))).toBeUndefined();
  });

  it("en una página, sí", () => {
    expect(comparar(montar(<ChangesCard turn={turno} projectId="p1" samePage />))).toBeDefined();
  });
});

describe("el cierre del turno", () => {
  const cierre = (turno: Partial<DesignTurn>, esApp: boolean) =>
    montar(
      <TurnClose
        turn={{ id: "t1", userText: "x", assistantReasoning: "", status: "applied", appliedAt: 0, preEditHtml: "", ...turno } as DesignTurn}
        currentPage={null}
        vote={undefined}
        onRetry={() => {}}
        onRate={async () => true}
        onClearRate={async () => true}
        esApp={esApp}
      />,
    ).textContent;

  it("🔴 en una app: «no cambió nada de la app» y, si se corta, «revisa la app»", () => {
    expect(cierre({ noDocChange: true }, true)).toContain("noChange.labelApp");
    expect(cierre({ cortado: true, avisoTurno: "tope" }, true)).toContain("cutShortApp");
  });

  it("en una página, como siempre", () => {
    expect(cierre({ noDocChange: true }, false)).not.toContain("labelApp");
    expect(cierre({ noDocChange: true }, false)).toContain("noChange.label");
    expect(cierre({ cortado: true, avisoTurno: "tope" }, false)).not.toContain("cutShortApp");
  });
});
