// EL MODO PLAN (pieza 7 de Len 2.5): el módulo puro. El estado se pliega de la
// conversación como en DeepSeek (`packages/plan/plan-mode`), la revisión se
// decide con su regla y la sección del prompt entra y sale con el estado.
import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ai-gateway";
import {
  APPROVE_LABEL,
  KEEP_PLANNING_LABEL,
  PLAN_FIRST_LABEL,
  PLAN_OFF_NOTICE,
  PLAN_ON_NOTICE,
  PLAN_POLICY,
  SKIP_PLANNING_LABEL,
  consentGiven,
  isPlanPrompt,
  materializeSystemUpdates,
  planConsentQuestion,
  planInHistoryEnabled,
  planModeFromRows,
  planPrompt,
  planReviewQuestion,
  planTitle,
  resolveTurnPlanMode,
  reviewOutcome,
  systemUpdateFor,
  withPlanSection,
} from "./plan-mode";

describe("el estado se pliega de la conversación", () => {
  it("sin filas, apagado", () => {
    expect(planModeFromRows([])).toBe(false);
  });

  it("manda la última fila con transcripción", () => {
    expect(planModeFromRows([{ transcript: { planMode: true } }, { transcript: {} }])).toBe(false);
    expect(planModeFromRows([{ transcript: {} }, { transcript: { planMode: true } }])).toBe(true);
  });

  it("🔴 un turno caído sin transcripción no apaga el modo", () => {
    expect(planModeFromRows([{ transcript: { planMode: true } }, { transcript: null }])).toBe(true);
  });
});

describe("la elección del dueño al mandar", () => {
  it("sin elección, lo plegado y sin narración", () => {
    expect(resolveTurnPlanMode({ folded: true, selected: null })).toEqual({ active: true, notice: null });
    expect(resolveTurnPlanMode({ folded: false, selected: null })).toEqual({ active: false, notice: null });
  });

  it("igual a lo plegado, nada que contar", () => {
    expect(resolveTurnPlanMode({ folded: true, selected: true })).toEqual({ active: true, notice: null });
  });

  it("distinta, gana el dueño y el modelo lo lee con la frase de DeepSeek", () => {
    expect(resolveTurnPlanMode({ folded: false, selected: true })).toEqual({ active: true, notice: PLAN_ON_NOTICE });
    expect(resolveTurnPlanMode({ folded: true, selected: false })).toEqual({ active: false, notice: PLAN_OFF_NOTICE });
    expect(PLAN_ON_NOTICE).toBe("The user switched this session to plan mode.");
    expect(PLAN_OFF_NOTICE).toBe("The user switched this session back to the default mode.");
  });
});

describe("la sección del prompt", () => {
  const base: Message[] = [
    { role: "system", content: "You are Len." },
    { role: "user", content: "manual" },
    { role: "user", content: "hola" },
  ];
  const PLAN = `You are Len.\n\n${PLAN_POLICY}`;
  const OFF = { OPENLEN_PLAN_IN_HISTORY: "0" };

  it("el prompt del modo: la base y, activo, la sección detrás", () => {
    expect(planPrompt("You are Len.", true)).toBe(PLAN);
    expect(planPrompt("You are Len.", false)).toBe("You are Len.");
    expect(planPrompt(PLAN, true)).toBe(PLAN);
    expect(planPrompt(PLAN, false)).toBe("You are Len.");
    expect(isPlanPrompt(PLAN)).toBe(true);
    expect(isPlanPrompt("You are Len.")).toBe(false);
    expect(PLAN_POLICY).toContain('Re-plan if:');
  });

  // Como DeepSeek (in-history system prompt replacement): el prompt que manda es el ÚLTIMO mensaje de
  // sistema de la conversación. Cambiar de modo AÑADE el prompt nuevo, entero, al final; el mensaje 0 y
  // todo lo que el proveedor ya tiene en caché no se tocan.
  it("🔴 al entrar en el modo no se reescribe nada: el prompt nuevo, entero, es un mensaje de sistema al final", () => {
    expect(systemUpdateFor(base, true)).toEqual({ role: "system", content: PLAN });
    const out = withPlanSection(base, true);
    expect(out.slice(0, base.length)).toEqual(base);
    expect(out.at(-1)).toEqual({ role: "system", content: PLAN });
    expect(out).toHaveLength(base.length + 1);
    expect(base).toHaveLength(3);
  });

  it("mientras el modo no cambia, no se añade nada", () => {
    expect(systemUpdateFor(base, false)).toBeNull();
    expect(withPlanSection(base, false)).toEqual(base);
    const dentro = withPlanSection(base, true);
    expect(systemUpdateFor(dentro, true)).toBeNull();
    expect(withPlanSection(dentro, true)).toEqual(dentro);
  });

  it("al salir, el prompt de siempre vuelve como OTRO mensaje de sistema: manda el último, no el mensaje 0", () => {
    const dentro = [...withPlanSection(base, true), { role: "assistant" as const, content: "plan listo" }];
    expect(systemUpdateFor(dentro, false)).toEqual({ role: "system", content: "You are Len." });
    const fuera = withPlanSection(dentro, false);
    expect(fuera.slice(0, dentro.length)).toEqual(dentro);
    expect(fuera.at(-1)).toEqual({ role: "system", content: "You are Len." });
    // Y de vuelta dentro, otra vez al final.
    expect(systemUpdateFor(fuera, true)).toEqual({ role: "system", content: PLAN });
    expect(systemUpdateFor(fuera, false)).toBeNull();
  });

  it("sin mensaje de sistema delante no hay nada que decir", () => {
    expect(systemUpdateFor([{ role: "user", content: "hola" }], true)).toBeNull();
    expect(systemUpdateFor([], true)).toBeNull();
  });

  it("lo que se guardó como marca recupera su texto del mensaje 0 de ESTE turno", () => {
    const guardado: Message[] = [
      { role: "system", content: "You are Len, v2." },
      { role: "user", content: "hola" },
      { role: "system", content: "", systemUpdate: "plan" },
      { role: "assistant", content: "plan listo" },
      { role: "system", content: "", systemUpdate: "default" },
    ];
    const out = materializeSystemUpdates(guardado);
    expect(out[2]).toEqual({ role: "system", content: `You are Len, v2.\n\n${PLAN_POLICY}`, systemUpdate: "plan" });
    expect(out[4]).toEqual({ role: "system", content: "You are Len, v2.", systemUpdate: "default" });
    expect(out[0]).toBe(guardado[0]);
    expect(systemUpdateFor(out, false)).toBeNull();
    expect(systemUpdateFor(out, true)).toEqual({ role: "system", content: `You are Len, v2.\n\n${PLAN_POLICY}` });
  });

  it("OPENLEN_PLAN_IN_HISTORY=0 vuelve a lo de antes: la sección entra y sale del mensaje 0", () => {
    expect(planInHistoryEnabled({})).toBe(true);
    expect(planInHistoryEnabled(OFF)).toBe(false);
    const una = withPlanSection(base, true, OFF);
    expect(una).toHaveLength(base.length);
    expect(una[0]!.content).toBe(PLAN);
    expect(withPlanSection(una, true, OFF)[0]!.content).toBe(PLAN);
    expect(withPlanSection(una, false, OFF)[0]!.content).toBe("You are Len.");
    expect(una.slice(1)).toEqual(base.slice(1));
    expect(base[0]!.content).toBe("You are Len.");
  });

  // Como el arnés de DeepSeek en una ruta SIN la capacidad: cada mensaje de sistema posterior se vacía y se
  // reescribe el primero. Un fork despertado de su copia guardada traía el prompt del modo dentro, con su
  // texto (la copia de un subagente no pasa por el limpiador de la fila), y contradecía al mensaje 0.
  it("🔴 con la palanca apagada no queda NINGÚN prompt posterior en la petición, tenga marca o texto: manda el mensaje 0", () => {
    const conPrompts: Message[] = [base[0]!, base[1]!, { role: "system", content: PLAN }, { role: "assistant", content: "plan" }, { role: "system", content: "You are Len." }, base[2]!];
    expect(withPlanSection(conPrompts, false, OFF)).toEqual([base[0], base[1], { role: "assistant", content: "plan" }, base[2]]);
    const dentro = withPlanSection(conPrompts, true, OFF);
    expect(dentro.filter((m) => m.role === "system")).toEqual([{ role: "system", content: PLAN }]);
    expect(dentro[0]!.content).toBe(PLAN);
    expect(dentro.slice(1)).toEqual([base[1], { role: "assistant", content: "plan" }, base[2]]);
    // Con la palanca encendida esos mensajes son la conversación: no se tocan.
    expect(withPlanSection(conPrompts, false).slice(0, conPrompts.length)).toEqual(conPrompts);
  });

  it("🔴 con la palanca apagada, lo guardado a la manera nueva se quita: no queda un prompt contradiciendo al mensaje 0", () => {
    const guardado: Message[] = [
      { role: "system", content: "You are Len." },
      { role: "user", content: "hola" },
      { role: "system", content: "", systemUpdate: "plan" },
      { role: "assistant", content: "plan listo" },
    ];
    expect(materializeSystemUpdates(guardado, OFF)).toEqual([guardado[0], guardado[1], guardado[3]]);
  });

  it("es la de DeepSeek: sin todo_write y con la verificación para el dueño", () => {
    expect(PLAN_POLICY).toMatch(/^PLAN MODE:\nYou are in plan mode\./);
    expect(PLAN_POLICY).toContain("call exit_plan_mode with the complete plan markdown, starting with a # title");
    expect(PLAN_POLICY).not.toContain("todo_write");
    expect(PLAN_POLICY).toMatch(/end it with how you will verify/);
  });
});

describe("la revisión, con la regla de DeepSeek", () => {
  it("la pregunta es la suya, con el plan como intención", () => {
    const q = planReviewQuestion("# Reseñas\n\nUna sección.");
    expect(q).toMatchObject({
      id: "plan-review",
      header: "Plan review",
      question: "Approve this plan and leave plan mode?",
      intent: { kind: "plan-review", plan: "# Reseñas\n\nUna sección." },
    });
    expect(q.options!.map((o) => o.label)).toEqual([APPROVE_LABEL, KEEP_PLANNING_LABEL]);
  });

  it("aprueba sólo «Approve» a secas", () => {
    expect(reviewOutcome([{ id: "plan-review", selected: [APPROVE_LABEL] }])).toEqual({ approved: true });
  });

  it("«Approve» con comentarios no aprueba: los comentarios vuelven", () => {
    expect(reviewOutcome([{ id: "plan-review", selected: [APPROVE_LABEL], custom: "sin fotos" }])).toEqual({
      approved: false,
      error: "The user chose to keep planning; their feedback: sin fotos",
    });
  });

  it("seguir planeando, con y sin comentarios", () => {
    expect(reviewOutcome([{ id: "plan-review", selected: [KEEP_PLANNING_LABEL] }])).toEqual({
      approved: false,
      error: "The user chose to keep planning; revise the plan and present it again.",
    });
    expect(reviewOutcome([{ id: "plan-review", selected: [], custom: "más corto" }])).toEqual({
      approved: false,
      error: "The user chose to keep planning; their feedback: más corto",
    });
  });

  it("una respuesta a otra pregunta no aprueba", () => {
    expect(reviewOutcome([{ id: "otra", selected: [APPROVE_LABEL] }]).approved).toBe(false);
  });
});

describe("el consentimiento para entrar", () => {
  it("la pregunta lleva su intención y sus dos opciones", () => {
    const q = planConsentQuestion();
    expect(q.id).toBe("plan-mode");
    expect(q.intent).toEqual({ kind: "plan-consent" });
    expect(q.options!.map((o) => o.label)).toEqual([PLAN_FIRST_LABEL, SKIP_PLANNING_LABEL]);
  });

  it("sólo «Plan first» a secas es un sí", () => {
    expect(consentGiven([{ id: "plan-mode", selected: [PLAN_FIRST_LABEL] }])).toBe(true);
    expect(consentGiven([{ id: "plan-mode", selected: [SKIP_PLANNING_LABEL] }])).toBe(false);
    expect(consentGiven([{ id: "plan-mode", selected: [PLAN_FIRST_LABEL], custom: "pero rápido" }])).toBe(false);
    expect(consentGiven([{ id: "plan-mode", selected: [] }])).toBe(false);
  });
});

describe("el título del plan", () => {
  it("es su primer encabezado, de cualquier nivel", () => {
    expect(planTitle("# Reseñas con estrellas\n\nTexto")).toBe("Reseñas con estrellas");
    expect(planTitle("Intro\n## Paso uno")).toBe("Paso uno");
    expect(planTitle("sin títulos")).toBeNull();
  });
});
