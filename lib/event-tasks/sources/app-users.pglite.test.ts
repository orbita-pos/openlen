// @vitest-environment node
//
// The `app_users` source (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.4.2, §7.6.5): an app's new sign-ups,
// from its production base's `auth.users`, read apart from Len's read-only role. Its id, email, when, and the user's
// metadata — never a password or a token. Against a real project base (PGlite, the backend's own test project).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { newTestProject, type TestProject } from "@/lib/backend/testing/project";

const live = vi.hoisted(() => ({ project: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/backend/owner-access", () => ({ liveBackendProject: async () => live.project }));

const { appUsersSource } = await import("./app-users");
const CTX = { timeZone: "UTC", now: new Date("2026-11-04T12:00:00Z"), ownerId: "owner" };

let t: TestProject;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = (n: number, email: string | null, at: string, o: { meta?: Record<string, unknown>; anonymous?: boolean; deleted?: boolean } = {}) =>
  t.pg.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, confirmation_token, raw_user_meta_data, created_at, updated_at, is_anonymous, deleted_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, 'bcrypt-hash-of-the-password', $7, $3, $4, $4, $5, $6)`,
    [id(n), email, JSON.stringify(o.meta ?? {}), at, o.anonymous ?? false, o.deleted ? at : null, `secret-confirmation-token-${n}`],
  );

async function started() {
  const v = await appUsersSource.validate("p1", {}, CTX);
  if (!v.ok) throw new Error(v.reason);
  return v.initialState;
}

beforeEach(async () => {
  t = await newTestProject("");
  live.project = t.project;
});

describe("app_users", () => {
  it("a new sign-up is a change with its email and metadata, never its password or tokens", async () => {
    const state = await started();
    await user(1, "ana@acme.com", "2026-11-04 10:00:00+00", { meta: { full_name: "Ana", company: "Acme", email: "ignored@x.com" } });
    const o = await appUsersSource.observe("p1", {}, state, CTX);
    expect(o.changes).toHaveLength(1);
    expect(o.changes[0]).toMatchObject({
      subject: "users",
      summary: "ana@acme.com",
      link: id(1),
      detail: { id: id(1), email: "ana@acme.com", created_at: expect.stringContaining("2026-11-04 10:00:00"), full_name: "Ana", company: "Acme" },
    });
    const read = await appUsersSource.read("p1", {}, { keys: [id(1)], state, ctx: CTX });
    const everything = JSON.stringify([o, read]);
    expect(everything).not.toContain("bcrypt-hash-of-the-password");
    expect(everything).not.toContain("secret-confirmation-token");
    expect(everything).not.toContain("ignored@x.com");
  });

  it("anonymous and deleted users are not sign-ups", async () => {
    const state = await started();
    await user(1, null, "2026-11-04 10:00:00+00", { anonymous: true });
    await user(2, "gone@x.com", "2026-11-04 10:00:01+00", { deleted: true });
    await user(3, "luis@x.com", "2026-11-04 10:00:02+00");
    expect((await appUsersSource.observe("p1", {}, state, CTX)).changes.map((c) => c.link)).toEqual([id(3)]);
  });

  it("two sign-ups in one microsecond both arrive, once", async () => {
    const state = await started();
    await user(1, "a@x.com", "2026-11-04 10:00:00.123456+00");
    await user(2, "b@x.com", "2026-11-04 10:00:00.123456+00");
    const first = await appUsersSource.observe("p1", {}, state, CTX);
    expect(first.changes.map((c) => c.link)).toEqual([id(1), id(2)]);
    expect((await appUsersSource.observe("p1", {}, first.state, CTX)).changes).toEqual([]);
  });

  it("what existed when the task was made never fires", async () => {
    await user(1, "old@x.com", "2026-11-01 10:00:00+00");
    const state = await started();
    expect((await appUsersSource.observe("p1", {}, state, CTX)).changes).toEqual([]);
  });

  it("without a production base the task is refused with how to fix it", async () => {
    live.project = null;
    expect(await appUsersSource.validate("p1", {}, CTX)).toEqual({ ok: false, reason: expect.stringMatching(/publish/i) });
  });

  it("match on a metadata field finds older sign-ups; two fields at once is refused", async () => {
    await user(1, "ana@acme.com", "2026-11-01 10:00:00+00", { meta: { company: "Acme" } });
    await user(2, "eva@other.com", "2026-11-02 10:00:00+00", { meta: { company: "Other" } });
    const state = await started();
    const read = (await appUsersSource.read("p1", {}, { keys: [], state, match: [{ field: "company", value: "Acme" }], ctx: CTX })) as { matching: { id: string }[]; previous: { id: string }[] };
    expect(read.matching.map((r) => r.id)).toEqual([id(1)]);
    expect(read.previous.map((r) => r.id)).toEqual([id(2), id(1)]);
    await expect(
      appUsersSource.read("p1", {}, { keys: [], state, match: [{ field: "company", value: "Acme" }, { field: "email", value: "x" }], ctx: CTX }),
    ).rejects.toMatchObject({ reason: "column_missing" });
  });
});
