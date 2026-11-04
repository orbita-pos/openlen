// @vitest-environment node
//
// An app's users, read for an event task (spec local 2026-11-04-hazlo, §7.6.5): production's base, as GoTrue's admin
// role reads them — never Len's read-only role, which keeps not seeing `auth.users` — and in a READ ONLY transaction.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { newTestProject, type TestProject } from "../testing/project";

const live = vi.hoisted(() => ({ project: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/backend/owner-access", () => ({ liveBackendProject: async () => live.project }));

const { readLiveAuthUsers } = await import("./live-users");

let t: TestProject;
beforeEach(async () => {
  t = await newTestProject("");
  live.project = t.project;
});

describe("readLiveAuthUsers", () => {
  it("the users read is read-only", async () => {
    await expect(readLiveAuthUsers("p1", (q) => q(`insert into auth.users (id, aud) values ('00000000-0000-0000-0000-0000000000aa', 'authenticated')`))).rejects.toThrow(/read-only/);
  });

  it("reads auth.users as the auth admin", async () => {
    expect(await readLiveAuthUsers("p1", async (q) => Number((await q("select count(*)::int as n from auth.users")).rows[0]!.n))).toBe(0);
  });

  it("no live base gives null", async () => {
    live.project = null;
    expect(await readLiveAuthUsers("p1", async () => 1)).toBeNull();
  });
});

describe("readLiveAuthUsers's limits (final review I3)", () => {
  it("a slow or locked read gives up instead of holding the live app's connection", async () => {
    const out = await readLiveAuthUsers("p1", async (q) => ({
      statement: String((await q("show statement_timeout")).rows[0]!.statement_timeout),
      lock: String((await q("show lock_timeout")).rows[0]!.lock_timeout),
    }));
    expect(out).toEqual({ statement: "10s", lock: "5s" });
  });
});
