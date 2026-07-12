// El bake debe correr DESPUÉS del sanitizer: si corriera antes, el sanitizer
// borraría su <script> y las conductas nacerían muertas en producción. Se
// demuestra con el sanitizer REAL, no con un mock.
//
// node:test, not vitest — this exercises the native @/lib/html-engine (Rust)
// binding via sanitizeForPublish, which vitest's jsdom environment can't
// load. See vitest.config.ts's NB comment on lib/agent for the split; this
// file lives in lib/publish/ (listed file-by-file in vitest.config.ts, not
// globbed) so it can't get swept up by the lib/behaviors/**/*.test.ts glob.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bakeBehaviors } from "@/lib/behaviors/build";
import { sanitizeForPublish } from "@/lib/html-engine";
import type { Behavior, BehaviorName } from "@/lib/behaviors/types";

const REG = {
  countdown: {
    name: "countdown", marker: "data-ol-countdown", js: "/*CD*/", budgetBytes: 700,
    schema: { root: { kind: "isoDate" } },
    degradation: "control-inert", a11y: [], status: "stable",
    doc: { when: "", whenNot: "", example: "" },
  },
} as unknown as Partial<Record<BehaviorName, Behavior>>;
const ORDER: BehaviorName[] = ["countdown"];
const DOC = `<!doctype html><html><body><div data-ol-countdown="2026-08-15T20:00Z"></div></body></html>`;

describe("orden en el pipeline", () => {
  it("el markup data-ol-* sobrevive al sanitizer (no es on*, ni script, ni URL peligrosa)", () => {
    assert.ok(sanitizeForPublish(DOC).html!.includes("data-ol-countdown"));
  });

  it("el script del bake SÍ seria borrado si el bake corriera ANTES del sanitizer", () => {
    const baked = bakeBehaviors(DOC, REG, ORDER);
    assert.ok(baked.includes("/*CD*/"));
    // La prueba de por qué el orden del pipeline importa:
    assert.ok(!sanitizeForPublish(baked).html!.includes("/*CD*/"));
  });
});
