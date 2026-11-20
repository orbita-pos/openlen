// @vitest-environment node
// THE A/B ROUTES THE PHONE DOESN'T CALL TAKE THE WEB SESSION ONLY (review item 27): a phone key in `Authorization` means
// nothing to them (they used to accept it, with an app CORS nobody had listed).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  keyLookup: vi.fn(async () => "u-from-the-key"),
  exigirAcceso: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => m.session }));
vi.mock("@/lib/movil/llaves", () => ({ usuarioDeLaLlave: m.keyLookup }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: m.exigirAcceso }));
vi.mock("@/lib/ab/enabled", () => ({ abTestingEnabled: () => true }));
vi.mock("@/lib/ab/lifecycle", () => ({
  AbLifecycleError: class extends Error {},
  createAbDraft: vi.fn(),
  launchAbExperiment: vi.fn(),
  retryBringWinner: vi.fn(),
  discardWinnerBring: vi.fn(),
}));
vi.mock("@/lib/ab/metrics", () => ({ computeExperimentMetrics: vi.fn(), metricsInputOf: vi.fn() }));
vi.mock("@/lib/ab/store", () => ({
  listExperimentsForProject: vi.fn(async () => []),
  getExperimentById: vi.fn(async () => null),
  toExperimentView: vi.fn(),
  updateExperiment: vi.fn(),
}));
vi.mock("@/lib/ab/worktree", () => ({ copySources: vi.fn(), ensurePublishedSources: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));

const ab = await import("./route");
const launch = await import("./[expId]/launch/route");
const bring = await import("./[expId]/bring/route");
const preview = await import("./[expId]/preview/route");

const PROJECT = { params: Promise.resolve({ id: "p1" }) };
const EXP = { params: Promise.resolve({ id: "p1", expId: "ab_1234abcd" }) };
const withKey = (method: string) => new Request("https://openlen.com/api/x", { method, headers: { authorization: "Bearer olk_phone_key" } });

const CALLS: [string, () => Promise<Response>][] = [
  ["GET /ab", () => ab.GET(withKey("GET"), PROJECT)],
  ["POST /ab", () => ab.POST(withKey("POST"), PROJECT)],
  ["POST /launch", () => launch.POST(withKey("POST"), EXP)],
  ["POST /bring", () => bring.POST(withKey("POST"), EXP)],
  ["GET /preview", () => preview.GET(withKey("GET"), EXP)],
];

beforeEach(() => {
  vi.clearAllMocks();
  m.session = null;
  m.exigirAcceso.mockResolvedValue(new Response("forbidden", { status: 403 }));
});

describe("the A/B routes the phone doesn't call", () => {
  for (const [name, call] of CALLS) {
    it(`🔴 ${name}: a phone key with no web session is 401, and the key is never even looked up`, async () => {
      const res = await call();
      expect(res.status).toBe(401);
      expect(m.keyLookup).not.toHaveBeenCalled();
      expect(m.exigirAcceso).not.toHaveBeenCalled();
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it(`${name}: with a web session it goes on to the project access check`, async () => {
      m.session = { user: { id: "u1" } };
      const res = await call();
      expect(res.status).toBe(403); // exigirAcceso's answer: authentication passed
      expect(m.exigirAcceso).toHaveBeenCalledWith("p1", "u1", expect.any(String));
    });
  }

  it("they export no OPTIONS: the app's preflight finds nothing", () => {
    for (const mod of [ab, launch, bring, preview]) expect("OPTIONS" in mod).toBe(false);
  });
});
