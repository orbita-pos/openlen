// @vitest-environment node
// The real wiring of a desktop install: what is reused from a tool's install, how a project «uses Stripe», and that a
// row never gets an empty host label.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { desktopHostLabel } from "@/lib/tools/host";

const baseDeps = {
  securityGate: vi.fn(),
  entorno: vi.fn(),
  build: vi.fn(),
  prepareFunctions: vi.fn(),
  dataChanges: vi.fn(),
  saveRelease: vi.fn(),
  markPublished: vi.fn(),
  plan: vi.fn(),
  access: vi.fn(),
  files: vi.fn(),
};
const limit = vi.fn();
const listSecrets = vi.fn();

vi.mock("@/lib/tools/install", () => ({ realInstallDeps: vi.fn(async () => baseDeps) }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) },
  schema: { projects: { id: "id", title: "title", subdomain: "subdomain", data: "data" } },
}));
vi.mock("./store", () => ({ desktopAppOf: vi.fn(), hasActiveDesktopApp: vi.fn(), upsertDesktopApp: vi.fn(), markDesktopAppRemoved: vi.fn() }));
vi.mock("@/lib/tools/store", () => ({ installationOf: vi.fn(), releaseExists: vi.fn() }));
vi.mock("@/lib/functions/secret-store-pg", () => ({ pgSecretStore: { list: (...a: unknown[]) => listSecrets(...a) } }));
vi.mock("@/lib/stripe/enabled", () => ({ stripeEnabled: vi.fn() }));
vi.mock("@/lib/stripe/state", () => ({ stripeStateFor: vi.fn() }));

const { hostLabelOrThrow, realDesktopDeps, versionKeyOrNull } = await import("./deps");
const { stripeEnabled } = await import("@/lib/stripe/enabled");
const { stripeStateFor } = await import("@/lib/stripe/state");
const store = await import("./store");
const toolStore = await import("@/lib/tools/store");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hostLabelOrThrow", () => {
  it("is the desktop's own HMAC label when the server has a secret", () => {
    const env = { AUTH_SECRET: "s3cret" };
    const label = hostLabelOrThrow("d1", env);
    expect(label).toBe(desktopHostLabel("d1", env));
    expect(label).toMatch(/^lienzo-[0-9a-f]{32}$/);
  });

  it("throws without a secret instead of storing an empty label", () => {
    expect(() => hostLabelOrThrow("d1", {})).toThrow(/AUTH_SECRET/);
    expect(() => hostLabelOrThrow("d1", { AUTH_SECRET: "  " })).toThrow(/AUTH_SECRET/);
  });
});

describe("versionKeyOrNull", () => {
  it("is a key of its own derived from the server's secret: stable, never the secret itself, and a different secret is a different key", () => {
    const key = versionKeyOrNull({ AUTH_SECRET: "s3cret" });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("s3cret");
    expect(versionKeyOrNull({ AUTH_SECRET: "s3cret" })).toBe(key);
    expect(versionKeyOrNull({ AUTH_SECRET: "other" })).not.toBe(key);
  });

  it("reads the secret the way the host labels do (Auth.js, then NextAuth) and is null without one", () => {
    expect(versionKeyOrNull({ NEXTAUTH_SECRET: "s3cret" })).toBe(versionKeyOrNull({ AUTH_SECRET: "s3cret" }));
    expect(versionKeyOrNull({})).toBeNull();
    expect(versionKeyOrNull({ AUTH_SECRET: "   " })).toBeNull();
  });
});

describe("realDesktopDeps", () => {
  it("takes the gates, the plan, the access and the files from a tool's install, and the rest from the desktop's store", async () => {
    const d = await realDesktopDeps();
    expect(d.securityGate).toBe(baseDeps.securityGate);
    expect(d.build).toBe(baseDeps.build);
    expect(d.saveRelease).toBe(baseDeps.saveRelease);
    expect(d.markPublished).toBe(baseDeps.markPublished);
    expect(d.plan).toBe(baseDeps.plan);
    expect(d.access).toBe(baseDeps.access);
    expect(d.files).toBe(baseDeps.files);
    expect(d.desktopAppOf).toBe(store.desktopAppOf);
    expect(d.hasActiveDesktopApp).toBe(store.hasActiveDesktopApp);
    expect(d.upsertDesktopApp).toBe(store.upsertDesktopApp);
    expect(d.markRemoved).toBe(store.markDesktopAppRemoved);
    // An install with nothing new asks whether the release is still there, as the tools' list does.
    expect(d.releaseExists).toBe(toolStore.releaseExists);
  });

  // The version an install stores covers the secrets it deploys (the PRODUCTION ones), as names and the digests the store
  // already keeps. The dependency has no way to ask for a value: it lists, and the list has none.
  it("lists the production secrets of the project: names and digests, never a value, never the draft ones", async () => {
    listSecrets.mockResolvedValue([
      { environment: "draft", name: "ONLY_IN_DRAFT", digest: "d0", updatedAt: new Date(), updatedBy: null },
      { environment: "live", name: "SENDGRID_API_KEY", digest: "d1", updatedAt: new Date(), updatedBy: "u1", value: "sk_live_must-not-travel", valueEncrypted: "x" },
      { environment: "live", name: "WEBHOOK_TOKEN", digest: "d2", updatedAt: new Date(), updatedBy: null },
    ]);
    const d = await realDesktopDeps();
    vi.stubEnv("OPENLEN_FUNCTIONS_ENGINE", "local");
    vi.stubEnv("PAGES_DATABASE_URL", "postgres://pages");
    vi.stubEnv("PAGES_AUTHENTICATOR_PASSWORD", "pw");
    try {
      const rows = await d.liveSecrets("p1");
      expect(listSecrets).toHaveBeenCalledWith("p1");
      expect(rows).toEqual([
        { name: "SENDGRID_API_KEY", digest: "d1" },
        { name: "WEBHOOK_TOKEN", digest: "d2" },
      ]);
      expect(JSON.stringify(rows)).not.toContain("must-not-travel");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("with no Edge Functions on this server nothing is deployed, so no secret is part of the version and the store isn't asked", async () => {
    const d = await realDesktopDeps();
    vi.stubEnv("OPENLEN_FUNCTIONS", "0");
    try {
      expect(await d.liveSecrets("p1")).toEqual([]);
      expect(listSecrets).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reads the environment the build bakes in through the same dependency the gates use, and the server's key from the process", async () => {
    const d = await realDesktopDeps();
    expect(d.entorno).toBe(baseDeps.entorno);
    vi.stubEnv("AUTH_SECRET", "s3cret");
    try {
      expect(d.versionKey()).toBe(versionKeyOrNull({ AUTH_SECRET: "s3cret" }));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is on by default and off with OPENLEN_DESKTOP_APPS=0", async () => {
    const d = await realDesktopDeps();
    expect(d.enabled()).toBe(true);
    vi.stubEnv("OPENLEN_DESKTOP_APPS", "0");
    try {
      expect(d.enabled()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("loads the project's name, its subdomain and its data", async () => {
    const row = { title: "Mis reservas", subdomain: "acme", data: { html: "x" } };
    limit.mockResolvedValueOnce([row]);
    const d = await realDesktopDeps();
    expect(await d.loadProject("p1")).toEqual(row);
    limit.mockResolvedValueOnce([]);
    expect(await d.loadProject("p2")).toBeNull();
  });

  it("uses Stripe only with Stripe on AND something of Stripe in the project", async () => {
    const d = await realDesktopDeps();

    vi.mocked(stripeEnabled).mockReturnValue(false);
    expect(await d.usesStripe("p1")).toBe(false);
    expect(stripeStateFor).not.toHaveBeenCalled();

    vi.mocked(stripeEnabled).mockReturnValue(true);
    vi.mocked(stripeStateFor).mockResolvedValue(null);
    expect(await d.usesStripe("p1")).toBe(false);

    vi.mocked(stripeStateFor).mockResolvedValue({ draft: null, production: null, webhook_endpoints: [] });
    expect(await d.usesStripe("p1")).toBe(true);
    expect(stripeStateFor).toHaveBeenLastCalledWith("p1");
  });
});
