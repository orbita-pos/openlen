// Las migraciones del esquema `storage`, las de supabase/storage tal cual,
// fijadas a un commit (scripts/backend-vendor-storage.ts).
import { describe, expect, it } from "vitest";

import { STORAGE_MIGRATIONS, STORAGE_SHA } from "./migrations";

describe("migraciones de supabase/storage vendidas", () => {
  it("son las 73, fijadas a un commit y en orden", () => {
    expect(STORAGE_SHA).toBe("eccef5e70a67fb4030e0646e5e22602c94f568bc");
    expect(STORAGE_MIGRATIONS).toHaveLength(73);
    expect(STORAGE_MIGRATIONS.map((m) => m.id)).toEqual(Array.from({ length: 73 }, (_, i) => i + 1));
    expect(STORAGE_MIGRATIONS[0]!.name).toBe("initialmigration");
    expect(STORAGE_MIGRATIONS[1]!.sql).toContain('CREATE TABLE IF NOT EXISTS "storage"."objects"');
  });

  it("traen las directivas de su corredor tal cual", () => {
    expect(STORAGE_MIGRATIONS.filter((m) => m.sql.includes("-- postgres-migrations ignore"))).toHaveLength(16);
    expect(STORAGE_MIGRATIONS.filter((m) => m.sql.includes("-- storage-migrations generate-sql"))).toHaveLength(1);
  });
});
