import { describe, expect, it } from "vitest";

import { agentBlockedText, buildView, ENDING_FOR_LEN, findingLineForAgent } from "./view";
import type { Finding, ReviewRecord } from "./types";

const rule = (key: string, severity: "HIGH" | "MEDIUM", category: string, params: Record<string, string>, file: string | null = null, line: number | null = null): Finding =>
  ({ key, source: "rule", severity, category, file, line, description: "", exploitScenario: "", recommendation: "", params });
const model = (key: string, severity: "HIGH" | "MEDIUM"): Finding =>
  ({ key, source: "model", severity, category: "missing_webhook_signature", file: "/supabase/functions/w/index.ts", line: 12, description: "No comprueba la firma", exploitScenario: "e", recommendation: "Verifica la firma" });
const record = (over: Partial<ReviewRecord>): ReviewRecord => ({
  projectId: "p", fingerprint: "f".repeat(64), status: "done", phase0: [], findings: [], fileHashes: {}, costCentiCredits: 0, failReason: null,
  startedAt: new Date(), finishedAt: null, shownToAgentAt: null, acceptedBy: null, acceptedAt: null, publishedAt: null, ...over,
});

const rls = rule("rls_disabled:public.productos", "HIGH", "rls_disabled", { table: "productos" });
const test = rule("test_secret_in_client:/js/p.js:stripe", "MEDIUM", "test_secret_in_client", { provider: "Stripe" }, "/js/p.js", 4);

describe("buildView", () => {
  it("HIGH not accepted blocks, MEDIUM is shown, accepted goes apart", () => {
    const m = model("model:missing_webhook_signature:/supabase/functions/w/index.ts", "HIGH");
    const v = buildView(record({ phase0: [rls, test], findings: [m] }), new Map([[rls.key, rls]]));
    expect(v).toEqual({ fingerprint: "f".repeat(64), status: "done", blocking: [m], medium: [test], accepted: [rls] });
  });

  it("the model's findings count only once its review is done; the rules always count", () => {
    const m = model("m", "HIGH");
    for (const status of ["running", "failed", "skipped_budget", "skipped_scope"] as const) {
      expect(buildView(record({ status, phase0: [rls], findings: [m] }), new Map()).blocking).toEqual([rls]);
    }
  });
});

describe("what Len reads", () => {
  it("one line per rule, in English, without any secret", () => {
    expect(findingLineForAgent(rls)).toMatch(/^\[rls_disabled\] Table public\.productos has Row Level Security off/);
    expect(findingLineForAgent(rule("k", "HIGH", "policy_open_write", { table: "pedidos", policy: "edita", command: "UPDATE" }))).toContain('Policy "edita" on pedidos lets anyone, signed in or not, change its rows');
    expect(findingLineForAgent(rule("k", "HIGH", "secret_in_client", { provider: "Stripe", variable: "VITE_PAGOS" }))).toContain("A Stripe secret key reaches the browser in the variable VITE_PAGOS");
    expect(findingLineForAgent(test)).toContain("/js/p.js:4");
    expect(findingLineForAgent(model("k", "HIGH"))).toBe("[missing_webhook_signature] /supabase/functions/w/index.ts:12 — No comprueba la firma Fix: Verifica la firma");
  });

  it("the blocked text counts, numbers and ends with what to do", () => {
    const v = buildView(record({ phase0: [rls] }), new Map());
    const text = agentBlockedText(v, ENDING_FOR_LEN);
    expect(text.split("\n")[0]).toBe("Security review found 1 high-severity issue (nothing was published):");
    expect(text).toContain("1. [rls_disabled]");
    expect(text.endsWith(ENDING_FOR_LEN)).toBe(true);
    const two = buildView(record({ phase0: [rls, rule("rls_disabled:public.b", "HIGH", "rls_disabled", { table: "b" })] }), new Map());
    expect(agentBlockedText(two, ENDING_FOR_LEN).split("\n")[0]).toBe("Security review found 2 high-severity issues (nothing was published):");
  });
});
