// @vitest-environment node
// Two small honesty fixes of the A/B routes (review item 29):
//  · `preview?variant=b` with no copy to show is 404 — never Control A under Variant B's name;
//  · the launch maps the errors of the publish inside it (a missing function secret, Functions that don't deploy, Stripe's two
//    accounts…) to their own codes instead of a generic `launch_failed` 500.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  exp: null as Record<string, unknown> | null,
  copy: vi.fn(),
  control: vi.fn(),
  launch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: async () => ({ rol: "dueno", duenoId: "u1" }), puede: () => true }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) }, schema: { projects: {} } }));
vi.mock("@/lib/ab/store", () => ({ getExperimentById: async () => m.exp }));
vi.mock("@/lib/ab/worktree", () => ({ copySources: m.copy, ensurePublishedSources: m.control }));
class AbLifecycleError extends Error {
  constructor(public code: string, message: string, public status: number, public extra?: Record<string, unknown>) {
    super(message);
  }
}
vi.mock("@/lib/ab/lifecycle", () => ({ AbLifecycleError, launchAbExperiment: m.launch }));
// The real mapping of the publish's errors; only the heavy module around it is replaced.
vi.mock("@/lib/projects", () => {
  class E extends Error {}
  return { publishProject: vi.fn(), ProjectNotFoundError: class extends E {}, SubdomainInvalidError: class extends E {}, SubdomainLimitError: class extends E {}, SubdomainTakenError: class extends E {} };
});
vi.mock("@/lib/security-review/real", () => ({ securityReviewer: () => ({}) }));
vi.mock("@/lib/security-review/review", () => ({ AGENT_WAIT_MS: 1 }));
vi.mock("@/lib/projects/autor-del-cambio", () => ({ conAutor: async (_a: string, f: () => unknown) => f() }));

const preview = await import("./[expId]/preview/route");
const launch = await import("./[expId]/launch/route");
const { FunctionSecretsMissingError, FunctionsDeployFailedError } = await import("@/lib/functions/publish-errors");

const EXP_CTX = { params: Promise.resolve({ id: "p1", expId: "ab_1234abcd" }) };
const get = (qs: string) => preview.GET(new Request(`https://openlen.com/api/x${qs}`), EXP_CTX);
const post = () => launch.POST(new Request("https://openlen.com/api/x", { method: "POST" }), EXP_CTX);

beforeEach(() => {
  vi.clearAllMocks();
  m.exp = { id: "ab_1234abcd", projectId: "p1", targetPath: "/", copyProjectId: "copy-1" };
  m.copy.mockResolvedValue({ data: { html: "<html>VARIANT B</html>" } });
  m.control.mockResolvedValue({ data: { html: "<html>CONTROL A</html>" } });
});

describe("GET preview", () => {
  it("variant b shows the copy's page; variant a (or none) the published one", async () => {
    expect(await (await get("?variant=b")).text()).toBe("<html>VARIANT B</html>");
    expect(await (await get("?variant=a")).text()).toBe("<html>CONTROL A</html>");
    expect(await (await get("")).text()).toBe("<html>CONTROL A</html>");
  });

  it("🔴 variant b with no copy left is 404, not Control A", async () => {
    m.exp = { ...m.exp, copyProjectId: null };
    const res = await get("?variant=b");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("CONTROL A");
    expect(m.control).not.toHaveBeenCalled();
  });

  it("🔴 variant b whose copy can't be read is 404 too", async () => {
    m.copy.mockRejectedValue(new Error("gone"));
    expect((await get("?variant=b")).status).toBe(404);
  });
});

describe("POST launch", () => {
  it("🔴 a missing function secret is its own code (428 secrets_required), not launch_failed", async () => {
    m.launch.mockRejectedValue(new FunctionSecretsMissingError(["STRIPE_SECRET_KEY"]));
    const res = await post();
    expect(res.status).toBe(428);
    expect(await res.json()).toMatchObject({ error: "secrets_required", missing: ["STRIPE_SECRET_KEY"] });
  });

  it("Functions that fail to deploy are 502/503 with their own code", async () => {
    m.launch.mockRejectedValue(new FunctionsDeployFailedError("boom"));
    const res = await post();
    expect([502, 503]).toContain(res.status);
    expect((await res.json()).error).toMatch(/functions_/);
  });

  it("an error of the experiment's own keeps its code, and one nobody knows is the generic 500", async () => {
    m.launch.mockRejectedValueOnce(new AbLifecycleError("base_moved", "moved", 409));
    const known = await post();
    expect(known.status).toBe(409);
    expect((await known.json()).error).toBe("base_moved");

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.launch.mockRejectedValueOnce(new Error("???"));
    const unknown = await post();
    error.mockRestore();
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({ error: "launch_failed" });
  });
});
