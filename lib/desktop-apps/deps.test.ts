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

vi.mock("@/lib/tools/install", () => ({ realInstallDeps: vi.fn(async () => baseDeps) }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) },
  schema: { projects: { id: "id", title: "title", subdomain: "subdomain", data: "data" } },
}));
vi.mock("./store", () => ({ desktopAppOf: vi.fn(), upsertDesktopApp: vi.fn(), markDesktopAppRemoved: vi.fn() }));
vi.mock("@/lib/tools/store", () => ({ installationOf: vi.fn() }));
vi.mock("@/lib/stripe/enabled", () => ({ stripeEnabled: vi.fn() }));
vi.mock("@/lib/stripe/state", () => ({ stripeStateFor: vi.fn() }));

const { hostLabelOrThrow, realDesktopDeps } = await import("./deps");
const { stripeEnabled } = await import("@/lib/stripe/enabled");
const { stripeStateFor } = await import("@/lib/stripe/state");
const store = await import("./store");

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
    expect(d.upsertDesktopApp).toBe(store.upsertDesktopApp);
    expect(d.markRemoved).toBe(store.markDesktopAppRemoved);
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
