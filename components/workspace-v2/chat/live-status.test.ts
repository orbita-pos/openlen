// QUÉ DICE LA BARRA VIVA DEL CHAT NUEVO, estado a estado (plans/new-chat/,
// inventario sección C). Puro: sale del último turno y de si hay uno en marcha.
import { describe, expect, it } from "vitest";

import { activityOf, liveStatus, questionOf } from "./live-status";
import type { DesignTurn } from "./use-agent-chat";

const turn = (patch: Partial<DesignTurn> = {}): DesignTurn => ({
  id: "t1",
  userText: "pon fotos",
  assistantReasoning: "",
  status: "applied",
  preEditHtml: "",
  ...patch,
});

describe("la barra viva", () => {
  it("sin conversación no dice nada", () => {
    expect(liveStatus(undefined, { busy: false }).kind).toBe("idle");
  });

  it("recién mandado y sin nada todavía: pensando, con su reloj", () => {
    const s = liveStatus(turn({ status: "streaming", startedAt: 1000 }), { busy: true });
    expect(s).toEqual({ kind: "thinking", face: "pensando", startedAt: 1000 });
  });

  it("con una herramienta en marcha dice QUÉ hace, de la última que corre", () => {
    const s = liveStatus(
      turn({
        status: "streaming",
        startedAt: 1,
        actions: [
          { tool: "Read", status: "done", summary: "index.html" },
          { tool: "elegir_foto", status: "running", summary: "" },
        ],
      }),
      { busy: true },
    );
    expect(s).toMatchObject({ kind: "working", activity: "photos", face: "buscando" });
  });

  it("escribiendo sin herramienta: trabajando, sin actividad", () => {
    const s = liveStatus(turn({ status: "streaming", assistantReasoning: "Voy…" }), { busy: true });
    expect(s).toMatchObject({ kind: "working", activity: null });
  });

  it("un turno que sigue en el servidor lo dice", () => {
    const s = liveStatus(turn({ status: "streaming", enServidor: true }), { busy: true });
    expect(s).toMatchObject({ kind: "working", onServer: true });
  });

  it("acabó preguntando: te toca, con la pregunta", () => {
    const t = turn({
      actions: [{ tool: "preguntar", status: "done", summary: "", pregunta: "¿Cuántas horas antes?" }],
    });
    expect(questionOf(t)).toBe("¿Cuántas horas antes?");
    expect(liveStatus(t, { busy: false })).toEqual({
      kind: "waiting",
      face: "preguntando",
      reason: "question",
      question: "¿Cuántas horas antes?",
    });
  });

  it("una pregunta de una fila vieja, sin su texto, sigue siendo esperar", () => {
    const t = turn({ actions: [{ tool: "preguntar", status: "done", summary: "" }] });
    expect(liveStatus(t, { busy: false })).toMatchObject({ kind: "waiting", reason: "question", question: "" });
  });

  it("una tarjeta de publicar sin tocar espera tu aprobación; resuelta, ya no", () => {
    const t = turn({ confirm: { action: "publicar", subdominio: "luna", idiomas: [], republicar: false } });
    expect(liveStatus(t, { busy: false })).toMatchObject({ kind: "waiting", reason: "publish" });
    expect(liveStatus(t, { busy: false, settledConfirms: new Set(["t1"]) }).kind).toBe("done");
  });

  it("parado por ti no es un fallo; un error sí", () => {
    expect(liveStatus(turn({ status: "error", errorText: "Cancelado." }), { busy: false, cancelledText: "Cancelado." }).kind).toBe(
      "stopped",
    );
    expect(liveStatus(turn({ status: "error", errorText: "Error de red" }), { busy: false, cancelledText: "Cancelado." })).toEqual({
      kind: "failed",
      face: "error",
      message: "Error de red",
    });
  });

  it("cortado tras cambiar algo: detenido, no listo", () => {
    expect(liveStatus(turn({ cortado: true }), { busy: false }).kind).toBe("stopped");
  });

  it("una herramienta desconocida trabaja igual, sin inventarse un verbo", () => {
    expect(activityOf("herramienta_nueva")).toBe("working");
    expect(activityOf("bash")).toBe("terminal");
    expect(activityOf("web_search")).toBe("web");
  });
});
