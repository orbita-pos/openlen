// scripts/sandbox-playwright-acceptance.ts
// Acceptance of a page's Playwright tests in a REAL box (plan local 2026-10-21-playwright-in-the-box),
// through OpenLen's own pieces: the driver's network (a host with the marker rule), the box's opening
// (E2B's authority into Chromium, the base environment), the npx wrapper and @playwright/test from
// NODE_PATH or, in an ESM project, the template's resolver; and, on the next turn, that a version that
// rolled off /.openlen leaves no folder. The canvas isn't reachable from a box while OpenLen runs locally, so BASE_URL is an echo
// site behind the same kind of rule; the canvas itself is checked on a real deploy.
//
// Needs E2B_API_KEY and template openlen-terminal-v2. Costs cents.
// Run: npm run sandbox:playwright-acceptance

import { BOX_MARKER_HEADER } from "../lib/agent/sandbox/box-marker";
import { SANDBOX_TEMPLATE } from "../lib/agent/sandbox/config";
import { e2bDriver } from "../lib/agent/sandbox/e2b-driver";
import { SandboxTerminal } from "../lib/agent/sandbox/sandbox-terminal";

const ECHO = "httpbin.org";
const MARK = "acceptance.marker";

const FILES = {
  "/index.html": "<!doctype html><title>t</title><h1>hola</h1>",
  "/playwright.config.ts": `import { defineConfig } from "@playwright/test";\nexport default defineConfig({ testDir: "tests", reporter: "list", use: { baseURL: process.env.BASE_URL } });\n`,
  "/tests/contenido.spec.ts": `import { test, expect } from "@playwright/test";\ntest("pinta lo que le dan", async ({ page }) => {\n  await page.setContent("<h1>Masa Madre</h1>");\n  await expect(page.getByRole("heading")).toHaveText("Masa Madre");\n});\n`,
  "/tests/marca.spec.ts": `import { test, expect } from "@playwright/test";\ntest("va a BASE_URL y la marca de la caja llega", async ({ page }) => {\n  await page.goto("/headers");\n  await expect(page.locator("body")).toContainText("X-Openlen-Caja");\n});\n`,
  // An ESM project: NODE_PATH doesn't reach `import`; the template's resolver does.
  "/esm/package.json": `{ "name": "esm", "type": "module" }\n`,
  "/esm/playwright.config.ts": `import { defineConfig } from "@playwright/test";\nexport default defineConfig({ testDir: "tests", reporter: "list" });\n`,
  "/esm/tests/a.spec.ts": `import { test, expect } from "@playwright/test";\ntest("ESM", async ({ page }) => {\n  await page.setContent("<h1>ESM</h1>");\n  await expect(page.getByRole("heading")).toHaveText("ESM");\n});\n`,
};

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "OK   " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
};
const short = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 220);

async function main() {
  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) throw new Error("E2B_API_KEY is not set");
  const driver = e2bDriver({ apiKey, template: SANDBOX_TEMPLATE, dailyUsd: 0, onlyUsers: null });
  const t0 = Date.now();
  const handle = await driver.create({ template: SANDBOX_TEMPLATE, metadata: { acceptance: "playwright" }, network: { hosts: [ECHO], headers: { [BOX_MARKER_HEADER]: MARK } } });
  let readOnly: Record<string, string> = { "/.openlen/versiones/v1/index.html": "v1", "/.openlen/versiones/v1/sobre/index.html": "v1" };
  try {
    const terminal = new SandboxTerminal({
      handle,
      projectFiles: FILES,
      syncedManifest: {},
      bridge: {},
      readOnly: async () => readOnly,
      startedAt: t0,
      fresh: true,
      baseEnv: { BASE_URL: `https://${ECHO}` },
    });
    const v = await terminal.ejecutar("npx playwright --version");
    check("1. npx playwright is the template's, no download", /Version 1\.63\.0/.test(v.stdout), short(v.stdout + v.stderr));
    const ca = await terminal.ejecutar("certutil -d sql:$HOME/.pki/nssdb -L | grep -c e2b-proxy");
    check("2. E2B's authority is in Chromium's store", ca.stdout.trim() === "1", short(ca.stdout + ca.stderr));
    const env = await terminal.ejecutar('echo "$BASE_URL|$PLAYWRIGHT_BROWSERS_PATH|$NODE_PATH"');
    check("3. the base environment is there", env.stdout.includes(`https://${ECHO}|/opt/openlen/ms-playwright|/opt/openlen/playwright/node_modules`), short(env.stdout));
    const started = Date.now();
    const run = await terminal.ejecutar("cd / && npx playwright test", { timeoutMs: 180_000 });
    check(
      "4. npx playwright test passes both tests (content, and BASE_URL with the marker)",
      run.exitCode === 0 && /2 passed/.test(run.stdout),
      `${Date.now() - started} ms · ${short(run.stdout.split("\n").filter((l) => /passed|failed|✓|✘|Error/.test(l)).join(" | "))}`,
    );
    await terminal.ejecutar(
      `cat > /tests/falla.spec.ts <<'EOF'\nimport { test, expect } from "@playwright/test";\ntest("falla a propósito", async ({ page }) => {\n  await page.setContent("<h1>A</h1>");\n  await expect(page.getByRole("heading")).toHaveText("B", { timeout: 1000 });\n});\nEOF`,
    );
    const failing = await terminal.ejecutar("cd / && npx playwright test tests/falla.spec.ts", { timeoutMs: 120_000 });
    check("5. a failing test fails the command, with Playwright's own report", failing.exitCode !== 0 && /1 failed/.test(failing.stdout), short(failing.stdout.split("\n").filter((l) => /failed|Expected|Received/.test(l)).join(" | ")));
    const esm = await terminal.ejecutar("cd /esm && npx playwright test", { timeoutMs: 180_000 });
    check('6. in an ESM project ("type": "module") the tests find Playwright', esm.exitCode === 0 && /1 passed/.test(esm.stdout), short(esm.stdout.split("\n").filter((l) => /passed|failed|Error/.test(l)).join(" | ")));
    // The next turn on the same box: a version rolled off /.openlen.
    readOnly = { "/.openlen/versiones/v2/index.html": "v2" };
    const next = new SandboxTerminal({ handle, projectFiles: FILES, syncedManifest: {}, bridge: {}, readOnly: async () => readOnly, startedAt: Date.now(), baseEnv: { BASE_URL: `https://${ECHO}` } });
    const versions = await next.ejecutar("find /.openlen/versiones | sort");
    check("7. a version that rolled off leaves no folder behind", !versions.stdout.includes("/v1") && versions.stdout.includes("/v2/index.html"), short(versions.stdout));
    await next.cerrar();
  } finally {
    await driver.kill(handle.id).catch(() => undefined);
    console.log(`box killed after ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} OK`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : e);
  process.exit(1);
});
