// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const link = "https://app.fireworks.ai/models/fireworks/deepseek-v4p1-flash-1017";
const label = "DeepSeek V4.1 Flash 1017";
const row = (name: string, prices = "$0.30 / $0.006 / $1.20") => "| [" + name + "](" + link + ") | " + prices + " | — |";

// DeepInfra's public models list, as the judge's price is read from it (15/11): Qwen3.8 27B at its list price,
// served by DeepInfra itself (`is_partner: false`).
const QWEN = { model_name: "Qwen/Qwen3.8-27B", type: "text-generation", is_partner: false, pricing: { type: "tokens", cents_per_input_token: 0.00002, cents_per_output_token: 0.00025, rate_per_input_token_cached: 0.25 } };

function check(rows: string[], o: { deepinfraList?: unknown; env?: Record<string, string | undefined> } = {}) {
  // Exercise the real CLI. Every provider call is mocked before it loads; no network or paid calls. The
  // completions endpoints of BOTH providers end in /chat/completions; the requests are recorded on stderr.
  const preload = "globalThis.fetch = async input => { const url = String(input); "
    + "if (url.endsWith('/chat/completions')) { console.error('ASKED ' + url); return new Response('{}'); } "
    + "if (url === 'https://docs.fireworks.ai/serverless/pricing.md') return new Response(" + JSON.stringify(rows.join("\n")) + "); "
    + "if (url === 'https://api.deepinfra.com/models/list') return new Response(" + JSON.stringify(JSON.stringify(o.deepinfraList ?? [QWEN])) + "); "
    + "throw new Error('Unexpected network request: ' + url); };";
  return spawnSync(process.execPath, [
    "--import", "data:text/javascript;base64," + Buffer.from(preload).toString("base64"),
    "--import", pathToFileURL(require.resolve("tsx")).href, "scripts/modelos-comprobar.ts",
  ], { encoding: "utf8", env: { ...process.env, FIREWORKS_API_KEY: "test-only", DEEPINFRA_API_KEY: "test-only", TSX_TSCONFIG_PATH: "tsconfig.eval.json", ...o.env }, timeout: 15_000 });
}

describe("modelos:comprobar asks each provider the policy names (the judge is DeepInfra's, 15/11)", () => {
  it("asks DeepInfra and Fireworks, and checks the judge's price against DeepInfra's public list", () => {
    const r = check([row(label)]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stderr).toContain("ASKED https://api.deepinfra.com/v1/openai/chat/completions");
    expect(r.stderr).toContain("ASKED https://api.fireworks.ai/inference/v1/chat/completions");
    expect(r.stdout).toContain("deepinfra/Qwen/Qwen3.8-27B");
  });
  // 15/11: Qwen3.8-Flash was a partner's model — DeepInfra handed it on, and the partner's moderation refused a
  // customer's page. The judge reads customers' text: it must be served by DeepInfra itself.
  it("a judge DeepInfra hands to a partner is not a pass", () => {
    const r = check([row(label)], { deepinfraList: [{ ...QWEN, is_partner: true }] });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/socio/);
  });
  it("a judge whose list price moved is a drift, not a pass", () => {
    const r = check([row(label)], { deepinfraList: [{ ...QWEN, pricing: { ...QWEN.pricing, cents_per_output_token: 0.0004 } }] });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/salida: nosotros 2\.5, ellos 4\b/);
  });
  it("without DeepInfra's key it is not a pass", () => {
    const r = check([row(label)], { env: { DEEPINFRA_API_KEY: "" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("DEEPINFRA_API_KEY");
  });
});

describe("modelos:comprobar published price selection", () => {
  it("checks the standard row when the same id has Ultra-fast Preview and US rows", () => {
    const r = check([row(label), row(label + " Ultra-fast (Preview)", "$2.40 / $0.048 / $9.60"), row(label + " (US)", "$0.45 / $0.009 / $1.80")]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("cuestan lo que decimos");
  });
  it("never treats an Ultra-fast-only row as standard even when its numbers match", () => {
    expect(check([row(label + " Ultra-fast (Preview)")]).status).toBe(1);
  });
  it("does not guess an unknown variant", () => {
    expect(check([row(label), row(label + " Experimental")]).status).toBe(1);
  });
  it("rejects duplicate standard rows even when their prices match", () => {
    expect(check([row(label), row(label)]).status).toBe(1);
  });
  it("still rejects price drift in the standard row instead of picking a matching variant", () => {
    const r = check([row(label, "$0.31 / $0.006 / $1.20"), row(label + " Ultra-fast (Preview)")]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("entrada: nosotros 0.3, ellos 0.31");
  });
  it("does not treat a regional-only row as standard", () => {
    expect(check([row(label + " (US)")]).status).toBe(1);
  });
});
