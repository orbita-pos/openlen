// GET /api/tools and GET /api/tools/[id]/icon (spec local 2026-11-04-herramientas-hechas-por-len, §4.11): the person's
// installed tools as the workspace shows them, and each one's icon — served so its SVG can never run as a page.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn() }));
vi.mock("@/lib/tools/enabled", () => ({ toolsEnabled: vi.fn(() => true) }));
vi.mock("@/lib/limits", () => ({ getUserPlan: vi.fn(async () => "pro") }));
vi.mock("@/lib/tools/store", () => ({ listInstallations: vi.fn(), releaseExists: vi.fn(async () => true), personName: vi.fn(async () => "Ana"), installationById: vi.fn(), readRelease: vi.fn() }));

const { usuarioDeLaPeticion } = await import("@/lib/movil/quien");
const { getUserPlan } = await import("@/lib/limits");
const store = await import("@/lib/tools/store");
const { GET } = await import("./route");
const { GET: ICON } = await import("./[id]/icon/route");

const ROW = {
  id: "i1",
  personId: "u1",
  projectId: "p1",
  releaseSha: "sha1",
  placement: "rail",
  titles: { en: "Bookings", es: "Reservas" },
  descriptions: { en: "x", es: "y" },
  iconPath: "/icon.svg",
  hostLabel: "lienzo-0123456789abcdef0123456789abcdef",
  enabled: true,
  installedAt: new Date("2026-11-04T10:00:00Z"),
  updatedAt: new Date(),
  removedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.mocked(usuarioDeLaPeticion).mockResolvedValue("u1");
  vi.mocked(getUserPlan).mockResolvedValue("pro");
  vi.mocked(store.listInstallations).mockResolvedValue([ROW] as never);
  vi.mocked(store.installationById).mockResolvedValue(ROW as never);
  vi.mocked(store.readRelease).mockResolvedValue({ "/icon.svg": { content: "<svg/>", contentType: "image/svg+xml; charset=utf-8" } });
});

const list = (locale = "es") => GET(new Request(`http://localhost:3000/api/tools?locale=${locale}`, { headers: { host: "localhost:3000" } }));

describe("GET /api/tools", () => {
  it("the person's tools, in their language, with their frame", async () => {
    const body = (await (await list()).json()) as { tools: Array<Record<string, unknown>> };
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]).toMatchObject({ id: "i1", title: "Reservas", status: "ok", frameUrl: "http://lienzo-0123456789abcdef0123456789abcdef.localhost:3000/?v=sha1" });
    expect(store.listInstallations).toHaveBeenCalledWith("u1");
    expect((body as unknown as { person: unknown }).person).toEqual({ name: "Ana" });
  });

  it("on Free every tool says plan_required (Review Focus 5)", async () => {
    vi.mocked(getUserPlan).mockResolvedValue("free");
    const body = (await (await list()).json()) as { tools: Array<{ status: string; frameUrl: unknown }> };
    expect(body.tools[0]).toMatchObject({ status: "plan_required", frameUrl: null });
  });

  it("a removed one says removed", async () => {
    vi.mocked(store.listInstallations).mockResolvedValue([{ ...ROW, removedAt: new Date() }] as never);
    expect(((await (await list()).json()) as { tools: Array<{ status: string }> }).tools[0]?.status).toBe("removed");
  });

  it("nobody signed in: 401; tools off: 404", async () => {
    vi.mocked(usuarioDeLaPeticion).mockResolvedValueOnce(null);
    expect((await list()).status).toBe(401);
    const { toolsEnabled } = await import("@/lib/tools/enabled");
    vi.mocked(toolsEnabled).mockReturnValueOnce(false);
    expect((await list()).status).toBe(404);
  });
});

describe("GET /api/tools/[id]/icon", () => {
  const icon = () => ICON(new Request("http://x/api/tools/i1/icon?v=sha1"), { params: Promise.resolve({ id: "i1" }) });

  it("its icon, sandboxed so an SVG never runs as a page", async () => {
    const res = await icon();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<svg/>");
    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("someone else's: 404", async () => {
    vi.mocked(store.installationById).mockResolvedValue({ ...ROW, personId: "u9" } as never);
    expect((await icon()).status).toBe(404);
  });
});
