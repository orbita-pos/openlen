// @vitest-environment node
// `create_ab_variant` (review item 1): Variant B's HTML reaches the worktree copy through the SAME door Write uses
// (`guardarFichero`: the page gate — size, format, `data-slot-path` rejected, `data-op-id` stripped — and the
// compare-and-swap writer), never through a bare UPDATE of `projects.data`; and the tool refuses where it can't work
// (an app, a game, a tool, an unpublished project) before it creates anything.
import { beforeEach, describe, expect, it, vi } from "vitest";

const enabled = vi.hoisted(() => ({ on: true }));
const createAbDraft = vi.hoisted(() => vi.fn());
const cancelAbDraft = vi.hoisted(() => vi.fn());
const commitAbWorktree = vi.hoisted(() => vi.fn());
const guardarFichero = vi.hoisted(() => vi.fn());
const dbUpdate = vi.hoisted(() => vi.fn(() => {
  throw new Error("a bare UPDATE of projects.data: this tool must write through guardarFichero");
}));

vi.mock("@/lib/ab/enabled", () => ({ abTestingEnabled: () => enabled.on }));
vi.mock("@/lib/ab/lifecycle", () => {
  class AbLifecycleError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  }
  return { AbLifecycleError, createAbDraft, cancelAbDraft };
});
vi.mock("@/lib/ab/worktree", () => ({ commitAbWorktree }));
vi.mock("@/lib/agent/herramientas-de-ficheros", () => ({ guardarFichero }));
vi.mock("@/lib/db", () => ({ db: { update: dbUpdate, select: dbUpdate }, schema: { projects: {} } }));

import { AbLifecycleError } from "@/lib/ab/lifecycle";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import { runCreateAbVariant } from "@/lib/agent/tools-ab";

const COPY = "copy-project-1";
const draft = (over: Record<string, unknown> = {}) => ({
  id: "ab_1234abcd",
  name: "Direct hero",
  targetPath: "/",
  primaryMetric: "conversion_any",
  status: "draft",
  copyProjectId: COPY,
  ...over,
});

function session(over: Partial<AgentSession> = {}): AgentSession {
  return {
    projectId: "parent-1",
    userId: "owner-1",
    page: null,
    ownerEmail: null,
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
    busquedasVaciasSeguidas: 0,
    ...over,
  } as AgentSession;
}

const copyData = { html: "<html><body>control</body></html>", pages: { menu: { title: "Menu", html: "<html>m</html>" } } };
const deps = {
  loadProject: vi.fn(async () => ({ data: copyData, title: "T", subdomain: null, publishedAt: null, userBrief: null, brief: null })),
} as unknown as AgentDeps;

beforeEach(() => {
  enabled.on = true;
  createAbDraft.mockReset();
  cancelAbDraft.mockReset();
  commitAbWorktree.mockReset();
  guardarFichero.mockReset();
  dbUpdate.mockClear();
  (deps.loadProject as unknown as ReturnType<typeof vi.fn>).mockClear();
  createAbDraft.mockResolvedValue(draft());
  guardarFichero.mockResolvedValue({ ok: true, html: "<html>B</html>", page: null, cambio: "cambio", versionPrevia: null, previo: null, referenciasRotas: [] });
  commitAbWorktree.mockResolvedValue("tip");
  cancelAbDraft.mockResolvedValue({});
});

describe("create_ab_variant writes Variant B through the page gate", () => {
  it("🔴 the home goes to the COPY's /index.html through guardarFichero — and no bare UPDATE of data happens", async () => {
    const out = await runCreateAbVariant(session(), { name: "Direct hero", variant_b_html: "<html>B</html>" }, deps);
    expect(out.response.ok).toBe(true);
    expect(guardarFichero).toHaveBeenCalledTimes(1);
    const [writerSession, writerDeps, data, ruta, contenido, opts] = guardarFichero.mock.calls[0]!;
    expect(writerSession.projectId).toBe(COPY); // the copy, never the owner's draft
    expect(writerSession.userId).toBe("owner-1");
    expect(writerSession.page).toBeNull();
    expect(writerDeps).toBe(deps);
    expect(data).toBe(copyData);
    expect(ruta).toBe("/index.html");
    expect(contenido).toBe("<html>B</html>");
    expect(opts.crea).toBe(false);
    expect(dbUpdate).not.toHaveBeenCalled();
    expect(commitAbWorktree).toHaveBeenCalledWith(COPY, "owner-1", "ab_1234abcd");
  });

  it("a subpage target writes that page's file in the copy", async () => {
    createAbDraft.mockResolvedValue(draft({ targetPath: "/menu" }));
    await runCreateAbVariant(session(), { name: "Menu B", target_path: "/menu", variant_b_html: "<html>B</html>" }, deps);
    const [writerSession, , , ruta] = guardarFichero.mock.calls[0]!;
    expect(ruta).toBe("/menu/index.html");
    expect(writerSession.page).toBe("menu");
  });

  it("🔴 a page the gate refuses (data-slot-path…) is no draft at all: the experiment is cancelled and nothing is committed", async () => {
    guardarFichero.mockResolvedValue({ ok: false, error: "the HTML contains a reserved marker (data-slot-path)" });
    const out = await runCreateAbVariant(session(), { name: "Bad", variant_b_html: '<div data-slot-path="x">' }, deps);
    expect(out.response.ok).toBe(false);
    expect(String(out.response.error)).toMatch(/data-slot-path/);
    expect(cancelAbDraft).toHaveBeenCalledWith({ projectId: "parent-1", experimentId: "ab_1234abcd" });
    expect(commitAbWorktree).not.toHaveBeenCalled();
  });

  it("a member speaking keeps the owner as the writer (the project is the owner's) and the member as the person", async () => {
    await runCreateAbVariant(session({ personId: "member-9" }), { name: "x", variant_b_html: "<html>B</html>" }, deps);
    expect(createAbDraft).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "owner-1", actorId: "member-9" }));
    const [writerSession] = guardarFichero.mock.calls[0]!;
    expect(writerSession.userId).toBe("owner-1");
  });
});

describe("create_ab_variant refuses before it does anything", () => {
  for (const [what, over] of [
    ["an app", { app: { catalogo: "2026-11", entrada: "/src/main.jsx" } }],
    ["a game", { app: { catalogo: "2026-11", entrada: "/src/main.jsx" }, game: true }],
    ["a tool", { tool: true }],
  ] as const) {
    it(`${what}: no draft, no worktree, no write`, async () => {
      const out = await runCreateAbVariant(session(over as Partial<AgentSession>), { name: "x", variant_b_html: "<html>B</html>" }, deps);
      expect(out.response.ok).toBe(false);
      expect(String(out.response.error)).toMatch(/static HTML/i);
      expect(createAbDraft).not.toHaveBeenCalled();
      expect(guardarFichero).not.toHaveBeenCalled();
      expect(dbUpdate).not.toHaveBeenCalled();
    });
  }

  it("an unpublished project: the lifecycle says so and nothing is written", async () => {
    createAbDraft.mockRejectedValue(new AbLifecycleError("not_published", "Publish the page first before starting an A/B experiment.", 400));
    const out = await runCreateAbVariant(session(), { name: "x", variant_b_html: "<html>B</html>" }, deps);
    expect(out.response.ok).toBe(false);
    expect(String(out.response.error)).toMatch(/Publish the page first/);
    expect(guardarFichero).not.toHaveBeenCalled();
    expect(commitAbWorktree).not.toHaveBeenCalled();
  });

  it("with the flag off the tool says so and touches nothing", async () => {
    enabled.on = false;
    const out = await runCreateAbVariant(session(), { name: "x", variant_b_html: "<html>B</html>" }, deps);
    expect(out.response.ok).toBe(false);
    expect(createAbDraft).not.toHaveBeenCalled();
  });
});

describe("anything that goes wrong after the draft exists cancels it (G1+G3 review, item 19)", () => {
  it("🔴 the writer throws: the draft (and its copy) is cancelled, and Len reads the reason", async () => {
    guardarFichero.mockRejectedValue(new Error("db went away"));
    const out = await runCreateAbVariant(session(), { name: "Direct hero", variant_b_html: "<html>B</html>" }, deps);
    expect(out.response.ok).toBe(false);
    expect(cancelAbDraft).toHaveBeenCalledWith({ projectId: "parent-1", experimentId: "ab_1234abcd" });
  });

  it("🔴 the commit of the copy throws: cancelled too — a draft with no Variant B committed must not stay as «active»", async () => {
    commitAbWorktree.mockRejectedValue(new Error("git store down"));
    const out = await runCreateAbVariant(session(), { name: "Direct hero", variant_b_html: "<html>B</html>" }, deps);
    expect(out.response.ok).toBe(false);
    expect(cancelAbDraft).toHaveBeenCalledTimes(1);
  });

  it("loading the copy throws: cancelled", async () => {
    (deps.loadProject as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db"));
    await runCreateAbVariant(session(), { name: "Direct hero", variant_b_html: "<html>B</html>" }, deps);
    expect(cancelAbDraft).toHaveBeenCalledTimes(1);
  });

  it("a refusal BEFORE any draft exists cancels nothing (there is nothing to cancel)", async () => {
    createAbDraft.mockRejectedValue(new AbLifecycleError("not_published", "Publish the page first.", 400));
    const out = await runCreateAbVariant(session(), { name: "Direct hero", variant_b_html: "<html>B</html>" }, deps);
    expect(out.response.ok).toBe(false);
    expect(cancelAbDraft).not.toHaveBeenCalled();
  });

  it("the success path cancels nothing, and a cancel that itself fails doesn't hide the original error", async () => {
    expect((await runCreateAbVariant(session(), { name: "Direct hero", variant_b_html: "<html>B</html>" }, deps)).response.ok).toBe(true);
    expect(cancelAbDraft).not.toHaveBeenCalled();
    guardarFichero.mockRejectedValue(new Error("original failure"));
    cancelAbDraft.mockRejectedValue(new Error("cancel failed too"));
    const out = await runCreateAbVariant(session(), { name: "Direct hero", variant_b_html: "<html>B</html>" }, deps);
    expect(JSON.stringify(out.response)).toContain("original failure");
  });
});
