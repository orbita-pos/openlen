import { describe, expect, it, vi } from "vitest";

import type { FireworksJsonClient, } from "./fireworks-client";
import type { FireworksJsonRequest } from "./fireworks-contracts";
import { fireworksJsonSchema } from "./fireworks-contracts";
import { assessFinalVisualCandidate, finalVisualRejectionReasons, isFinalVisualAcceptance, type FinalVisualVerdict } from "./qwen-visual-critic";

const JPEG = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKmqsrO0tba3uLm6wsLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDq6KKK/os/KgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==";

const verdict = {
  schemaVersion: "fable-visual-verdict/1.0" as const,
  nicheRecognition: 9,
  promptFidelity: 8,
  visualQuality: 8,
  coherence: 8,
  originality: 8,
  mobileQuality: 8,
  wrongNiche: false,
  genericAiStyle: false,
  issues: [],
  decision: "accept" as const,
};

function client(reply: FinalVisualVerdict = verdict) {
  let request: FireworksJsonRequest<unknown> | undefined;
  const value: FireworksJsonClient = {
    async request<T>(candidate: FireworksJsonRequest<T>) {
      request = candidate as FireworksJsonRequest<unknown>;
      return { ok: true as const, value: candidate.responseSchema.parse(reply), modelId: "accounts/fireworks/models/qwen3p7-plus", usage: { inputTokens: 12, cachedTokens: 0, outputTokens: 8, thinkingTokens: 0 }, durationMs: 4, attempts: 1 as const };
    },
  };
  return { value, request: () => request };
}

const input = {
  requestId: "page-final-1",
  brief: { niche: "children_creativity", requiredSignals: ["hand_drawn"], forbiddenSignals: ["saas_dashboard"] },
  screenshots: { desktop: { mimeType: "image/jpeg" as const, dataBase64: JPEG }, mobile: { mimeType: "image/jpeg" as const, dataBase64: JPEG } },
  deterministic: { mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: false },
};

describe("assessFinalVisualCandidate", () => {
  it("sends only the allowlisted brief and actual desktop/mobile images to Qwen", async () => {
    const qwen = client();
    const result = await assessFinalVisualCandidate(input, { client: qwen.value });

    expect(result).toMatchObject({ ok: true, verdict: { decision: "accept", nicheRecognition: 9 } });
    const messages = qwen.request()!.messages;
    expect(messages).toHaveLength(3);
    expect(messages[1]).toMatchObject({ role: "user", content: [{ type: "text", text: expect.stringContaining("children_creativity") }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${JPEG}` } }] });
    expect(messages[2]).toMatchObject({ role: "user", content: [{ type: "text", text: expect.stringContaining("mobile") }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${JPEG}` } }] });
    const desktopParts = messages[1]!.content as readonly [{ type: "text"; text: string }, { type: "image_url"; image_url: { url: string } }];
    const mobileParts = messages[2]!.content as readonly [{ type: "text"; text: string }, { type: "image_url"; image_url: { url: string } }];
    expect([desktopParts[0].text, mobileParts[0].text].join("\n")).not.toMatch(/html|css|https?:|private-copy/i);
  });

  it("infers the fixed verdict version and an empty issue list when Qwen omits only those inert fields", async () => {
    const { schemaVersion: _schemaVersion, issues: _issues, ...equivalent } = verdict;
    const qwen = client(equivalent as FinalVisualVerdict);
    const result = await assessFinalVisualCandidate(input, { client: qwen.value });

    expect(result).toMatchObject({ ok: true, verdict });
    const jsonSchema = fireworksJsonSchema(qwen.request()!.responseSchema) as { required?: string[] };
    expect(jsonSchema.required).not.toContain("schemaVersion");
    expect(jsonSchema.required).not.toContain("issues");
  });

  it("overrides a Qwen accept when a deterministic overflow, typography, or geometry failure exists", async () => {
    const result = await assessFinalVisualCandidate({ ...input, deterministic: { mobileOverflow: true, weakTypographyHierarchy: true, invalidGeometry: true } }, { client: client().value });
    expect(result).toMatchObject({ ok: true, verdict: expect.objectContaining({ decision: "reject", issues: expect.arrayContaining([
      expect.objectContaining({ code: "overflow" }),
      expect.objectContaining({ code: "typography" }),
      expect.objectContaining({ code: "geometry" }),
    ]) }) });
  });

  it("overrides a Qwen accept when text was measured unreadable", async () => {
    // Una captura no distingue "no hay menú" de "el menú está ahí y no se ve":
    // el crítico aprobó una página con la barra entera invisible.
    const result = await assessFinalVisualCandidate({ ...input, deterministic: { ...input.deterministic, unreadableText: true } }, { client: client().value });
    expect(result).toMatchObject({ ok: true, verdict: expect.objectContaining({
      decision: "reject",
      issues: expect.arrayContaining([expect.objectContaining({ code: "contrast", severity: "critical" })]),
    }) });
  });

  it("does not accept wrong-niche, generic, or low-recognition Qwen output", async () => {
    for (const reply of [
      { ...verdict, wrongNiche: true },
      { ...verdict, genericAiStyle: true },
      { ...verdict, nicheRecognition: 6 },
    ]) {
      const result = await assessFinalVisualCandidate(input, { client: client(reply).value });
      expect(result).toMatchObject({ ok: true, verdict: { decision: "reject" } });
    }
  });

  it.each([
    "nicheRecognition",
    "promptFidelity",
    "visualQuality",
    "coherence",
    "originality",
    "mobileQuality",
  ] as const)("rejects an accept verdict when %s is below seven", async (score) => {
    const result = await assessFinalVisualCandidate(input, {
      client: client({ ...verdict, [score]: 1 }).value,
    });

    expect(result).toMatchObject({ ok: true, verdict: { decision: "reject", [score]: 1 } });
  });

  it("rejects any major or critical issue even when Qwen says accept, while allowing minor issues", async () => {
    for (const severity of ["major", "critical"] as const) {
      const result = await assessFinalVisualCandidate(input, {
        client: client({
          ...verdict,
          issues: [{ code: "quality" as const, severity, viewport: "both" as const }],
        }).value,
      });
      expect(result).toMatchObject({ ok: true, verdict: { decision: "reject" } });
    }

    const minor = await assessFinalVisualCandidate(input, {
      client: client({
        ...verdict,
        issues: [{ code: "quality" as const, severity: "minor" as const, viewport: "both" as const }],
      }).value,
    });
    expect(minor).toMatchObject({ ok: true, verdict: { decision: "accept" } });
  });
});

describe("por qué el crítico no firmó", () => {
  it("no da motivos cuando sí firmó", () => {
    expect(finalVisualRejectionReasons(verdict)).toEqual([]);
  });

  // El caso que deja al reparador sin nada que hacer: la página cae por una
  // nota de gusto y el resumen de incidencias que recibe va vacío.
  it("separa una caída por nota de una caída por incidencia", () => {
    const soloNota = finalVisualRejectionReasons({ ...verdict, originality: 6, decision: "repair" });
    expect(soloNota).toContain("score:originality=6");
    expect(soloNota.some((reason) => reason.startsWith("issue:"))).toBe(false);

    const conIncidencia = finalVisualRejectionReasons({
      ...verdict,
      decision: "repair",
      issues: [{ code: "contrast", severity: "critical", viewport: "mobile" }],
    });
    expect(conIncidencia).toContain("issue:contrast:critical");
  });

  it("ignora lo menor, que nunca impidió firmar", () => {
    const reasons = finalVisualRejectionReasons({
      ...verdict,
      coherence: 5,
      decision: "repair",
      issues: [{ code: "typography", severity: "minor", viewport: "desktop" }],
    });
    expect(reasons).toContain("score:coherence=5");
    expect(reasons.some((reason) => reason.includes("typography"))).toBe(false);
  });

  it("nombra las banderas duras", () => {
    const reasons = finalVisualRejectionReasons({ ...verdict, wrongNiche: true, genericAiStyle: true, decision: "reject" });
    expect(reasons).toEqual(expect.arrayContaining(["decision:reject", "flag:wrong_niche", "flag:generic_ai_style"]));
  });
});

// Medido el 2026-08-19: el crítico emitió typography/mobile críticos sobre
// páginas cuyo render midió cero desborde y cero jerarquía débil, y las 31
// páginas guardadas de esas corridas miden sanas. Donde hay instrumento, el
// instrumento manda.
describe("el crítico no vota sobre lo que ya medimos", () => {
  const conIncidencia = (code: string) =>
    ({ ...verdict, decision: "reject" as const, issues: [{ code, severity: "critical", viewport: "both" }] }) as FinalVisualVerdict;

  it.each(["typography", "overflow", "geometry"])("descarta un %s crítico que el render contradice", async (code) => {
    const result = await assessFinalVisualCandidate(input, { client: client(conIncidencia(code)).value });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.verdict.issues).toEqual([]);
    expect(isFinalVisualAcceptance(result.verdict)).toBe(true);
  });

  it("conserva el mismo código cuando la medición lo confirma", async () => {
    const result = await assessFinalVisualCandidate(
      { ...input, deterministic: { mobileOverflow: false, weakTypographyHierarchy: true, invalidGeometry: false } },
      { client: client(conIncidencia("typography")).value },
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.verdict.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "typography" })]));
    expect(isFinalVisualAcceptance(result.verdict)).toBe(false);
  });

  // `contrast` viaja con los NO medidos a propósito: nuestro medidor tiene un
  // punto ciego demostrado con degradados por encima de 0.15 de alfa.
  it.each(["mobile", "originality", "generic_ai", "contrast"])("no toca %s, que nadie mide de forma fiable", async (code) => {
    const result = await assessFinalVisualCandidate(input, { client: client(conIncidencia(code)).value });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.verdict.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
    expect(isFinalVisualAcceptance(result.verdict)).toBe(false);
  });
});

describe("un rechazo tiene que decir su motivo", () => {
  it("no acepta un veto sin fundamento: notas sanas, sin banderas, sin incidencias", () => {
    expect(isFinalVisualAcceptance({ ...verdict, decision: "reject" })).toBe(true);
  });

  it("sigue rechazando cuando el motivo existe", () => {
    expect(isFinalVisualAcceptance({ ...verdict, decision: "reject", originality: 6 })).toBe(false);
    expect(isFinalVisualAcceptance({ ...verdict, decision: "accept", wrongNiche: true })).toBe(false);
    expect(isFinalVisualAcceptance({ ...verdict, decision: "accept", issues: [{ code: "mobile", severity: "critical", viewport: "mobile" }] })).toBe(false);
  });
});
