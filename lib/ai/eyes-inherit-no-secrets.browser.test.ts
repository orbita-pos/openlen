// @vitest-environment node
//
// THE EYES' CHROMIUM INHERITS NO SERVER SECRET (2026-10-20).
//
// `lanzarChromium` runs pages and apps the model wrote (`view_page`,
// `use_page`, an app's `npm test`, thumbnails, the og-card, the Flight Check).
// It used to launch with `--no-sandbox` and `env: { ...process.env, HOME }`,
// so a renderer exploit would land in a process whose environment held
// DATABASE_URL, AUTH_SECRET and every provider key, one read of
// /proc/self/environ away. The renderers are sandboxed now, the GPU process
// that runs WebGL is not. This plants fake secrets in process.env, launches
// the real browser, and checks what Chromium was handed and, on Linux, what its
// process actually holds.
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lanzarChromium } from "./visual-quality-renderer";

const PLANTED: Readonly<Record<string, string>> = {
  DATABASE_URL: "postgres://openlen:planted-db-password@db.invalid/openlen",
  AUTH_SECRET: "planted-auth-secret",
  OPENAI_API_KEY: "sk-planted-openai-key",
  FIREWORKS_API_KEY: "fw-planted-fireworks-key",
  // Chrome reads this one itself, for its Google services.
  GOOGLE_API_KEY: "planted-google-api-key",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the eyes' Chromium", () => {
  it("🔴 is handed no server secret, only what it needs to run", async () => {
    for (const [name, value] of Object.entries(PLANTED)) vi.stubEnv(name, value);
    const launch = vi.spyOn(puppeteer, "launch");
    const browser = await lanzarChromium();
    try {
      const env = launch.mock.calls[0]?.[0]?.env;
      expect(env, "launched without `env`: Puppeteer hands Chromium all of process.env").toBeDefined();
      for (const [name, value] of Object.entries(PLANTED)) {
        expect(Object.keys(env!), name).not.toContain(name);
        expect(Object.values(env!).join("\n"), name).not.toContain(value);
      }
      expect(env!.HOME).toBe("/tmp");

      // And it still runs on what it was given.
      const page = await browser.newPage();
      await page.setContent("<p id=ok>ok</p>");
      expect(await page.$eval("#ok", (el) => el.textContent)).toBe("ok");

      // What the process really holds, where the OS lets us read it.
      const pid = browser.process()?.pid;
      if (process.platform === "linux" && pid) {
        const environ = readFileSync(`/proc/${pid}/environ`, "utf8");
        for (const value of Object.values(PLANTED)) expect(environ).not.toContain(value);
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});
