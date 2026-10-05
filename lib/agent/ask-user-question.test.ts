// ask_user_question (pieza 3 de Len 2.5): el esquema de DeepSeek, validado antes
// de enseñar nada al dueño.
import { describe, expect, it } from "vitest";
import { isQuestionTool, questionsFrom, questionText, validateQuestions } from "./ask-user-question";

describe("validateQuestions", () => {
  it("acepta la forma de DeepSeek y la normaliza", () => {
    const r = validateQuestions([
      {
        id: "plazo",
        question: "¿Cuánto tarda la entrega?",
        header: "Entrega",
        options: [{ label: "48 horas (Recommended)", description: "Lo que dice tu ficha." }, { label: "Una semana" }],
        multi_select: false,
      },
    ]);
    expect(r).toEqual({
      ok: true,
      questions: [
        {
          id: "plazo",
          question: "¿Cuánto tarda la entrega?",
          header: "Entrega",
          options: [{ label: "48 horas (Recommended)", description: "Lo que dice tu ficha." }, { label: "Una semana" }],
          multiSelect: false,
        },
      ],
    });
  });

  it("sin opciones ni cabecera también vale: una pregunta abierta", () => {
    expect(validateQuestions([{ id: "tel", question: "¿Cuál es tu teléfono?" }])).toEqual({
      ok: true,
      questions: [{ id: "tel", question: "¿Cuál es tu teléfono?" }],
    });
  });

  it("🔴 rechaza lo mal formado con un error que dice qué cambiar", () => {
    expect(validateQuestions(undefined)).toMatchObject({ ok: false });
    expect(validateQuestions([])).toMatchObject({ ok: false });
    expect(validateQuestions([{ question: "¿?" }])).toMatchObject({ ok: false, error: expect.stringMatching(/id/) });
    expect(validateQuestions([{ id: "a", question: " " }])).toMatchObject({ ok: false, error: expect.stringMatching(/question/) });
    expect(validateQuestions([{ id: "a", question: "x" }, { id: "a", question: "y" }])).toMatchObject({
      ok: false,
      error: expect.stringMatching(/unique/),
    });
    expect(validateQuestions([{ id: "a", question: "x", options: [{ description: "sin etiqueta" }] }])).toMatchObject({
      ok: false,
      error: expect.stringMatching(/label/),
    });
    expect(validateQuestions([{ id: "a", question: "x", options: "sí, no" }])).toMatchObject({ ok: false, error: expect.stringMatching(/options/) });
  });

  it("acota lo largo (una pregunta, no un ensayo)", () => {
    const r = validateQuestions([{ id: "a", question: "x".repeat(5000), options: Array.from({ length: 30 }, (_, i) => ({ label: `o${i}` })) }]);
    expect(r.ok && r.questions[0].question.length).toBe(600);
    expect(r.ok && r.questions[0].options?.length).toBe(10);
  });
});

describe("questionText e isQuestionTool", () => {
  it("una pregunta es su texto; varias, una por línea", () => {
    expect(questionText([{ id: "a", question: "¿Uno?" }])).toBe("¿Uno?");
    expect(questionText([{ id: "a", question: "¿Uno?" }, { id: "b", question: "¿Dos?" }])).toBe("¿Uno?\n¿Dos?");
  });

  it("el nombre nuevo y el viejo son la misma herramienta", () => {
    expect(isQuestionTool("ask_user_question")).toBe(true);
    expect(isQuestionTool("preguntar")).toBe(true);
    expect(isQuestionTool("Read")).toBe(false);
  });
});

describe("questionsFrom (lo que llega al chat)", () => {
  it("lee la forma normalizada que manda el servidor (multiSelect), y descarta lo que no vale", () => {
    const qs = [{ id: "dias", question: "¿Qué días?", options: [{ label: "Lunes" }], multiSelect: true }];
    expect(questionsFrom(qs)).toEqual(qs);
    expect(questionsFrom("¿?")).toBeNull();
    expect(questionsFrom([{ question: "sin id" }])).toBeNull();
  });
});

describe("la intención de la pregunta (pieza 7: revisión del plan y consentimiento)", () => {
  const revision = { id: "plan-review", question: "Approve this plan and leave plan mode?", intent: { kind: "plan-review", plan: "# Plan" } };

  it("🔴 el modelo no la puede poner: validateQuestions la quita", () => {
    const r = validateQuestions([revision]);
    expect(r.ok && "intent" in r.questions[0]).toBe(false);
  });

  it("el chat la conserva cuando la manda el servidor con una forma válida", () => {
    expect(questionsFrom([revision])?.[0]?.intent).toEqual({ kind: "plan-review", plan: "# Plan" });
    expect(questionsFrom([{ id: "plan-mode", question: "¿Planear?", intent: { kind: "plan-consent" } }])?.[0]?.intent).toEqual({
      kind: "plan-consent",
    });
  });

  it("una intención mal formada se cae y la pregunta se queda", () => {
    expect(questionsFrom([{ ...revision, intent: { kind: "plan-review", plan: "" } }])?.[0]).toEqual({
      id: "plan-review",
      question: "Approve this plan and leave plan mode?",
    });
    expect(questionsFrom([{ ...revision, intent: { kind: "otra" } }])?.[0]?.intent).toBeUndefined();
  });
});
