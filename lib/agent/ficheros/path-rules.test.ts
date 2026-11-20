import { describe, expect, it } from "vitest";
import { collectPathRules } from "./path-rules";

describe("just-in-time path rules (Plan Ruta 98 %, P2)", () => {
  it("matches built-in Supabase migration rules once per turn and stays silent on ordinary pages", () => {
    const seen = new Set<string>();
    expect(collectPathRules("/index.html", seen)).toBeNull();
    expect(collectPathRules("/src/App.tsx", seen)).toBeNull();

    const first = collectPathRules("/supabase/migrations/001_orders.sql", seen);
    expect(first).toContain("<path-rules for=\"/supabase/migrations/001_orders.sql\">");
    expect(first).toContain("ENABLE ROW LEVEL SECURITY");

    // Second migration in the same turn does not repeat the already-injected rule.
    expect(collectPathRules("/supabase/migrations/002_items.sql", seen)).toBeNull();
  });

  it("matches Edge Functions, config.toml, package.json and motion artifacts", () => {
    const seen = new Set<string>();
    expect(collectPathRules("/supabase/functions/stripe/index.ts", seen)).toContain("verify_jwt = false");
    expect(collectPathRules("/supabase/config.toml", seen)).toBeNull(); // same rule id already seen
    expect(collectPathRules("/package.json", seen)).toContain("app catalog");
    expect(collectPathRules("/.len/artifacts/vid1/motion.json", seen)).toContain("immediateRender: false");
  });

  // C2: the manifest rule is the ROOT's package.json (as folder.ts treats it), not any file of that name.
  it("the package.json rule fires for /package.json only, not for npm's or a folder's package.json", () => {
    expect(collectPathRules("/package.json", new Set())).toContain("app catalog");
    expect(collectPathRules("/node_modules/x/package.json", new Set())).toBeNull();
    expect(collectPathRules("/node_modules/@scope/pkg/package.json", new Set())).toBeNull();
    expect(collectPathRules("/src/a/package.json", new Set())).toBeNull();
    expect(collectPathRules("/a/package.json", new Set())).toBeNull();
  });
});
