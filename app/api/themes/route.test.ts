// @vitest-environment node
// The route is the session, the shape of the body and the status of each answer; which theme wins, and who may pick what,
// is `lib/themes/resolve.test.ts`. Here the store and the access check are replaced and everything above them is real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ThemeDeps } from "@/lib/themes/resolve";
import type { ThemeChoices } from "@/lib/themes/types";

// Hoisted with the mocks: the route imports `@/auth` as it loads, before this file's own statements run.
const auth = vi.hoisted(() => vi.fn(async () => ({ user: { id: "u1" } }) as { user?: { id?: string } } | null));
vi.mock("@/auth", () => ({ auth }));

const world = vi.hoisted(() => ({ deps: null as unknown }));
vi.mock("@/lib/themes/resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/themes/resolve")>()),
  realThemeDeps: async () => world.deps,
}));

import { GET, PUT } from "./route";

function fakeDeps(over: { choices?: ThemeChoices; visible?: string[] } = {}) {
  const choices = over.choices ?? { project: null, everywhere: null };
  const visible = over.visible ?? ["p1"];
  return {
    choicesOf: vi.fn(async () => choices),
    listInstallations: vi.fn(async () => []),
    readRelease: vi.fn(async () => null),
    setChoice: vi.fn(async () => undefined),
    canSee: vi.fn(async (projectId: string) => visible.includes(projectId)),
  } satisfies ThemeDeps;
}

const get = (query = "") => GET(new Request(`http://localhost/api/themes${query}`));
const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/themes", { method: "PUT", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  world.deps = fakeDeps();
});

afterEach(() => {
  vi.unstubAllEnvs();
  auth.mockReset();
  auth.mockResolvedValue({ user: { id: "u1" } });
});

describe("GET /api/themes", () => {
  it("is a 404 while the themes are off, whoever asks", async () => {
    vi.stubEnv("OPENLEN_THEMES", "0");
    expect((await get()).status).toBe(404);
    expect(auth).not.toHaveBeenCalled();
  });

  it("is a 401 with nobody signed in", async () => {
    auth.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("says what is picked, what applies and what there is to pick from, kept nowhere", async () => {
    world.deps = fakeDeps({ choices: { project: null, everywhere: "bundled:halftone-dawn" } });
    const res = await get("?project=p1&locale=es");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.applied).toEqual({ project: null, everywhere: "bundled:halftone-dawn" });
    expect(body.resolved).toMatchObject({ ref: "bundled:halftone-dawn", twinRef: "bundled:halftone-dusk" });
    expect(body.twin).toMatchObject({ ref: "bundled:halftone-dusk", window: "dark" });
    expect(body.available.map((a: { ref: string }) => a.ref)).toContain("bundled:aurora");
    expect((world.deps as ThemeDeps).choicesOf).toHaveBeenCalledWith("u1", "p1");
  });

  it("reads only «everywhere» when no project is named, or the one named is not the person's to open", async () => {
    await get();
    expect((world.deps as ThemeDeps).choicesOf).toHaveBeenLastCalledWith("u1", null);
    await get("?project=secret");
    expect((world.deps as ThemeDeps).choicesOf).toHaveBeenLastCalledWith("u1", null);
    expect((await get("?project=secret")).status).toBe(200);
  });

  it("with ?preview=, adds the theme it names as the layer would paint it, and saves nothing", async () => {
    world.deps = fakeDeps({ choices: { project: null, everywhere: "bundled:aurora" } });
    const body = await (await get("?locale=en&preview=bundled%3Ahalftone-dawn")).json();
    expect(body.resolved).toMatchObject({ ref: "bundled:aurora" });
    expect(body.previewed.resolved).toMatchObject({ ref: "bundled:halftone-dawn", window: "light" });
    expect(body.previewed.twin).toMatchObject({ ref: "bundled:halftone-dusk", window: "dark" });
    expect((world.deps as ThemeDeps).setChoice).not.toHaveBeenCalled();
    expect((await (await get("?preview=bundled%3Anothing")).json()).previewed).toBeNull();
    expect((await (await get(`?preview=${"x".repeat(600)}`)).json()).previewed).toBeNull();
    expect("previewed" in (await (await get()).json())).toBe(false);
  });

  it("takes a language it can read and English for anything else", async () => {
    const title = async (query: string) => (await (await get(query)).json()).available.find((a: { ref: string }) => a.ref === "bundled:aurora").title;
    // The gallery has English only, so this checks that nothing breaks and the fallback holds.
    expect(await title("?locale=es")).toBe("Aurora");
    expect(await title("?locale=%3Cscript%3E")).toBe("Aurora");
    expect(await title("?locale=" + "x".repeat(100))).toBe("Aurora");
  });
});

describe("PUT /api/themes", () => {
  it("is a 404 while the themes are off, and a 401 with nobody signed in", async () => {
    vi.stubEnv("OPENLEN_THEMES", "0");
    expect((await put({ scope: "everywhere", themeRef: "bundled:aurora" })).status).toBe(404);
    vi.unstubAllEnvs();
    auth.mockResolvedValue(null);
    expect((await put({ scope: "everywhere", themeRef: "bundled:aurora" })).status).toBe(401);
    expect((world.deps as ThemeDeps).setChoice).not.toHaveBeenCalled();
  });

  it("rejects a body that is not the shape: 400, and nothing is written", async () => {
    const bad: unknown[] = [
      "not json",
      {},
      { scope: "everywhere" },
      { scope: "somewhere", themeRef: "bundled:aurora" },
      { scope: "project", themeRef: "bundled:aurora" },
      { scope: "project", projectId: "", themeRef: "bundled:aurora" },
      { scope: "everywhere", themeRef: 7 },
      { scope: "everywhere", themeRef: "x".repeat(600) },
    ];
    for (const body of bad) {
      const res = await put(body as string);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((world.deps as ThemeDeps).setChoice).not.toHaveBeenCalled();
  });

  it("saves a pick for everywhere and for a project, and clears one with null", async () => {
    const d = world.deps as ReturnType<typeof fakeDeps>;
    const everywhere = await put({ scope: "everywhere", themeRef: "bundled:aurora" });
    expect(everywhere.status).toBe(200);
    expect(await everywhere.json()).toEqual({ ok: true });
    expect(d.setChoice).toHaveBeenLastCalledWith("u1", "everywhere", "bundled:aurora");
    expect((await put({ scope: "project", projectId: "p1", themeRef: "bundled:ember" })).status).toBe(200);
    expect(d.setChoice).toHaveBeenLastCalledWith("u1", "p1", "bundled:ember");
    expect((await put({ scope: "project", projectId: "p1", themeRef: null })).status).toBe(200);
    expect(d.setChoice).toHaveBeenLastCalledWith("u1", "p1", null);
  });

  it("is a 404 for a theme that is not the person's or does not exist, saying no more", async () => {
    for (const themeRef of ["bundled:no-existe", "installed:inst-de-otro:estanque", "banana"]) {
      const res = await put({ scope: "everywhere", themeRef });
      expect(res.status, themeRef).toBe(404);
      expect(await res.json(), themeRef).toEqual({ error: "unknown_theme" });
    }
    expect((world.deps as ThemeDeps).setChoice).not.toHaveBeenCalled();
  });

  it("is a 403 for a project the person cannot open", async () => {
    const res = await put({ scope: "project", projectId: "secret", themeRef: "bundled:aurora" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "no_access" });
    expect((world.deps as ThemeDeps).setChoice).not.toHaveBeenCalled();
  });
});
