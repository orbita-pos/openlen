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

/** What the vision role's streamed call answers (the checker's cable check, 15/11). */
interface Cable {
  readonly content?: string;
  readonly reasoning?: string;
}

function sse(cable: Cable): string {
  const delta = (d: Record<string, unknown>, finish?: string) =>
    "data: " + JSON.stringify({ choices: [{ delta: d, ...(finish ? { finish_reason: finish } : {}) }] }) + "\n\n";
  return (cable.reasoning ? delta({ reasoning_content: cable.reasoning }) : "")
    + delta({ content: cable.content ?? '{"image": true}' }, "stop")
    + "data: " + JSON.stringify({ choices: [], usage: { prompt_tokens: 300, completion_tokens: 6, total_tokens: 306 } }) + "\n\n"
    + "data: [DONE]\n\n";
}

function check(rows: string[], o: { readonly deepinfraList?: unknown; readonly env?: Record<string, string | undefined>; readonly cable?: Cable } = {}) {
  // Exercise the real CLI. Every provider call is mocked before it loads; no network or paid calls. The
  // completions endpoints of BOTH providers end in /chat/completions: the one-token «does it answer» calls get
  // `{}` and are recorded on stderr; the streamed cable call of the vision role gets an SSE answer.
  const preload = "globalThis.fetch = async (input, init) => { const url = String(input); "
    + "if (url.endsWith('/chat/completions')) { if (JSON.parse(String((init && init.body) || '{}')).stream) "
    + "return new Response(" + JSON.stringify(sse(o.cable ?? {})) + "); console.error('ASKED ' + url); return new Response('{}'); } "
    + "if (url === 'https://docs.fireworks.ai/serverless/pricing.md') return new Response(" + JSON.stringify(rows.join("\n")) + "); "
    + "if (url === 'https://api.deepinfra.com/models/list') return new Response(" + JSON.stringify(JSON.stringify(o.deepinfraList ?? [QWEN])) + "); "
    + "throw new Error('Unexpected network request: ' + url); };";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FIREWORKS_API_KEY: "test-only",
    DEEPINFRA_API_KEY: "test-only",
    TSX_TSCONFIG_PATH: "tsconfig.eval.json",
  };
  delete env.OPENLEN_AGENT_PROVIDERS;
  for (const [k, v] of Object.entries(o.env ?? {})) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return spawnSync(process.execPath, [
    "--import", "data:text/javascript;base64," + Buffer.from(preload).toString("base64"),
    "--import", pathToFileURL(require.resolve("tsx")).href, "scripts/modelos-comprobar.ts",
  ], { encoding: "utf8", env, timeout: 15_000 });
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

// The reasoner and the vision role went to DeepInfra with Fireworks behind (15/11): both providers of the vision
// role are asked the request that role really sends — an image, `json_object`, `reasoning_effort: "none"`.
describe("modelos:comprobar checks the vision role's cable on both of its providers (15/11)", () => {
  it("with both keys it asks DeepInfra too and checks the vision role's cable on both", () => {
    const r = check([row(label)]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("ok    deepinfra/deepseek-ai/DeepSeek-V4.1-Flash-1017");
    expect(r.stdout).toContain("ok    deepinfra: ve la imagen, contesta JSON, no piensa");
    expect(r.stdout).toContain("ok    fireworks: ve la imagen, contesta JSON, no piensa");
  });
  it("a provider that does not see the picture breaks the gate", () => {
    const r = check([row(label)], { cable: { content: '{"image": false}' } });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no vio la imagen");
  });
  it("a provider that answers something that is not JSON breaks the gate", () => {
    const r = check([row(label)], { cable: { content: "Yes, there is an image." } });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no dio JSON");
  });
  it("a provider that thinks with `none` breaks the gate: every call of the role would pay for it", () => {
    const r = check([row(label)], { cable: { reasoning: "let me look" } });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("pensó con «reasoning_effort: none»");
  });
});

describe("modelos:comprobar published price selection", () => {
  it("checks the standard row when the same id has Ultra-fast Preview and US rows", () => {
    const r = check([row(label), row(label + " Ultra-fast (Preview)", "$2.40 / $0.048 / $9.60"), row(label + " (US)", "$0.45 / $0.009 / $1.80")]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("cuestan lo que decimos");
  });
  // 23/11: Fireworks added a Flex row for the same id (half price, selected per request); our client never asks
  // for Flex (it sends standard, or Priority when asked), so the page as it was that day must pass.
  it("checks the standard row when the same id also has a Flex row (the page of 23/11)", () => {
    const r = check([
      row(label),
      row(label + " Flex", "$0.15 / $0.003 / $0.60"),
      row(label + " Ultra-fast (Preview)", "$1.20 / $0.024 / $4.80"),
      row(label + " (US)", "$0.45 / $0.009 / $1.80"),
    ]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("cuestan lo que decimos");
  });
  it("never treats a Flex-only row as standard even when its numbers match", () => {
    expect(check([row(label + " Flex")]).status).toBe(1);
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
