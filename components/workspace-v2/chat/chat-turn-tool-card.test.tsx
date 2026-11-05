// «CREAR» CARDS (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): the card Len proposed is drawn under the
// answer it follows — the chat row whose id it carries — and nowhere else.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
  useLocale: () => "es",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams("project=p") }));

import { storedTurnFromRow } from "@/lib/projects/stored-turn";
import type { EtiquetasDeRespuesta } from "../agent-reply-card";
import { toolCardsLive } from "../tools/use-tool-cards";
import { LenTurn } from "./chat-turn";
import { restoreTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  toolCardsLive.forget();
});

const nothing = () => {};
function paintTurn(id: string): HTMLElement {
  const turn = restoreTurn(
    storedTurnFromRow({ id, userText: "¿qué me harías?", assistantReasoning: "Te propongo una herramienta.", status: "applied", createdAt: new Date(0), attachedImage: null, actions: null }),
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <LenTurn
        turn={turn}
        next={undefined}
        isLast
        currentPage={null}
        projectId="p"
        when="now"
        vote={undefined}
        labels={{} as EtiquetasDeRespuesta}
        onRetry={nothing}
        onPublished={nothing}
        onConfirmSettled={nothing}
        onAnswerQuestion={nothing}
        onDismissQuestion={nothing}
        onRate={async () => true}
        onClearRate={async () => true}
      />,
    ),
  );
  return host;
}

describe("LenTurn and its «Crear» card", () => {
  it("the card is drawn under the answer whose row it carries", () => {
    act(() =>
      toolCardsLive.event("p", {
        id: "card-1", chatRowId: "row-1", title: "Reservas de hoy", brief: "Ver las reservas.", initialContent: null, placement: "rail",
        customLocation: null, phase: "proposed", toolProjectId: null, installationId: null, error: null, review: null,
      }),
    );
    expect(paintTurn("row-1").querySelector("[data-tool-card='proposed']")).not.toBeNull();
    expect(paintTurn("row-2").querySelector("[data-tool-card]")).toBeNull();
  });
});
