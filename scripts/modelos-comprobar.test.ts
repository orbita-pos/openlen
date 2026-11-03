// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const link = "https://app.fireworks.ai/models/fireworks/deepseek-v4p1-flash-1017";
const label = "DeepSeek V4.1 Flash 1017";
const row = (name: string, prices = "$0.30 / $0.006 / $1.20") => "| [" + name + "](" + link + ") | " + prices + " | — |";

function check(rows: string[]) {
  // Exercise the real CLI. Both provider calls are mocked before it loads; no network or paid calls.
  const preload = "globalThis.fetch = async input => { const url = String(input); "
    + "if (url.endsWith('/chat/completions')) return new Response('{}'); "
    + "if (url === 'https://docs.fireworks.ai/serverless/pricing.md') return new Response(" + JSON.stringify(rows.join("\n")) + "); "
    + "throw new Error('Unexpected network request: ' + url); };";
  return spawnSync(process.execPath, [
    "--import", "data:text/javascript;base64," + Buffer.from(preload).toString("base64"),
    "--import", pathToFileURL(require.resolve("tsx")).href, "scripts/modelos-comprobar.ts",
  ], { encoding: "utf8", env: { ...process.env, FIREWORKS_API_KEY: "test-only", TSX_TSCONFIG_PATH: "tsconfig.eval.json" }, timeout: 15_000 });
}

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
