// El volcado del esquema `realtime` de Supabase Realtime (sus 88 migraciones ya
// aplicadas, para Postgres 17), vendido tal cual y fijado a un commit.
import { describe, expect, it } from "vitest";

import { REALTIME_DUMP_SQL, REALTIME_SHA } from "./schema-dump";

describe("el volcado del esquema realtime de Supabase, vendido", () => {
  it("fijado a un commit, y es el de Postgres 17 entero", () => {
    expect(REALTIME_SHA).toBe("f86df8c33ef0d014d009e4ff55e3ba18a546cb07");
    expect(REALTIME_DUMP_SQL).toContain("-- Tenant `realtime` schema for Postgres 17");
    for (const f of ["realtime.apply_rls(", "realtime.list_changes(", "realtime.subscription_check_filters()", "realtime.topic()"]) {
      expect(REALTIME_DUMP_SQL, f).toContain(`CREATE FUNCTION ${f}`);
    }
  });

  it("lleva sus 88 versiones de migración", () => {
    const versiones = REALTIME_DUMP_SQL.match(/\b20\d{12}\b/g) ?? [];
    expect(new Set(versiones).size).toBeGreaterThanOrEqual(88);
  });
});
