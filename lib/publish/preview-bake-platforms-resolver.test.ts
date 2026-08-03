// DB-integration regression test: bakeModulesForPreview's platforms lookup
// must reuse projectBusinessProfile's linked-first-else-default resolution
// (lib/business-profiles/whatsapp-default.ts), not stop at a strict
// projects.profileId join. projects.profileId is ON DELETE SET NULL and the
// product already treats that state as real and recurring (lib/projects.ts's
// orphaned-page re-home) — a project with no explicit link but an owner who
// has a default business with real platform links must still fill the band.
//
// Needs a live DB (same pattern as lib/chat/identity-bridge.test.ts), so this
// lives under vitest (global-setup injects .env.local) rather than
// preview-bake.test.ts's node:test runner, which has no DB env loaded.
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { bakeModulesForPreview } from "./preview-bake";
import type { BusinessProfileData } from "@/lib/business-profiles/types";

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

const SEED = "preview-bake-platforms-resolver";
const UID = "test-" + SEED + "-u-" + Math.abs(hashStr(SEED)).toString(36);
const PROFILE_ID = "test-" + SEED + "-profile-" + Math.abs(hashStr(SEED)).toString(36);
const PID_LINKED = "test-" + SEED + "-linked-" + Math.abs(hashStr(SEED)).toString(36);
const PID_NULL = "test-" + SEED + "-null-" + Math.abs(hashStr(SEED)).toString(36);

const HTML =
  '<!doctype html><html lang="es"><body><section data-ol-platforms-section></section></body></html>';

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: UID, email: `${SEED}@test.invalid`, name: "Test" })
    .onConflictDoNothing();
  await db.delete(schema.projects).where(eq(schema.projects.id, PID_LINKED));
  await db.delete(schema.projects).where(eq(schema.projects.id, PID_NULL));
  await db.delete(schema.businessProfiles).where(eq(schema.businessProfiles.id, PROFILE_ID));
  await db.insert(schema.businessProfiles).values({
    id: PROFILE_ID,
    userId: UID,
    name: "Test Business",
    data: { links: [{ type: "twitch", url: "kira" }] } as BusinessProfileData,
    isDefault: true,
  });
  await db.insert(schema.projects).values({
    id: PID_LINKED,
    userId: UID,
    title: "Platforms resolver — linked",
    brief: "t",
    profileId: PROFILE_ID,
    data: { html: HTML },
  });
  await db.insert(schema.projects).values({
    id: PID_NULL,
    userId: UID,
    title: "Platforms resolver — no explicit link",
    brief: "t",
    profileId: null,
    data: { html: HTML },
  });
});

describe("bakeModulesForPreview — platforms resolver", () => {
  it("an explicitly linked profile fills the band", async () => {
    const out = await bakeModulesForPreview(HTML, {
      projectId: PID_LINKED,
      title: "t",
      sub: null,
      page: null,
      data: { html: HTML },
    });
    expect(out).toContain('href="https://twitch.tv/kira"');
  });

  it("profileId NULL falls back to the user's DEFAULT profile — same resolution as projectBusinessProfile", async () => {
    const out = await bakeModulesForPreview(HTML, {
      projectId: PID_NULL,
      title: "t",
      sub: null,
      page: null,
      data: { html: HTML },
    });
    expect(out).toContain('href="https://twitch.tv/kira"');
  });

  it("skips the profile lookup entirely when no document carries the band (gate)", async () => {
    const noBand = '<!doctype html><html lang="es"><body><h1>hola</h1></body></html>';
    const out = await bakeModulesForPreview(noBand, {
      projectId: PID_NULL,
      title: "t",
      sub: null,
      page: null,
      data: { html: noBand },
    });
    expect(out).toBe(noBand);
  });
});
