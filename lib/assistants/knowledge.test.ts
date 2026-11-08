// WHAT SHE KNOWS OF THE BUSINESS (spec local 2026-11-06-asistente-propio, §4.2, §6.4; phase 2A): the published site's
// text, saved when the owner publishes; and what today's assistant was taught, as the start of her memory.
import { describe, expect, it, vi } from "vitest";

import type { ProjectData } from "@/lib/projects/types";

import { KNOWLEDGE_MAX, knowledgeOf, memoryFromOldAssistant, rememberWhatWasPublished } from "./knowledge";

const DATA = {
  html: "<html lang=es><body><h1>Pastelería Canela</h1><p>Martes a domingo, de 9:00 a 19:00.</p></body></html>",
  pages: { pedidos: { title: "Pedidos", html: "<body><p>Escríbenos por WhatsApp.</p></body>" } },
} as unknown as ProjectData;

describe("knowledgeOf", () => {
  it("what she knows is the published site's text", () => {
    const k = knowledgeOf(DATA);
    expect(k).toContain("Pastelería Canela");
    expect(k).toContain("Martes a domingo");
    expect(k).toContain("Escríbenos por WhatsApp.");
    expect(k).not.toContain("<p>");
  });

  it("is capped", () => {
    const big = { html: `<body><p>${"pan ".repeat(20_000)}</p></body>` } as unknown as ProjectData;
    expect(knowledgeOf(big).length).toBeLessThanOrEqual(KNOWLEDGE_MAX);
  });
});

describe("rememberWhatWasPublished", () => {
  it("🔴 saves the text of what was just published — the draft never reaches her", async () => {
    const save = vi.fn(async () => {});
    const at = new Date("2026-11-07T20:00:00Z");
    await rememberWhatWasPublished("p1", DATA, at, save);
    expect(save).toHaveBeenCalledWith("p1", knowledgeOf(DATA), at);
  });

  it("never fails the publish: a save that throws is only logged", async () => {
    const save = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(rememberWhatWasPublished("p1", DATA, new Date(), save)).resolves.toBeUndefined();
  });
});

describe("memoryFromOldAssistant", () => {
  it("creating her in a project whose old assistant had facts starts her memory with them", () => {
    const m = memoryFromOldAssistant({ enabled: true, facts: "Envíos sólo en Guadalajara.\nLos jueves, sin gluten.", tone: "formal" } as never);
    expect(m).toContain("Lo que me enseñaron antes");
    expect(m).toContain("Envíos sólo en Guadalajara.");
    expect(m).toContain("Los jueves, sin gluten.");
    expect(m).toContain("formal");
  });

  it("without old facts her memory starts empty", () => {
    expect(memoryFromOldAssistant(undefined)).toBe("");
    expect(memoryFromOldAssistant({ enabled: true, facts: "   " } as never)).toBe("");
  });
});
