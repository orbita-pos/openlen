import { defineConfig, devices } from "@playwright/test";

// Editor V5 e2e + visual-regression suite. These tests inject the REAL
// use-inline-edit runtime into a sample page hosted in an iframe and drive the
// genuine parent↔iframe postMessage handshake — so they exercise production
// mechanics WITHOUT needing the Next app, DB, or the Rust crates. They only
// need a Chromium-class browser.
//
// First run creates the screenshot baselines:
//   npx playwright test --update-snapshots
// Subsequent runs compare against them (≤0.1% pixel diff, see expect below).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  expect: {
    // Goal #1 / #9 fidelity bar: at most 0.1% of pixels may differ.
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: "disabled" },
  },
  use: {
    headless: true,
    viewport: { width: 1000, height: 800 },
  },
  projects: [
    {
      // Bundled Chromium (run `npx playwright install chromium` once). To use
      // an installed Google Chrome instead, add `channel: "chrome"`.
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
