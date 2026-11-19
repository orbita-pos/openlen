import { describe, expect, it } from "vitest";
import { collectPathRules, parseCustomRuleFile } from "./path-rules";

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

  it("parses and matches custom project rules under /.len/rules/*.md with YAML paths", () => {
    const ruleText = "---\npaths:\n  - src/api/**\n  - src/hooks/*.ts\n---\nAlways validate payloads with Zod before calling fetch.";
    const parsed = parseCustomRuleFile("/.len/rules/api.md", ruleText);
    expect(parsed).toEqual({
      id: "project:/.len/rules/api.md",
      globs: ["src/api/**", "src/hooks/*.ts"],
      body: "Always validate payloads with Zod before calling fetch.",
    });

    const seen = new Set<string>();
    const files = { "/.len/rules/api.md": ruleText };
    expect(collectPathRules("/.len/rules/api.md", seen, files)).toBeNull(); // reading the rule file itself doesn't trigger
    expect(collectPathRules("/src/api/orders.ts", seen, files)).toContain("Always validate payloads with Zod");
    expect(collectPathRules("/src/hooks/useOrders.ts", seen, files)).toBeNull(); // deduplicated once per turn
  });
});
