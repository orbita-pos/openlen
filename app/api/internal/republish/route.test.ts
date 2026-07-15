// @vitest-environment node
//
// Guard + contrato de la ruta interna de republicación selectiva (backfill
// ops). Mockea la DB y lib/projects: la cadena de imports arrastra el binding
// nativo @openlen/html-engine que vitest no puede cargar (mismo criterio que
// live-republish/route.test.ts). Los caminos 401/400 regresan antes de tocar
// cualquier dependencia.
import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn((..._a: unknown[]) => ({}) as unknown);
vi.mock("@/lib/db", () => ({
  db: { select: (...a: unknown[]) => selectMock(...a) },
  schema: {
    projects: { id: "id", userId: "userId", subdomain: "subdomain", publishedAt: "publishedAt" },
  },
}));
const publishMock = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("@/lib/projects", () => ({
  publishProject: (...a: unknown[]) => publishMock(...a),
}));

import { POST } from "./route";

function rowsResult(rows: unknown[]) {
  selectMock.mockReturnValue({ from: () => ({ where: async () => rows }) });
}

const post = (headers: Record<string, string> = {}, body?: unknown) =>
  POST(
    new Request("http://x/api/internal/republish", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

describe("POST /api/internal/republish", () => {
  beforeEach(() => {
    delete process.env.OPENLEN_INTERNAL_SECRET;
    vi.clearAllMocks();
  });

  it("401 sin header de secreto", async () => {
    process.env.OPENLEN_INTERNAL_SECRET = "s3cr3t";
    expect((await post({}, { projectIds: ["a"] })).status).toBe(401);
  });

  it("401 si el secreto del entorno no está seteado (fail-closed)", async () => {
    expect((await post({ "x-internal-secret": "anything" }, { projectIds: ["a"] })).status).toBe(401);
  });

  it("401 con secreto del mismo largo pero equivocado, y sin tocar la DB", async () => {
    process.env.OPENLEN_INTERNAL_SECRET = "s3cr3t";
    const res = await post({ "x-internal-secret": "s3cr4t" }, { projectIds: ["a"] });
    expect(res.status).toBe(401);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("400 sin projectIds", async () => {
    process.env.OPENLEN_INTERNAL_SECRET = "s3cr3t";
    const res = await post({ "x-internal-secret": "s3cr3t" }, {});
    expect(res.status).toBe(400);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("republica solo lo que la DB confirma publicado; lo demás va a skipped", async () => {
    process.env.OPENLEN_INTERNAL_SECRET = "s3cr3t";
    rowsResult([{ id: "a", userId: "u1", subdomain: "a-sub" }]);
    const res = await post({ "x-internal-secret": "s3cr3t" }, { projectIds: ["a", "draft-b"] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.republished).toEqual(["a"]);
    expect(body.skipped).toEqual(["draft-b"]);
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith({
      projectId: "a",
      userId: "u1",
      subdomain: "a-sub",
      skipFlightCheck: true,
    });
  });

  it("un publish que truena no aborta el batch (aislamiento por proyecto)", async () => {
    process.env.OPENLEN_INTERNAL_SECRET = "s3cr3t";
    rowsResult([
      { id: "a", userId: "u1", subdomain: "a-sub" },
      { id: "b", userId: "u1", subdomain: "b-sub" },
    ]);
    publishMock.mockRejectedValueOnce(new Error("boom"));
    const res = await post({ "x-internal-secret": "s3cr3t" }, { projectIds: ["a", "b"] });
    const body = await res.json();
    expect(body.republished).toEqual(["b"]);
    expect(body.failed).toEqual([{ id: "a", reason: "boom" }]);
  });
});
