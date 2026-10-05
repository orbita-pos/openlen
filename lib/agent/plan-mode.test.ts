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
  planConsentQuestion,
  planModeFromRows,
  planReviewQuestion,
  planTitle,
  resolveTurnPlanMode,
  reviewOutcome,
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

  it("activo, la añade UNA vez al prompt de sistema", () => {
    const una = withPlanSection(base, true);
    expect(una[0]!.content).toBe(`You are Len.\n\n${PLAN_POLICY}`);
    expect(withPlanSection(una, true)[0]!.content).toBe(una[0]!.content);
  });

  it("inactivo, la quita y deja la base", () => {
    expect(withPlanSection(withPlanSection(base, true), false)[0]!.content).toBe("You are Len.");
  });

  it("no toca el resto ni el array de entrada", () => {
    const out = withPlanSection(base, true);
    expect(out.slice(1)).toEqual(base.slice(1));
    expect(base[0]!.content).toBe("You are Len.");
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
