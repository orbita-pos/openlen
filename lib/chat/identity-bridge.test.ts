import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import {
  generateUniqueUsername,
  createGuestChatUser,
  findOrCreateMemberChatUser,
  getChatUserByMemberId,
} from "./store";

const PID = "test-identity-" + Math.abs(hashStr("identity-bridge")).toString(36);
function hashStr(s: string){let h=0;for(let i=0;i<s.length;i++){h=(h<<5)-h+s.charCodeAt(i)|0}return h}

beforeAll(async () => {
  // Seed a throwaway user (required by projects FK). Uses a deterministic id
  // so re-runs don't create duplicates.
  const UID = PID + "-u";
  await db.insert(schema.users).values({
    id: UID, email: `${PID}@test.invalid`, name: "Test",
  }).onConflictDoNothing();
  // a throwaway project row (FKs require it); ignore if it already exists
  await db.insert(schema.projects).values({
    id: PID, userId: UID, title: "Identity Test", brief: "t",
    data: { html: "<html lang='es'></html>" },
  }).onConflictDoNothing();
  await db.delete(schema.chatUsers).where(eq(schema.chatUsers.projectId, PID));
});

describe("unified chat identity helpers", () => {
  it("generates a valid, unique username", async () => {
    const u = await generateUniqueUsername(PID, "María José!! ");
    expect(u).toMatch(/^[a-z][a-z0-9_]{2,19}$/);
  });

  it("creates a passwordless guest with displayName + email", async () => {
    const g = await createGuestChatUser(PID, { displayName: "Cliente Uno", email: "c1@x.com" });
    const row = (await db.select().from(schema.chatUsers).where(eq(schema.chatUsers.id, g.id)).limit(1))[0];
    expect(row.passwordHash).toBeNull();
    expect(row.displayName).toBe("Cliente Uno");
    expect(row.email).toBe("c1@x.com");
    expect(row.role).toBe("member");
  });

  it("find-or-create for a member is idempotent (dedups by memberId)", async () => {
    const member = { id: "m-123", name: "Ana Pérez", email: "ana@x.com" };
    const a = await findOrCreateMemberChatUser(PID, member);
    const b = await findOrCreateMemberChatUser(PID, member);
    expect(a.id).toBe(b.id);
    const found = await getChatUserByMemberId(PID, "m-123");
    expect(found?.id).toBe(a.id);
    const row = (await db.select().from(schema.chatUsers).where(eq(schema.chatUsers.id, a.id)).limit(1))[0];
    expect(row.passwordHash).toBeNull();
    expect(row.memberId).toBe("m-123");
    expect(row.displayName).toBe("Ana Pérez");
  });
});
