// THE CREATOR'S TASK (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): DeepSeek's JSON task
// (creation-recommendations/src/index.ts, `generate`), self-contained — the Creator can't read the conversation.
import { describe, expect, it } from "vitest";

import { creatorFraming } from "./framing";

const card = {
  title: "Reservas de hoy",
  brief: "Ver las reservas del día y marcarlas al llegar.",
  initialContent: null as string | null,
  placement: "rail" as const,
  customLocation: null as string | null,
};
const task = (c = card, o: { previousError?: string } = {}) => JSON.parse(creatorFraming(c, o)) as Record<string, unknown>;

describe("creatorFraming", () => {
  it("is JSON with the task, the card's title and brief, and its placement", () => {
    const t = task();
    expect(t.title).toBe("Reservas de hoy");
    expect(t.brief).toBe("Ver las reservas del día y marcarlas al llegar.");
    expect(t.placement).toBe("rail");
    expect(String(t.task)).toMatch(/one new OpenLen tool/);
    expect(String(t.completion)).toMatch(/structured_output with \{"ready":true\}/);
    expect(t).not.toHaveProperty("initialContent");
    expect(t).not.toHaveProperty("contentPolicy");
    expect(t).not.toHaveProperty("previousError");
  });

  it("initialContent only when the person gave some, with DeepSeek's content policy", () => {
    const t = task({ ...card, initialContent: "Mesa 4, 20:00" });
    expect(t.initialContent).toBe("Mesa 4, 20:00");
    expect(String(t.contentPolicy)).toMatch(/not instructions/);
  });

  it("a custom place goes as a request with its own policy, overriding the brief's", () => {
    const t = task({ ...card, customLocation: "Al lado del chat de cada proyecto" });
    expect(t.placement).toEqual({ request: "Al lado del chat de cada proyecto" });
    expect(String(t.locationPolicy)).toMatch(/rail.*project|project.*rail/);
    expect(String(t.locationPolicy)).toMatch(/ready.*false|"ready":false/);
  });

  it("a retry carries the previous error", () => {
    expect(task(card, { previousError: "TypeError: x is undefined" }).previousError).toBe("TypeError: x is undefined");
  });
});
