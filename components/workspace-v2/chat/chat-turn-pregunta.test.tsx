// LA PREGUNTA CON LA QUE LEN EMPIEZA (pieza 3, visto con un turno real el
// 05/10): si `ask_user_question` es lo PRIMERO del turno —sin texto y sin pasos
// antes—, el turno «no tenía nada que enseñar» y no se pintaba entero, tarjeta
// incluida. La barra decía «Te toca» y no había nada que contestar.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, v?: Record<string, unknown>) => (v ? `${clave} ${JSON.stringify(v)}` : clave),
  useLocale: () => "es",
}));

import { LenTurn } from "./chat-turn";
import type { DesignTurn } from "./use-agent-chat";
import type { EtiquetasDeRespuesta } from "../agent-reply-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

const pregunta = {
  id: "q1",
  question: "¿Qué sección nueva le añado a la página?",
  options: [{ label: "Pedidos por WhatsApp" }, { label: "Preguntas frecuentes" }],
};

function pintar(turn: DesignTurn) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const nada = () => {};
  act(() =>
    root.render(
      <LenTurn
        turn={turn}
        next={undefined}
        isLast
        currentPage={null}
        projectId="p"
        when="ahora"
        vote={undefined}
        labels={{} as EtiquetasDeRespuesta}
        onUndo={nada}
        onRetry={nada}
        onPublished={nada}
        onConfirmSettled={nada}
        onAnswerQuestion={nada}
        onDismissQuestion={nada}
        onRate={async () => true}
        onClearRate={async () => true}
      />,
    ),
  );
  return host;
}

const enCurso = (extra: Partial<DesignTurn>) =>
  ({ id: "t", userText: "pregúntame", assistantReasoning: "", status: "streaming", ...extra }) as DesignTurn;

describe("la pregunta con la que Len empieza el turno", () => {
  it("🔴 sin texto ni pasos antes, la tarjeta se pinta con sus opciones", () => {
    const host = pintar(
      enCurso({
        actions: [{ tool: "ask_user_question", status: "running", summary: pregunta.question }] as DesignTurn["actions"],
        pendingQuestions: [pregunta],
      }),
    );
    expect(host.textContent).toContain("¿Qué sección nueva le añado a la página?");
    expect(host.textContent).toContain("Pedidos por WhatsApp");
  });

  it("BRAZO DE CONTROL: sin pregunta, sin texto y sin pasos, no hay nada que pintar todavía", () => {
    const host = pintar(enCurso({}));
    expect(host.textContent).toBe("");
  });
});
