// CRUD for saved business profiles ("Mi negocio"). Per-user; a user may have
// several (one per business). Exactly one is `isDefault` — the one a new page
// seeds from when none is explicitly picked. The first profile a user creates
// becomes the default automatically.

import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { normalizeProfileData } from "./normalize";
import type { BusinessProfile, BusinessProfileData } from "./types";

export async function listProfiles(userId: string): Promise<BusinessProfile[]> {
  return db
    .select()
    .from(schema.businessProfiles)
    .where(eq(schema.businessProfiles.userId, userId))
    .orderBy(
      desc(schema.businessProfiles.isDefault),
      desc(schema.businessProfiles.updatedAt),
    );
}

export async function getProfile(
  userId: string,
  id: string,
): Promise<BusinessProfile | null> {
  const rows = await db
    .select()
    .from(schema.businessProfiles)
    .where(
      and(
        eq(schema.businessProfiles.id, id),
        eq(schema.businessProfiles.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createProfile(
  userId: string,
  input: { name: string; data: BusinessProfileData; isDefault?: boolean },
): Promise<BusinessProfile> {
  const existing = await db
    .select({ id: schema.businessProfiles.id })
    .from(schema.businessProfiles)
    .where(eq(schema.businessProfiles.userId, userId))
    .limit(1);
  const makeDefault = input.isDefault ?? existing.length === 0;
  if (makeDefault) await clearDefault(userId);
  const rows = await db
    .insert(schema.businessProfiles)
    .values({
      id: crypto.randomUUID(),
      userId,
      name: input.name,
      data: input.data,
      isDefault: makeDefault,
    })
    .returning();
  return rows[0];
}

export async function updateProfile(
  userId: string,
  id: string,
  patch: { name?: string; data?: BusinessProfileData },
): Promise<BusinessProfile | null> {
  const set: Partial<typeof schema.businessProfiles.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.data !== undefined) set.data = patch.data;
  const rows = await db
    .update(schema.businessProfiles)
    .set(set)
    .where(
      and(
        eq(schema.businessProfiles.id, id),
        eq(schema.businessProfiles.userId, userId),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function deleteProfile(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.businessProfiles)
    .where(
      and(
        eq(schema.businessProfiles.id, id),
        eq(schema.businessProfiles.userId, userId),
      ),
    )
    .returning({ id: schema.businessProfiles.id });
  return rows.length > 0;
}

export async function setDefaultProfile(
  userId: string,
  id: string,
): Promise<BusinessProfile | null> {
  const target = await getProfile(userId, id);
  if (!target) return null;
  await clearDefault(userId);
  const rows = await db
    .update(schema.businessProfiles)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.businessProfiles.id, id),
        eq(schema.businessProfiles.userId, userId),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

async function clearDefault(userId: string): Promise<void> {
  await db
    .update(schema.businessProfiles)
    .set({ isDefault: false })
    .where(
      and(
        eq(schema.businessProfiles.userId, userId),
        eq(schema.businessProfiles.isDefault, true),
      ),
    );
}

// The user's default business, creating an empty one ("Mi negocio") if they
// have none — so every user always has ≥1 business once they reach the
// profiles list or create a page. Idempotent.
export async function ensureDefaultProfile(
  userId: string,
): Promise<BusinessProfile> {
  const existing = await listProfiles(userId); // isDefault-desc, updatedAt-desc
  const current = existing[0];
  if (current?.isDefault) return current;
  // Profiles exist but none is marked default (legacy / cleared) — promote one.
  if (current) return (await setDefaultProfile(userId, current.id)) ?? current;
  // No profiles yet — create the default. The partial unique index makes the
  // create race-safe: a concurrent first-create loses the insert, so refetch.
  try {
    return await createProfile(userId, {
      name: "Mi negocio",
      data: normalizeProfileData({}),
      isDefault: true,
    });
  } catch {
    const after = await listProfiles(userId);
    if (after[0]) return after[0];
    throw new Error("ensureDefaultProfile: could not create or find a default");
  }
}

// Which business a newly created page belongs to: the explicitly picked one
// (if it's the user's), else their default (created if missing). Association
// is never optional — every page gets a business.
export async function resolveProfileForCreation(
  userId: string,
  explicitId?: string | null,
): Promise<BusinessProfile> {
  if (explicitId) {
    const picked = await getProfile(userId, explicitId);
    if (picked) return picked;
  }
  return ensureDefaultProfile(userId);
}
