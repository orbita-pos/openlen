// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { InvocationRecord } from "./gateway";
import { functionCallsReport } from "./invocation-report";

const base: InvocationRecord = { projectId: "p", environment: "draft", name: "checkout", status: 200, errorCode: null, ms: 340, logs: [], error: null, startedAt: new Date() };

describe("functionCallsReport", () => {
  it("nada si no hubo llamadas", () => {
    expect(functionCallsReport([])).toBeNull();
  });

  it("cada llamada con su estado, su error en SU fichero y sus registros", () => {
    const r = functionCallsReport([
      { ...base, status: 500, errorCode: "WORKER_ERROR", ms: 812, logs: [{ level: "log", msg: "creando sesión" }], error: "TypeError: Cannot read properties of undefined (reading 'price')\n    at handler (supabase/functions/checkout/index.ts:14:22)" },
      base,
    ]);
    expect(r).toBe(
      [
        "Edge Function calls during this visit (draft):",
        "- checkout → 500 WORKER_ERROR (812 ms)",
        "  error: TypeError: Cannot read properties of undefined (reading 'price')",
        "      at handler (supabase/functions/checkout/index.ts:14:22)",
        "  log: creando sesión",
        "- checkout → 200 (340 ms)",
      ].join("\n"),
    );
  });

  it("sólo las 10 últimas, diciendo cuántas se quedan fuera", () => {
    const r = functionCallsReport(Array.from({ length: 12 }, (_, i) => ({ ...base, name: `f${i}` })))!;
    expect(r.split("\n")[1]).toBe("(2 earlier calls not shown)");
    expect(r).not.toContain("- f1 ");
    expect(r).toContain("- f11 ");
  });
});
