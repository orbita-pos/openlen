// Reading a project's base read-only (lib/backend/live-read.ts): the read-only role is set up once per database in
// this process, not on every read — the event tasks read every minute per task, and each setup rewrote the role's
// password and grants (final review I9).
import { beforeEach, describe, expect, it, vi } from "vitest";

const provision = vi.hoisted(() => vi.fn(async () => {}));
const run = vi.hoisted(() => vi.fn(async () => ({ kind: "rows", columns: ["n"], rows: [[1]], truncated: false })));
vi.mock("server-only", () => ({}));
vi.mock("./registry", () => ({ getBackendByProject: async () => ({ ref: "ref1" }) }));
vi.mock("./environments", () => ({
  getEnvironment: async (projectId: string) => ({ provisionedAt: new Date(), scope: `scope-${projectId}`, readOnlyPasswordEncrypted: "enc" }),
  claimReadOnlyPassword: async () => "enc",
}));
vi.mock("./pg", () => ({ backendConfigured: () => true }));
vi.mock("../integrations/crypto", () => ({ encryptToken: (s: string) => s, decryptToken: () => "secret" }));
vi.mock("./keys", () => ({ newDatabasePassword: () => "pw" }));
vi.mock("./read-only", () => ({ provisionReadOnlyRole: provision }));
vi.mock("./sql-query", () => ({ runLiveQuery: run }));

const { forgetReadOnlyRoles, queryLive } = await import("./live-read");

beforeEach(() => {
  provision.mockReset();
  provision.mockImplementation(async () => {});
  run.mockClear();
  forgetReadOnlyRoles();
});

describe("queryLive", () => {
  it("sets the read-only role up once per database, then only reads", async () => {
    await queryLive("p1", "select 1");
    await queryLive("p1", "select 2");
    await queryLive("p1", "select 3");
    expect(provision).toHaveBeenCalledTimes(1);
    expect(run.mock.calls.map((c) => (c as unknown[])[1])).toEqual(["select 1", "select 2", "select 3"]);
    await queryLive("p2", "select 1");
    expect(provision).toHaveBeenCalledTimes(2);
  });

  it("a setup that failed is tried again on the next read", async () => {
    provision.mockRejectedValueOnce(new Error("tuple concurrently updated"));
    await expect(queryLive("p1", "select 1")).rejects.toThrow("tuple concurrently updated");
    await queryLive("p1", "select 1");
    expect(provision).toHaveBeenCalledTimes(2);
  });
});
