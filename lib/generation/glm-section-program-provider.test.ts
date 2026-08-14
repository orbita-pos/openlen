import { describe, expect, it, vi } from "vitest";

import type { FireworksJsonClient } from "../ai/fireworks-client";
import type { FireworksJsonRequest, FireworksJsonResult } from "../ai/fireworks-contracts";
import { sha256 } from "./content-hash";
import {
  createGlmSectionProgramProvider,
  type GlmSectionProgramRequest,
} from "./glm-section-program-provider";

const USAGE = { inputTokens: 20, cachedTokens: 2, outputTokens: 10, thinkingTokens: 4 };

const PROGRAM = {
  schemaVersion: "expressive-section-program/1.0" as const,
  role: "hero" as const,
  root: {
    kind: "layout" as const, id: "root", preset: "split" as const, gap: "md" as const, padding: "lg" as const,
    width: "wide" as const, align: "center" as const, justify: "between" as const, columns: "asymmetric_left" as const,
    color: "surface" as const, radius: "lg" as const, border: "hairline" as const, transform: "none" as const, blend: "normal" as const,
    children: [
      { kind: "copy" as const, id: "title", variant: "heading" as const, copyKey: "hero.title", tone: "strong" as const, size: "display" as const, color: "ink" as const, align: "start" as const },
      { kind: "media" as const, id: "visual", slotIndex: 0, aspect: "cinematic" as const, fit: "cover" as const, treatment: "film" as const, radius: "lg" as const, transform: "tilt_right" as const },
    ],
  },
  responsive: { mobile: [{ nodeId: "root", preset: "stack" as const, columns: "one" as const, gap: "sm" as const, padding: "sm" as const, hidden: false }] },
  motion: [{ nodeId: "title", preset: "reveal" as const, intensity: "medium" as const, delay: "short" as const }],
};

const BASE_REQUEST = {
  requestId: "page-1.section-0",
  ordinal: 0,
  role: "hero" as const,
  direction: {
    rhythm: "cinematic" as const,
    requiredSignals: ["cinematic_darkness"],
    forbiddenSignals: ["corporate_dashboard"],
  },
  copyKeys: ["hero.title"],
  assetSlots: [{ slotIndex: 0, mediaType: "photo" as const }],
};

function clientWith<T>(result: FireworksJsonResult<T>) {
  const calls: FireworksJsonRequest<unknown>[] = [];
  const client: FireworksJsonClient = {
    async request<R>(request: FireworksJsonRequest<R>): Promise<FireworksJsonResult<R>> {
      calls.push(request as FireworksJsonRequest<unknown>);
      return result as FireworksJsonResult<R>;
    },
  };
  return { client, calls };
}

function generateRequest(): GlmSectionProgramRequest {
  return { ...BASE_REQUEST, mode: "generate" };
}

function rebuildRequest(html: string): GlmSectionProgramRequest {
  return {
    ...BASE_REQUEST,
    mode: "rebuild",
    inspiration: {
      candidateId: "chosen-hero",
      sourceTemplateId: "donor-one",
      sourceBandOrdinal: 3,
      sourceContentHash: sha256(html).replace(/^sha256:/, "").slice(0, 12),
      sourceStructuralFingerprint: `sha256:${"b".repeat(64)}`,
      usefulTraits: ["cinematic", "layered"],
    },
  } as unknown as GlmSectionProgramRequest;
}

describe("GLM expressive section provider", () => {
  it("requests generate once with no donor material and the strict designer policy", async () => {
    const fake = clientWith({ ok: true, value: PROGRAM, modelId: "accounts/fireworks/models/glm-5p2", usage: USAGE, durationMs: 9, attempts: 1 });
    const result = await createGlmSectionProgramProvider({ client: fake.client }).generate(generateRequest());
    expect(result).toMatchObject({ ok: true, program: PROGRAM, promptVersion: "glm-section-program-prompt/1.0", usage: USAGE, attempts: 1 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ role: "designer", reasoningEffort: "high", maxOutputTokens: 8192, requestId: "page-1.section-0" });
    const payload = JSON.parse(String(fake.calls[0].messages[1].content));
    expect(payload).toMatchObject({ mode: "generate", role: "hero", ordinal: 0 });
    expect(payload).not.toHaveProperty("inspiration");
    expect(JSON.stringify(payload)).not.toMatch(/candidate|fragment|template|sourceContent|sourceStructural|https?:|<script/i);
  });

  it("gives Fireworks the exact role, copy keys, and asset slots it must generate", async () => {
    const fake = clientWith({ ok: true, value: PROGRAM, modelId: "accounts/fireworks/models/glm-5p2", usage: USAGE, durationMs: 9, attempts: 1 });
    await createGlmSectionProgramProvider({ client: fake.client }).generate(generateRequest());

    const responseSchema = fake.calls[0].responseSchema;
    expect(responseSchema.safeParse(PROGRAM).success).toBe(true);
    expect(responseSchema.safeParse({ ...PROGRAM, role: "footer" }).success).toBe(false);
    expect(responseSchema.safeParse({
      ...PROGRAM,
      root: { ...PROGRAM.root, children: [{ ...PROGRAM.root.children[0], copyKey: "private.copy" }, PROGRAM.root.children[1]] },
    }).success).toBe(false);
    expect(responseSchema.safeParse({
      ...PROGRAM,
      root: { ...PROGRAM.root, children: [PROGRAM.root.children[0], { ...PROGRAM.root.children[1], slotIndex: 9 }] },
    }).success).toBe(false);
  });

  it("normalizes omitted empty responsive and motion containers before strict compilation", async () => {
    const emptyProgram = { ...PROGRAM, responsive: { mobile: [] }, motion: [] };
    const fake = clientWith({ ok: true, value: emptyProgram, modelId: "accounts/fireworks/models/glm-5p2", usage: USAGE, durationMs: 9, attempts: 1 });
    await createGlmSectionProgramProvider({ client: fake.client }).generate(generateRequest());
    const responseSchema = fake.calls[0].responseSchema;
    const { responsive: _responsive, motion: _motion, ...withoutEmptyContainers } = emptyProgram;

    expect(responseSchema.parse(withoutEmptyContainers)).toEqual(emptyProgram);
    expect(responseSchema.parse({ ...withoutEmptyContainers, responsive: [] })).toEqual(emptyProgram);
    expect(responseSchema.safeParse({ ...withoutEmptyContainers, responsive: ["unexpected"] }).success).toBe(false);
  });

  it("sends only immutable donor metadata and never donor HTML or visible copy", async () => {
    const html = '<style>[data-sec="chosen-hero"] .secret{color:red}</style><section data-sec="chosen-hero" class="secret"><h2>DONOR COPY SECRET</h2><img src="https://private.invalid/a.jpg" alt="COPY ALT"><div><p>More copy</p></div></section>';
    const fake = clientWith({ ok: true, value: PROGRAM, modelId: "accounts/fireworks/models/glm-5p2", usage: USAGE, durationMs: 9, attempts: 1 });
    const result = await createGlmSectionProgramProvider({ client: fake.client }).generate(rebuildRequest(html));
    expect(result).toMatchObject({ ok: true, program: PROGRAM });
    expect(fake.calls).toHaveLength(1);
    const payload = JSON.parse(String(fake.calls[0].messages[1].content));
    expect(payload.inspiration).toMatchObject({
      candidateId: "chosen-hero", sourceTemplateId: "donor-one", sourceBandOrdinal: 3,
      usefulTraits: ["cinematic", "layered"],
      sourceContentHash: sha256(html).replace(/^sha256:/, "").slice(0, 12),
      sourceStructuralFingerprint: `sha256:${"b".repeat(64)}`,
    });
    expect(JSON.stringify(payload)).not.toMatch(/fragment|structure|verifiedFragmentHtml|DONOR COPY SECRET|More copy|COPY ALT|private\.invalid|https?:|src=|alt=|class=|data-sec|<style|\[data-sec|color:red/i);
  });

  it("rejects any attempt to add donor bytes to the metadata-only rebuild contract", async () => {
    const fake = clientWith({ ok: true, value: PROGRAM, modelId: "accounts/fireworks/models/glm-5p2", usage: USAGE, durationMs: 9, attempts: 1 });
    const provider = createGlmSectionProgramProvider({ client: fake.client });
    const valid = '<section data-sec="chosen-hero"><h2>copy</h2></section>';
    const bad = [
      { ...rebuildRequest(valid), inspiration: { ...(rebuildRequest(valid) as Extract<GlmSectionProgramRequest, { mode: "rebuild" }>).inspiration, verifiedFragmentHtml: valid } },
      { ...rebuildRequest(valid), inspiration: { ...(rebuildRequest(valid) as Extract<GlmSectionProgramRequest, { mode: "rebuild" }>).inspiration, fragment: "<section><h2></h2></section>" } },
      { ...rebuildRequest(valid), inspiration: { ...(rebuildRequest(valid) as Extract<GlmSectionProgramRequest, { mode: "rebuild" }>).inspiration, donorVisibleText: "copy" } },
      { ...generateRequest(), inspiration: (rebuildRequest(valid) as Extract<GlmSectionProgramRequest, { mode: "rebuild" }>).inspiration },
    ];
    for (const request of bad) {
      await expect(provider.generate(request as GlmSectionProgramRequest)).resolves.toEqual({ ok: false, code: "invalid_input", promptVersion: "glm-section-program-prompt/1.0" });
    }
    expect(fake.calls).toHaveLength(0);
  });

  it.each(["invalid_json", "schema", "provider"] as const)("preserves redacted usage on %s failure without a local retry", async (code) => {
    const fake = clientWith({ ok: false, code, modelId: "accounts/fireworks/models/glm-5p2", usage: USAGE, durationMs: 11, attempts: 1 });
    const result = await createGlmSectionProgramProvider({ client: fake.client }).generate(generateRequest());
    expect(result).toMatchObject({ ok: false, code, modelId: "accounts/fireworks/models/glm-5p2", usage: USAGE, durationMs: 11, attempts: 1 });
    expect(JSON.stringify(result)).not.toMatch(/fragment|copy value|raw response/i);
    expect(fake.calls).toHaveLength(1);
  });

  it("revalidates role and allowlists even if a client double claims success", async () => {
    const mutations = [
      { ...PROGRAM, role: "footer" as const },
      { ...PROGRAM, root: { ...PROGRAM.root, children: [{ ...PROGRAM.root.children[0], copyKey: "private.copy" }, PROGRAM.root.children[1]] } },
      { ...PROGRAM, root: { ...PROGRAM.root, children: [PROGRAM.root.children[0], { ...PROGRAM.root.children[1], slotIndex: 9 }] } },
    ];
    for (const mutation of mutations) {
      const fake = clientWith({ ok: true, value: mutation, modelId: "accounts/fireworks/models/glm-5p2", usage: USAGE, durationMs: 7, attempts: 1 });
      await expect(createGlmSectionProgramProvider({ client: fake.client }).generate(generateRequest()))
        .resolves.toMatchObject({ ok: false, code: "schema", usage: USAGE, attempts: 1 });
    }
  });
});
