// @vitest-environment node
// The publish gates in one function: what the publish route answers, and what Len Watch gets when it
// publishes a fix — the same codes, the same 428s, nothing skipped.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ publishProject: vi.fn(), gate: vi.fn(), markPublished: vi.fn(async () => undefined), afterOwnerPublish: vi.fn(async () => undefined) }));
vi.mock("@/lib/security-review/real", () => ({ securityReviewer: () => ({ gate: mocks.gate, markPublished: mocks.markPublished }) }));
vi.mock("@/lib/len-watch/orchestrate", () => ({ afterOwnerPublish: mocks.afterOwnerPublish }));
vi.mock("@/lib/projects", async () => {
  class E extends Error {}
  return {
    publishProject: mocks.publishProject,
    ProjectNotFoundError: class extends E {},
    SubdomainInvalidError: class extends E {},
    SubdomainLimitError: class extends E {},
    SubdomainTakenError: class extends E {},
  };
});

const { publishThroughGates } = await import("./publish-through-gates");
const { DataChangesNeedConfirmationError } = await import("@/lib/backend/data-changes");

const INPUT = { projectId: "p1", actorId: "u1", ownerId: "u1", subdomain: "holi", source: "person" as const };
const VIEW = { fingerprint: "f".repeat(64) };

beforeEach(() => {
  mocks.publishProject.mockReset();
  mocks.gate.mockReset();
  mocks.markPublished.mockClear();
  mocks.afterOwnerPublish.mockClear();
  mocks.gate.mockResolvedValue({ kind: "open", view: VIEW });
});

describe("publishThroughGates", () => {
  it("a HIGH finding nobody accepted: 428 security_findings, nothing published", async () => {
    mocks.gate.mockResolvedValueOnce({ kind: "blocked", view: { ...VIEW, blocking: [1] } });
    const r = await publishThroughGates(INPUT);
    expect(r.status).toBe(428);
    expect(r.body).toMatchObject({ error: "security_findings", fingerprint: VIEW.fingerprint });
    expect(mocks.publishProject).not.toHaveBeenCalled();
  });

  it("the review still running: 428 security_review_pending", async () => {
    mocks.gate.mockResolvedValueOnce({ kind: "pending", view: VIEW });
    expect(await publishThroughGates(INPUT)).toEqual({ status: 428, body: { error: "security_review_pending", fingerprint: VIEW.fingerprint } });
  });

  it("real data would be deleted: the 428 of the data gate", async () => {
    mocks.publishProject.mockRejectedValueOnce(new DataChangesNeedConfirmationError([], "a".repeat(64)));
    const r = await publishThroughGates(INPUT);
    expect(r.status).toBe(428);
    expect(r.body.error).toBe("confirmation_required");
  });

  it("published: 200 with the result, and it becomes the review's base", async () => {
    mocks.publishProject.mockResolvedValueOnce({ subdomain: "holi", url: "https://holi.openlen.app" });
    const r = await publishThroughGates(INPUT);
    expect(r).toEqual({ status: 200, body: { subdomain: "holi", url: "https://holi.openlen.app" } });
    expect(mocks.markPublished).toHaveBeenCalledWith("p1", VIEW.fingerprint);
    expect(mocks.publishProject.mock.calls[0]![0]).toMatchObject({ projectId: "p1", userId: "u1", subdomain: "holi", dataChanges: { mode: "owner" } });
  });

  it("a person's publish tells Len Watch; Len Watch's own doesn't", async () => {
    mocks.publishProject.mockResolvedValue({ subdomain: "holi" });
    await publishThroughGates(INPUT);
    await vi.waitFor(() => expect(mocks.afterOwnerPublish).toHaveBeenCalledWith("p1"));
    mocks.afterOwnerPublish.mockClear();
    await publishThroughGates({ ...INPUT, source: "len_watch" });
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.afterOwnerPublish).not.toHaveBeenCalled();
  });

  it("a failed publish doesn't tell Len Watch", async () => {
    mocks.publishProject.mockRejectedValueOnce(new Error("disco lleno"));
    expect((await publishThroughGates(INPUT)).status).toBe(500);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.afterOwnerPublish).not.toHaveBeenCalled();
  });
});
