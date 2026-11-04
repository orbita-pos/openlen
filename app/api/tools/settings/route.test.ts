// @vitest-environment node
//
// «SUGERENCIAS DE HERRAMIENTAS» (spec local 2026-11-04-herramientas-hechas-por-len, §4.10, §4.11): the person's own
// switch, read and set from the Herramientas page with the browser session.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tools/suggestions", () => ({ suggestionsOn: vi.fn(), setSuggestionsOn: vi.fn() }));

const { auth } = await import("@/auth");
const { suggestionsOn, setSuggestionsOn } = await import("@/lib/tools/suggestions");
const { GET, PATCH } = await import("./route");

const signedIn = () => vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: "u1" } });
const patch = (body: unknown) => PATCH(new Request("http://x/api/tools/settings", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  vi.mocked(suggestionsOn).mockResolvedValue(false);
  vi.mocked(setSuggestionsOn).mockResolvedValue(undefined);
});

describe("/api/tools/settings", () => {
  it("GET reads the person's switch", async () => {
    vi.mocked(suggestionsOn).mockResolvedValue(true);
    const res = await GET();
    expect(await res.json()).toEqual({ suggestions: true });
    expect(suggestionsOn).toHaveBeenCalledWith("u1");
  });

  it("PATCH sets it", async () => {
    const res = await patch({ suggestions: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: true });
    expect(setSuggestionsOn).toHaveBeenCalledWith("u1", true);
  });

  it("PATCH refuses anything but a boolean", async () => {
    expect((await patch({ suggestions: "yes" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect(setSuggestionsOn).not.toHaveBeenCalled();
  });

  it("only with a browser session", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await patch({ suggestions: true })).status).toBe(401);
  });
});
