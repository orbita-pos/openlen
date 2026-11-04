// PATCH / DELETE /api/tools/[id] and POST …/restore (spec local 2026-11-04-herramientas-hechas-por-len, §4.11):
// only the person the tool is installed for switches it, removes it or restores it.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn() }));
vi.mock("@/lib/tools/enabled", () => ({ toolsEnabled: vi.fn(() => true) }));
vi.mock("@/lib/tools/store", () => ({
  setEnabled: vi.fn(),
  markRemoved: vi.fn(),
  markRestored: vi.fn(),
  installationById: vi.fn(),
  readRelease: vi.fn(),
}));

const { usuarioDeLaPeticion } = await import("@/lib/movil/quien");
const { toolsEnabled } = await import("@/lib/tools/enabled");
const store = await import("@/lib/tools/store");
const { PATCH, DELETE } = await import("./route");
const { POST: RESTORE } = await import("./restore/route");

const ctx = { params: Promise.resolve({ id: "i1" }) };
const ROW = { id: "i1", personId: "u1", releaseSha: "sha1", iconPath: "/icon.svg" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usuarioDeLaPeticion).mockResolvedValue("u1");
  vi.mocked(toolsEnabled).mockReturnValue(true);
  vi.mocked(store.setEnabled).mockResolvedValue(true);
  vi.mocked(store.markRemoved).mockResolvedValue(true);
  vi.mocked(store.markRestored).mockResolvedValue(true);
  vi.mocked(store.installationById).mockResolvedValue(ROW as never);
  vi.mocked(store.readRelease).mockResolvedValue({ "/index.html": { content: "x", contentType: "text/html" }, "/icon.svg": { content: "<svg/>", contentType: "image/svg+xml" } });
});

describe("PATCH /api/tools/[id]", () => {
  it("switches it off for its person", async () => {
    const res = await PATCH(new Request("http://x/api/tools/i1", { method: "PATCH", body: JSON.stringify({ enabled: false }) }), ctx);
    expect(res.status).toBe(200);
    expect(store.setEnabled).toHaveBeenCalledWith("i1", "u1", false);
  });
  it("someone else's: 404", async () => {
    vi.mocked(store.setEnabled).mockResolvedValue(false);
    expect((await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ enabled: true }) }), ctx)).status).toBe(404);
  });
  it("a body without a boolean: 400", async () => {
    expect((await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ enabled: "no" }) }), ctx)).status).toBe(400);
  });
  it("without a person: 401; with tools off: 404", async () => {
    vi.mocked(usuarioDeLaPeticion).mockResolvedValueOnce(null);
    expect((await PATCH(new Request("http://x", { method: "PATCH", body: "{}" }), ctx)).status).toBe(401);
    vi.mocked(toolsEnabled).mockReturnValue(false);
    expect((await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ enabled: true }) }), ctx)).status).toBe(404);
  });
});

describe("DELETE /api/tools/[id]", () => {
  it("removes it, keeping the row", async () => {
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), ctx)).status).toBe(200);
    expect(store.markRemoved).toHaveBeenCalledWith("i1", "u1");
  });
  it("someone else's: 404", async () => {
    vi.mocked(store.markRemoved).mockResolvedValue(false);
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), ctx)).status).toBe(404);
  });
});

describe("POST /api/tools/[id]/restore", () => {
  it("restores it when its release is still whole", async () => {
    expect((await RESTORE(new Request("http://x", { method: "POST" }), ctx)).status).toBe(200);
    expect(store.markRestored).toHaveBeenCalledWith("i1", "u1");
  });
  it("its release is gone: 409 release_gone, nothing restored", async () => {
    vi.mocked(store.readRelease).mockResolvedValue(null);
    const res = await RESTORE(new Request("http://x", { method: "POST" }), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "release_gone" });
    expect(store.markRestored).not.toHaveBeenCalled();
  });
  it("a release without its shell or its icon is not whole: 409", async () => {
    vi.mocked(store.readRelease).mockResolvedValue({ "/index.html": { content: "x", contentType: "text/html" } });
    expect((await RESTORE(new Request("http://x", { method: "POST" }), ctx)).status).toBe(409);
  });
  it("someone else's: 404", async () => {
    vi.mocked(store.installationById).mockResolvedValue({ ...ROW, personId: "u9" } as never);
    expect((await RESTORE(new Request("http://x", { method: "POST" }), ctx)).status).toBe(404);
  });
});
