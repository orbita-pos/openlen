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

  // Phase 2B: links in her visuals go only to the business's own pages.
  it("what she knows starts with the site's pages", () => {
    expect(knowledgeOf(DATA).split("\n")[0]).toBe("Pages: /, /pedidos (Pedidos)");
    expect(knowledgeOf({ html: '<div id="root"></div>' } as unknown as ProjectData)).toBe("");
  });

  // Final review I6: a members-only page reached anonymous visitors through her.
  it("🔴 a members-only page is neither in what she knows nor in her pages", () => {
    const data = { ...DATA, pages: { ...DATA.pages, socios: { title: "Socios", membersOnly: true, html: "<body><p>Descuento secreto: 40%.</p></body>" } } } as unknown as ProjectData;
    const k = knowledgeOf(data);
    expect(k).not.toContain("Descuento secreto");
    expect(k).not.toContain("/socios");
    expect(k).toContain("/pedidos (Pedidos)");
  });

  it("is capped", () => {
    const big = { html: `<body><p>${"pan ".repeat(20_000)}</p></body>` } as unknown as ProjectData;
    expect(knowledgeOf(big).length).toBeLessThanOrEqual(KNOWLEDGE_MAX);
  });
});

describe("rememberWhatWasPublished", () => {
  it("🔴 saves the text of what was just published — the draft never reaches her — and today's assistant goes off in the same publish", async () => {
    const save = vi.fn(async () => {});
    const switchOldOff = vi.fn(async () => true);
    const at = new Date("2026-11-07T20:00:00Z");
    await rememberWhatWasPublished("p1", DATA, at, { save, switchOldOff, publicData: async () => [] });
    expect(save).toHaveBeenCalledWith("p1", knowledgeOf(DATA), at, []);
    expect(switchOldOff).toHaveBeenCalledWith("p1");
  });

  it("🔴 nothing published for her to know (an app's shell): today's assistant isn't switched off", async () => {
    const save = vi.fn(async () => {});
    const switchOldOff = vi.fn(async () => true);
    await rememberWhatWasPublished("p1", { html: '<div id="root"></div>' } as unknown as ProjectData, new Date(), { save, switchOldOff, publicData: async () => [] });
    expect(save).toHaveBeenCalledWith("p1", "", expect.any(Date), []);
    expect(switchOldOff).not.toHaveBeenCalled();
  });

  it("🔴 an app with public data but no text: saved, and today's assistant switched off", async () => {
    const save = vi.fn(async () => {});
    const switchOldOff = vi.fn(async () => true);
    const tables = [{ name: "huecos", columns: [{ name: "dia", type: "date" }] }];
    await rememberWhatWasPublished("p1", { html: '<div id="root"></div>' } as unknown as ProjectData, new Date(), { save, switchOldOff, publicData: async () => tables });
    expect(save).toHaveBeenCalledWith("p1", "", expect.any(Date), tables);
    expect(switchOldOff).toHaveBeenCalledWith("p1");
  });

  // Final review (Minor 1, re-graded): a failed catalog read at publish wiped what she could read.
  it("🔴 a failed read of the public data keeps what she had: null is passed, not []", async () => {
    const save = vi.fn(async () => {});
    const switchOldOff = vi.fn(async () => true);
    await rememberWhatWasPublished("p1", DATA, new Date(), { save, switchOldOff, publicData: async () => null });
    expect(save).toHaveBeenCalledWith("p1", knowledgeOf(DATA), expect.any(Date), null);
  });

  it("never fails the publish: a save that throws is only logged", async () => {
    const save = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(rememberWhatWasPublished("p1", DATA, new Date(), { save, switchOldOff: async () => true, publicData: async () => [] })).resolves.toBeUndefined();
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
