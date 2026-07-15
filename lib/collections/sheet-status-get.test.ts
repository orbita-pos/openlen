// @vitest-environment node
//
// Task 16: the collections items GET route must expose sheetBacked + sheetUrl
// so the editor panel can render a read-only banner instead of the owner
// silently hitting a 409 on their first edit attempt (Task 15). Exercises the
// real GET handler against the real DB — mirrors the DB setup pattern in
// ./read-only-http.test.ts (seed user + project + default collection, then
// setCollectionSource to flip it sheet-backed).
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { db, schema } from "../db";
import { getOrCreateDefaultCollection, setCollectionSource } from "./store";

const { PID, UID } = vi.hoisted(() => {
  const PID = "test-sheet-status-get-collections";
  const UID = PID + "-u";
  return { PID, UID };
});

// The route calls auth() first; mock it to a session for our seeded user so
// the real ownership check (owns(projectId, userId) against the DB) passes.
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: UID } })),
}));

import { GET as getItems } from "@/app/api/projects/[id]/collections/items/route";

const FAKE_SHEET = "https://docs.google.com/spreadsheets/d/sheetstatusget/edit#gid=0";

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: UID, email: `${PID}@test.invalid`, name: "Test" })
    .onConflictDoNothing();
  await db
    .insert(schema.projects)
    .values({ id: PID, userId: UID, title: "Sheet Status GET Test", brief: "t", data: { html: "<html lang='es'></html>" } })
    .onConflictDoNothing();
  await getOrCreateDefaultCollection(PID, { name: "Menu", preset: "menu" });
});

beforeEach(async () => {
  await setCollectionSource(PID, null);
});

function params() {
  return { params: Promise.resolve({ id: PID }) };
}

describe("GET /collections/items exposes sheetBacked + sheetUrl", () => {
  it(
    "no source set → sheetBacked:false, sheetUrl:null",
    async () => {
      const req = new Request(`http://localhost/api/projects/${PID}/collections/items`);
      const res = await getItems(req, params());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sheetBacked).toBe(false);
      expect(body.sheetUrl).toBeNull();
      // Purely additive — the existing shape must still be there.
      expect(body).toHaveProperty("collection");
      expect(body).toHaveProperty("items");
    },
    30000,
  );

  it(
    "sheet source set → sheetBacked:true, sheetUrl:<the sheet>",
    async () => {
      await setCollectionSource(PID, { sheet: FAKE_SHEET });
      const req = new Request(`http://localhost/api/projects/${PID}/collections/items`);
      const res = await getItems(req, params());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sheetBacked).toBe(true);
      expect(body.sheetUrl).toBe(FAKE_SHEET);
    },
    30000,
  );
});
