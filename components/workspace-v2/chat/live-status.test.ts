// QUÉ DICE LA BARRA VIVA DEL CHAT NUEVO, estado a estado (plans/new-chat/,
// inventario sección C). Puro: sale del último turno y de si hay uno en marcha.
import { describe, expect, it } from "vitest";

import { activityOf, isRunning, liveStatus, questionOf, questionsOf, retryPhase } from "./live-status";
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
  it("en un reintento del proveedor dice que reintenta, en qué intento va y hasta cuándo espera", () => {
    const s = liveStatus(turn({ status: "streaming", startedAt: 1, retrying: { attempt: 2, maxAttempts: 5, until: 9_000 } }), { busy: true });
    expect(s).toEqual({ kind: "retrying", face: "pensando", attempt: 2, maxAttempts: 5, until: 9_000 });
  });

  it("mientras espera dice «en X s» (redondeado hacia arriba); al acabar la espera, el intento nuevo ya está pensando", () => {
    const s = { kind: "retrying", face: "pensando", attempt: 2, maxAttempts: 5, until: 9_000 } as const;
    expect(retryPhase(s, 6_500)).toEqual({ waiting: true, seconds: 3 });
    expect(retryPhase(s, 8_999)).toEqual({ waiting: true, seconds: 1 });
    expect(retryPhase(s, 9_000)).toEqual({ waiting: false });
  });

  it("mientras compacta, dice que ordena lo que lleva", () => {
    const s = liveStatus(turn({ status: "streaming", startedAt: 1, compacting: true }), { busy: true });
    expect(s).toEqual({ kind: "compacting", face: "revisando" });
  });

  it("el ■ sigue mientras ordena lo que lleva (es trabajo, y se cobra)", () => {
    expect(isRunning({ kind: "compacting", face: "revisando" })).toBe(true);
  });

  it("BRAZO DE CONTROL: con el turno ya cerrado, la marca de compactar no pinta nada", () => {
    expect(liveStatus(turn({ status: "applied", compacting: true }), { busy: false }).kind).not.toBe("compacting");
  });

  it("el ■ sigue mientras reintenta (está trabajando); no con el turno terminado", () => {
    expect(isRunning({ kind: "retrying", face: "pensando", attempt: 1, maxAttempts: 5, until: 1 })).toBe(true);
    expect(isRunning({ kind: "thinking", face: "pensando", startedAt: 1 })).toBe(true);
    expect(isRunning({ kind: "done", face: "terminado" })).toBe(false);
  });

  it("BRAZO DE CONTROL: sin reintento, la misma vuelta sigue en «pensando»", () => {
    const s = liveStatus(turn({ status: "streaming", startedAt: 1 }), { busy: true });
    expect(s.kind).toBe("thinking");
  });

  it("sin conversación no dice nada", () => {
    expect(liveStatus(undefined, { busy: false }).kind).toBe("idle");
  });

  it("recién mandado y sin nada todavía: pensando, con su reloj", () => {
    const s = liveStatus(turn({ status: "streaming", startedAt: 1000 }), { busy: true });
    expect(s).toEqual({ kind: "thinking", face: "pensando", startedAt: 1000 });
  });

  it("ai-design ya escribió la página y su `done` vació el texto: sigue escribiendo, no vuelve a «pensando» (N34)", () => {
    // Visto en el taller: «Escribiendo la página · 186 caracteres» → «Pensando · 12 s» durante el segundo que se
    // disuelve el barrido, porque el `done` cambia el texto de Len por su `reasoning` final, que venía vacío.
    const s = liveStatus(turn({ status: "streaming", startedAt: 1, streamedChars: 186 }), { busy: true });
    expect(s).toMatchObject({ kind: "working", face: "escribiendo", streamedChars: 186 });
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
    expect(s).not.toHaveProperty("streamedChars");
  });

  it("el camino de reserva que gotea la página dice cuánto lleva (C3)", () => {
    const s = liveStatus(turn({ status: "streaming", assistantReasoning: "Reescribo…", streamedChars: 12_300 }), { busy: true });
    expect(s).toMatchObject({ kind: "working", activity: null, streamedChars: 12_300 });
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

  it("ALINEAR · una pregunta CANCELADA no es «te toca»: ni pregunta, ni barra de espera", () => {
    const preguntas = [{ id: "plan-review", question: "Approve this plan and leave plan mode?" }];
    const t = turn({ actions: [{ tool: "exit_plan_mode", status: "done", summary: "", preguntas, dismissed: true }] });
    expect(questionOf(t)).toBeNull();
    expect(liveStatus(t, { busy: false }).kind).not.toBe("waiting");
  });

  it("pieza 3: con el nombre nuevo es lo mismo, y trae sus opciones para la tarjeta", () => {
    const preguntas = [{ id: "plazo", question: "¿Cuántas horas antes?", options: [{ label: "24" }, { label: "48" }] }];
    const t = turn({ actions: [{ tool: "ask_user_question", status: "done", summary: "", pregunta: "¿Cuántas horas antes?", preguntas }] });
    expect(questionOf(t)).toBe("¿Cuántas horas antes?");
    expect(questionsOf(t)).toEqual(preguntas);
    expect(activityOf("ask_user_question")).toBe("asking");
    // Pieza 7: las del modo plan, igual.
    expect(["enter_plan_mode", "exit_plan_mode"].map(activityOf)).toEqual(["asking", "asking"]);
    // Pieza 5: buscar y leer en las charlas pasadas es leer.
    expect(["session_search", "session_event_search", "session_event_read"].map(activityOf)).toEqual(["reading", "reading", "reading"]);
  });

  it("🔴 pieza 3: mientras la pregunta espera DENTRO del turno, la barra dice que te toca y el ■ sigue", () => {
    const preguntas = [{ id: "plazo", question: "¿Cuántas horas antes?" }];
    const t = turn({ status: "streaming", startedAt: 1, pendingQuestions: preguntas, actions: [{ tool: "ask_user_question", status: "running", summary: "" }] });
    const s = liveStatus(t, { busy: true });
    expect(s).toEqual({ kind: "waiting", face: "preguntando", reason: "question", question: "¿Cuántas horas antes?", live: true });
    expect(isRunning(s)).toBe(true);
    // Ya contestó: Len sigue trabajando con la respuesta.
    expect(liveStatus({ ...t, answeredLive: "24" }, { busy: true }).kind).toBe("working");
  });

  it("🔴 pieza 3: una pregunta contestada DENTRO del turno ya no es esperar", () => {
    const t = turn({ actions: [{ tool: "ask_user_question", status: "done", summary: "", pregunta: "¿Cuántas horas antes?", respuesta: "48" }] });
    expect(questionOf(t)).toBeNull();
    expect(liveStatus(t, { busy: false })).toEqual({ kind: "done", face: "terminado" });
  });

  it("🔴 pieza 7: una revisión del plan sin contestar al cerrar el turno es esperar, con su tarjeta", () => {
    const preguntas = [{ id: "plan-review", question: "Approve this plan and leave plan mode?", intent: { kind: "plan-review" as const, plan: "# Plan" } }];
    const t = turn({ actions: [{ tool: "exit_plan_mode", status: "done", summary: "", pregunta: "Approve this plan and leave plan mode?", preguntas }] });
    expect(questionsOf(t)).toEqual(preguntas);
    // Con su intención: la barra la dice en el idioma del dueño, no en el inglés del servidor.
    expect(liveStatus(t, { busy: false })).toMatchObject({ kind: "waiting", reason: "question", intent: "plan-review" });
    // Y la que espera dentro del turno, igual.
    const viva = turn({ status: "streaming", startedAt: 1, pendingQuestions: preguntas, actions: [{ tool: "exit_plan_mode", status: "running", summary: "" }] });
    expect(liveStatus(viva, { busy: true })).toMatchObject({ kind: "waiting", live: true, intent: "plan-review" });
    // Contestada, no.
    expect(questionOf(turn({ actions: [{ tool: "enter_plan_mode", status: "done", summary: "", respuesta: "Plan first" }] }))).toBeNull();
  });

  it("una pregunta de una fila vieja, sin su texto, sigue siendo esperar", () => {
    const t = turn({ actions: [{ tool: "preguntar", status: "done", summary: "" }] });
    expect(liveStatus(t, { busy: false })).toMatchObject({ kind: "waiting", reason: "question", question: "" });
  });

  it("una tarjeta de publicar sin tocar espera tu aprobación; resuelta, ya no", () => {
    const t = turn({ confirm: { action: "publish", subdominio: "luna", idiomas: [], republicar: false } });
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
