// @vitest-environment node
//
// THE SCRAPER'S CHROMIUM (2026-10-20). `fetchPuppeteer` loads another site and
// runs its JavaScript, from a production route (style-match). It runs with
// Chrome's sandbox, like the eyes' (`lanzarChromium`): measured on the box,
// Ubuntu 24.04's AppArmor `chrome` profile lets /opt/google/chrome/chrome
// sandbox its renderers under the unit's NoNewPrivileges, and the scraper picks
// that binary (PUPPETEER_EXECUTABLE_PATH). And it inherits no server secret.
//
// The launch is recorded and then made to fail, so nothing is fetched: the URL
// is an IP literal, which `validateUrl` accepts without a DNS query.
import puppeteer from "puppeteer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPuppeteer } from "./fetch-puppeteer";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function launchOptions() {
  const launch = vi.spyOn(puppeteer, "launch").mockRejectedValue(new Error("recorded, not launched"));
  const result = await fetchPuppeteer({ url: "https://93.184.215.14/" });
  expect(result.ok).toBe(false);
  expect(launch).toHaveBeenCalledTimes(1);
  return launch.mock.calls[0]![0]!;
}

describe("the scraper's Chromium", () => {
  it("🔴 runs with Chrome's sandbox: no --no-sandbox, and no setuid fallback", async () => {
    const { args = [] } = await launchOptions();
    expect(args).not.toContain("--no-sandbox");
    expect(args).toContain("--disable-setuid-sandbox");
  });

  it("is handed no server secret", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://openlen:planted@db.invalid/openlen");
    const { env } = await launchOptions();
    expect(env).toBeDefined();
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env!.HOME).toBe("/tmp");
  });
});
