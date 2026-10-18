// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDashboard } from "./compile";
import { stopBundlerWorker } from "../../../apps/bundler/bundle-app";
import { dashboardFixture } from "../../testing/dashboard";
// Explicit opt-in: this launches Chrome, unlike pure/SQL infrastructure tests.
const run = process.env.ARTIFACT_BROWSER_TESTS === "1" ? it : it.skip;
afterAll(() => stopBundlerWorker());
run("actual browser operates a dataset filter and rejects authored runtime errors", async () => {
  const { renderDashboardPacket } = await import("../../../../tools/artifact-renderer/browser.mjs");
  const fixture = dashboardFixture();
  const built = await buildDashboard(fixture);
  if (process.env.ARTIFACT_REVIEW_DIR) {
    await mkdir(process.env.ARTIFACT_REVIEW_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_REVIEW_DIR, "dashboard.html"), built.html);
    await writeFile(join(process.env.ARTIFACT_REVIEW_DIR, "dashboard.csv"), built.csv[0]!.text);
  }
  const packet = { version: 1, kind: "dashboard", html: built.html, width: 1280, height: 720, probes: built.manifest.probes };
  const options = { executablePath: process.env.ARTIFACT_TEST_BROWSER_EXECUTABLE };
  const result = await renderDashboardPacket(packet, options);
  expect(result.checks).toContain("interaction:0:passed");
  expect(result.png.byteLength).toBeGreaterThan(10_000);
  if (process.env.ARTIFACT_REVIEW_DIR) {
    await writeFile(join(process.env.ARTIFACT_REVIEW_DIR, "dashboard.png"), result.png);
  }
  const broken = { ...packet, probes: [], html: built.html.replace("</body>", '<script>throw new Error("Broken chart")</script></body>') };
  await expect(renderDashboardPacket(broken, options)).rejects.toThrow("artifact_runtime_error");
}, 90_000);
