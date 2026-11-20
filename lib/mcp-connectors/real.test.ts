// @vitest-environment node
//
// What the real mount deps are made of (spec local 2026-11-17-oauth-de-conectores-mcp, §5.4, §5.9): OAuth is wired in only
// while `oauthEnabled` says so, and everything it sends goes through the guarded fetch.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), db: {} }));

const { realMountDeps, realOAuthDeps } = await import("./real");
const oauthStore = await import("./oauth/store");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("realMountDeps", () => {
  it("has OAuth deps: the person's rows, the guarded fetch and OpenLen's own site", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://openlen.test");
    const d = realMountDeps();
    expect(d.oauth).toBeDefined();
    expect(d.oauth?.store.loadConnection).toBe(oauthStore.loadConnection);
    expect(d.oauth?.store.takeFlow).toBe(oauthStore.takeFlow);
    expect(d.oauth?.siteUrl).toBe("https://openlen.test");
    expect(d.oauth?.resolveCredentials).toBe(d.resolveCredentials);
  });

  it("🔴 every OAuth request goes through the guarded fetch, never a plain one", () => {
    const d = realMountDeps();
    expect(d.oauth?.fetch).toBe(d.fetch);
    expect(d.oauth?.fetch).not.toBe(globalThis.fetch);
  });

  it("the site is OpenLen's when the environment doesn't say", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(realOAuthDeps().siteUrl).toBe("https://openlen.com");
  });

  it("🔴 with OPENLEN_MCP_OAUTH=0 no OAuth deps are built, and with OPENLEN_MCP=0 neither", () => {
    vi.stubEnv("OPENLEN_MCP_OAUTH", "0");
    expect(realMountDeps()).not.toHaveProperty("oauth");
    vi.stubEnv("OPENLEN_MCP_OAUTH", "");
    vi.stubEnv("OPENLEN_MCP", "0");
    expect(realMountDeps()).not.toHaveProperty("oauth");
  });

  it("only the literal 0 turns OAuth off", () => {
    vi.stubEnv("OPENLEN_MCP_OAUTH", "false");
    expect(realMountDeps().oauth).toBeDefined();
  });
});
