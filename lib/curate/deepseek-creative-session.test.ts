import { describe, expect, it, vi } from "vitest";

import type { FireworksToolClient, FireworksToolTurnResult } from "@/lib/ai/fireworks-tool-client";
import type { SafeCreativeCandidate } from "./creative-baseline";
import type { CreativeSandbox } from "./creative-sandbox";
import type { CreativeToolResult } from "./creative-sandbox-contracts";
import { runDeepSeekCreativeSession } from "./deepseek-creative-session";
import { SESSION_TURN_CEILING, effortProfile } from "./page-effort";

const BASELINE: SafeCreativeCandidate = {
  html: "<!doctype html><html><body><section data-openlen-edit-id=\"ol-hero-1\">base</section></body></html>",
  title: "Marca",
  visualEngine: { route: "section_composition", templateId: null } as never,
  filled: true,
  appliedOps: 3,
  source: "baseline",
};

const INPUT = { requestId: "page-1", baseline: BASELINE, brief: "Una página de terror con estética VHS" };

function ok(calls: { id: string; name: string; arguments: unknown }[], content = ""): FireworksToolTurnResult {
  return {
    ok: true,
    calls: calls as never,
    content,
    reasoningContent: null,
    usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 20, thinkingTokens: 0 },
    durationMs: 5,
    modelId: "deepseek",
  };
}

function makeSandbox(over: { applyPatch?: CreativeSandbox["applyPatch"] } = {}) {
  let current = BASELINE;
  const sandbox: CreativeSandbox = {
    current: () => current,
    inspect: () => ({ outline: [{ targetId: "ol-hero-1", role: "hero", tag: "section", textPreview: "base" }], imageSlots: [], pageCssBytes: 0, diagnostics: null }),
    applyPatch: over.applyPatch ?? (async () => {
      current = { ...current, html: `${current.html}<!--patched-->`, source: "deepseek" };
      return { ok: true, warnings: [] } as CreativeToolResult;
    }),
    adopt: async (candidate) => {
      current = { ...candidate, source: "deepseek" };
      return { ok: true, warnings: [] } as CreativeToolResult;
    },
    renderPreview: async () => ({ ok: true, warnings: ["mobileOverflow=false"] }),
  };
  return sandbox;
}

function clientReturning(...turns: FireworksToolTurnResult[]): { client: FireworksToolClient; seen: unknown[][] } {
  const seen: unknown[][] = [];
  let index = 0;
  return {
    seen,
    client: {
      async turn(request) {
        seen.push([...request.messages]);
        return turns[Math.min(index++, turns.length - 1)];
      },
    },
  };
}

const PATCH_CALL = { id: "c1", name: "apply_creative_patch", arguments: { operations: [{ op: "replace_section", targetId: "ol-hero-1", html: "<section>x</section>" }] } };

describe("finite DeepSeek creative session", () => {
  it("stops when the model returns no tool calls", async () => {
    const { client } = clientReturning(ok([], "Listo."));
    const result = await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox() });
    expect(result).toMatchObject({ changed: false, acceptedMutations: 0, stoppedBy: "finished" });
    expect(result.candidate).toEqual(BASELINE);
  });

  it("runs sequential tools and keeps the improved candidate", async () => {
    const { client } = clientReturning(
      ok([{ id: "c0", name: "inspect_canvas", arguments: {} }]),
      ok([PATCH_CALL]),
      ok([], "done"),
    );
    const result = await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox() });
    expect(result.changed).toBe(true);
    expect(result.acceptedMutations).toBe(1);
    expect(result.candidate.html).toContain("patched");
    expect(result.stoppedBy).toBe("finished");
  });

  it.each(["timeout", "provider", "invalid_tool_call", "http", "missing_key", "budget_exceeded"] as const)(
    "returns lastKnownGood on %s and says which one stopped it", async (code) => {
      const { client } = clientReturning({ ok: false, code, durationMs: 1, modelId: "deepseek" });
      const result = await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox() });
      expect(result.candidate).toEqual(BASELINE);
      expect(result.changed).toBe(false);
      expect(result.stoppedBy).toBe(code === "budget_exceeded" ? "budget" : code);
    },
  );

  it("keeps mutations already accepted when a later turn fails", async () => {
    const { client } = clientReturning(ok([PATCH_CALL]), { ok: false, code: "timeout", durationMs: 1, modelId: "deepseek" });
    const result = await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox() });
    expect(result.changed).toBe(true);
    expect(result.candidate.html).toContain("patched");
    expect(result.stoppedBy).toBe("timeout");
  });

  it("sin pedir nada, corre los cuatro turnos del nivel de siempre", async () => {
    const { client, seen } = clientReturning(ok([{ id: "c0", name: "inspect_canvas", arguments: {} }]));
    const result = await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox() });
    expect(seen).toHaveLength(4);
    expect(result.stoppedBy).toBe("turn_limit");
  });

  it("honours a one-turn repair session", async () => {
    const { client, seen } = clientReturning(ok([{ id: "c0", name: "inspect_canvas", arguments: {} }]));
    const result = await runDeepSeekCreativeSession({ ...INPUT, maxTurns: 1 }, { client, sandbox: makeSandbox() });
    expect(seen).toHaveLength(1);
    expect(result.stoppedBy).toBe("turn_limit");
  });

  it("un nivel más caro compra más turnos", async () => {
    const { client, seen } = clientReturning(ok([{ id: "c0", name: "inspect_canvas", arguments: {} }]));
    const turns = effortProfile("high").sessionTurns;
    const result = await runDeepSeekCreativeSession({ ...INPUT, maxTurns: turns }, { client, sandbox: makeSandbox() });
    expect(seen).toHaveLength(turns);
    expect(result.stoppedBy).toBe("turn_limit");
  });

  // El techo no es decoración: quien llama viene de una petición HTTP, y sin
  // esto un cuerpo con `maxTurns: 500` compraría quinientos turnos pagados.
  it("no se pueden pedir más turnos de los que compra el nivel más caro", async () => {
    const { client, seen } = clientReturning(ok([{ id: "c0", name: "inspect_canvas", arguments: {} }]));
    await runDeepSeekCreativeSession({ ...INPUT, maxTurns: 500 }, { client, sandbox: makeSandbox() });
    expect(seen).toHaveLength(SESSION_TURN_CEILING);
  });

  it("ni menos de un turno", async () => {
    const { client, seen } = clientReturning(ok([{ id: "c0", name: "inspect_canvas", arguments: {} }]));
    await runDeepSeekCreativeSession({ ...INPUT, maxTurns: 0 }, { client, sandbox: makeSandbox() });
    expect(seen).toHaveLength(1);
  });

  it("un nivel más caro también compra más operaciones aceptadas", async () => {
    const many = {
      id: "c1",
      name: "apply_creative_patch",
      arguments: { operations: Array.from({ length: 6 }, () => ({ op: "replace_section", targetId: "ol-hero-1", html: "<section>x</section>" })) },
    };
    const { client } = clientReturning(...Array.from({ length: 5 }, () => ok([many])));
    const result = await runDeepSeekCreativeSession(
      { ...INPUT, maxTurns: 5, maxAcceptedMutations: effortProfile("high").acceptedMutations },
      { client, sandbox: makeSandbox() },
    );
    expect(result.acceptedMutations).toBe(effortProfile("high").acceptedMutations);
    expect(result.stoppedBy).toBe("tool_limit");
  });

  it("stops at twelve accepted mutations", async () => {
    const many = {
      id: "c1",
      name: "apply_creative_patch",
      arguments: { operations: Array.from({ length: 6 }, () => ({ op: "replace_section", targetId: "ol-hero-1", html: "<section>x</section>" })) },
    };
    const { client } = clientReturning(ok([many]), ok([many]), ok([many]));
    const result = await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox() });
    expect(result.acceptedMutations).toBe(12);
    expect(result.stoppedBy).toBe("tool_limit");
  });

  it("treats a rejected patch as an observation and keeps going", async () => {
    const applyPatch = vi.fn(async () => ({ ok: false as const, code: "render_failed" as const }));
    const { client } = clientReturning(ok([PATCH_CALL]), ok([], "ok"));
    const result = await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox({ applyPatch }) });
    expect(result.stoppedBy).toBe("finished");
    expect(result.changed).toBe(false);
    expect(result.candidate).toEqual(BASELINE);
    // Without this, a session that designed nothing and one whose every patch
    // was refused are the same empty result.
    expect(result.rejections).toEqual(["render_failed"]);
  });

  it("carries the refusal detail so the reason survives the session", async () => {
    const applyPatch = vi.fn(async () => ({ ok: false as const, code: "unsafe_css" as const, detail: "css_external_fetch" }));
    const { client } = clientReturning(ok([PATCH_CALL]), ok([], "done"));
    const result = await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox({ applyPatch }) });
    expect(result.rejections).toEqual(["unsafe_css:css_external_fetch"]);
  });

  it("reports each distinct tool refusal once", async () => {
    const codes = ["unknown_target", "unknown_target", "sanitization_failed"] as const;
    let index = 0;
    const applyPatch = vi.fn(async () => ({ ok: false as const, code: codes[Math.min(index++, codes.length - 1)] }));
    const { client } = clientReturning(ok([PATCH_CALL]), ok([PATCH_CALL]), ok([PATCH_CALL]), ok([], "done"));
    const result = await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox({ applyPatch }) });
    expect(result.rejections).toEqual(["unknown_target", "sanitization_failed"]);
  });

  it("feeds tool results back without raw page HTML or URLs", async () => {
    const { client, seen } = clientReturning(ok([PATCH_CALL]), ok([], "done"));
    await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox() });
    const secondTurn = JSON.stringify(seen[1]);
    expect(secondTurn).not.toContain("<!doctype html");
    expect(secondTurn).not.toMatch(/https?:\/\//);
  });

  it("reports an unavailable image tool as a tool error instead of crashing", async () => {
    const { client } = clientReturning(
      ok([{ id: "c2", name: "request_image", arguments: { targetId: "ol-hero-1", subject: "niebla" } }]),
      ok([], "done"),
    );
    const result = await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox() });
    expect(result.stoppedBy).toBe("finished");
    expect(result.candidate).toEqual(BASELINE);
  });

  it("raises the output ceiling once when the ceiling itself ended the turn", async () => {
    const ceilings: number[] = [];
    const turns: FireworksToolTurnResult[] = [
      { ok: false, code: "provider", providerCategory: "response_truncated", durationMs: 1, modelId: "deepseek" },
      ok([PATCH_CALL]),
      ok([], "done"),
    ];
    let index = 0;
    const client: FireworksToolClient = {
      async turn(request) {
        ceilings.push(request.maxOutputTokens);
        return turns[Math.min(index++, turns.length - 1)];
      },
    };

    const result = await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox() });

    expect(ceilings[1]).toBeGreaterThan(ceilings[0]);
    expect(result.changed).toBe(true);
    expect(result.stoppedBy).toBe("finished");
  });

  it("stops when the raised ceiling truncates too", async () => {
    const { client, seen } = clientReturning(
      { ok: false, code: "provider", providerCategory: "response_truncated", durationMs: 1, modelId: "deepseek" },
    );
    const result = await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox() });
    expect(seen).toHaveLength(2);
    expect(result.stoppedBy).toBe("provider");
    expect(result.changed).toBe(false);
  });

  it("hands the model the canvas with the brief so no turn is spent finding handles", async () => {
    const { client, seen } = clientReturning(ok([PATCH_CALL]), ok([], "done"));
    await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox() });
    const opening = JSON.stringify(seen[0]);
    // A session that has to ask for its own targets spends turns looking, and
    // a four-turn session that looks four times never designs anything.
    expect(opening).toContain("ol-hero-1");
    expect(opening).toContain("hero");
    expect(opening).not.toContain("<!doctype html");
  });

  it("tells the model how many turns it actually has", async () => {
    const { client, seen } = clientReturning(ok([], "done"));
    await runDeepSeekCreativeSession({ ...INPUT, maxTurns: 1 }, { client, sandbox: makeSandbox() });
    expect(JSON.stringify(seen[0])).toContain("1");
  });

  it("records every paid turn through the telemetry sink", async () => {
    const recordModel = vi.fn();
    const { client } = clientReturning(ok([PATCH_CALL]), ok([], "done"));
    await runDeepSeekCreativeSession(INPUT, { client, sandbox: makeSandbox(), recordModel });
    expect(recordModel).toHaveBeenCalledTimes(2);
    expect(recordModel.mock.calls[0][0]).toBe("creative_session");
  });
});
