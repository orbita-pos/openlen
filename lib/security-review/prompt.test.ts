import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FILTER_SYSTEM,
  MAX_FILES_IN_PROMPT,
  SCAN_SYSTEM,
  filterFindingMessage,
  languageName,
  projectContextMessage,
  scanFocusMessage,
} from "./prompt";
import type { Finding, ReviewInputs } from "./types";

const inputs = (over: Partial<ReviewInputs> = {}): ReviewInputs => ({
  projectId: "p1",
  ownerId: "u1",
  app: null,
  homeHtml: "<h1>Hola</h1>",
  pages: {},
  files: {
    "/src/App.tsx": "import { createClient } from '@supabase/supabase-js'",
    "/src/estilos.css": "body{}",
    "/supabase/functions/cobrar/index.ts": "Deno.serve(() => new Response('ok'))",
    "/supabase/migrations/20261015_pedidos.sql": "create table pedidos();",
  },
  productionEnv: {},
  hasBackend: true,
  schema: {
    tables: [{ name: "productos", rls: false }, { name: "pedidos", rls: true }],
    policies: [{ schema: "public", table: "pedidos", name: "cualquiera edita", command: "UPDATE", permissive: true, roles: ["anon"], using: "true", withCheck: null }],
    buckets: [{ id: "fotos", public: true }],
  },
  ...over,
});
const rls: Finding = { key: "rls_disabled:public.productos", source: "rule", severity: "HIGH", category: "rls_disabled", file: null, line: null, description: "", exploitScenario: "", recommendation: "", params: { table: "productos" } };

describe("the method (adapted from anthropics/claude-code-security-review, MIT)", () => {
  it("the identifying pass keeps the method: high confidence, exclusions, categories, JSON", () => {
    for (const s of ["HIGH-CONFIDENCE", ">80% confident", "Denial of Service", "SQL injection", "exploit_scenario", "\"confidence\"", "FINAL REMINDER"]) {
      expect(SCAN_SYSTEM).toContain(s);
    }
  });

  it("both passes carry OpenLen's facts: RLS is the boundary, the publishable key is public, verify_jwt", () => {
    for (const s of ["Row Level Security", "PUBLISHABLE key", "verify_jwt = false", "import.meta.env"]) {
      expect(SCAN_SYSTEM).toContain(s);
      expect(FILTER_SYSTEM).toContain(s);
    }
  });

  it("the filter keeps its hard exclusions, precedents and answer", () => {
    for (const s of ["HARD EXCLUSIONS", "PRECEDENTS", "React is generally secure against XSS", "confidence_score", "keep_finding", "Read, Grep and Glob"]) {
      expect(FILTER_SYSTEM).toContain(s);
    }
  });

  it("the source keeps the MIT notice and names its licence file", () => {
    const source = readFileSync(join(process.cwd(), "lib", "security-review", "prompt.ts"), "utf8");
    expect(source).toContain("Copyright (c) 2025 Anthropic");
    expect(source).toContain("LICENSES/claude-code-security-review.MIT.txt");
  });
});

describe("the messages", () => {
  it("the project context has the schema, the phase 0 findings and the files, migrations first", () => {
    const m = projectContextMessage({ inputs: inputs(), phase0: [rls] });
    expect(m).toContain("table public.productos — RLS OFF");
    expect(m).toContain("table public.pedidos — RLS on");
    expect(m).toContain('policy "cualquiera edita" on public.pedidos FOR UPDATE TO anon USING (true)');
    expect(m).toContain("bucket fotos — public");
    expect(m).toContain("- rls_disabled: table public.productos has RLS off");
    const files = m.split("FILES")[1]!;
    expect(files.indexOf("/supabase/migrations/20261015_pedidos.sql")).toBeLessThan(files.indexOf("/supabase/functions/cobrar/index.ts"));
    expect(files.indexOf("/supabase/functions/cobrar/index.ts")).toBeLessThan(files.indexOf("/src/App.tsx"));
    expect(files.indexOf("/src/App.tsx")).toBeLessThan(files.indexOf("/src/estilos.css"));
  });

  it("without a draft database it says so", () => {
    expect(projectContextMessage({ inputs: inputs({ schema: null }), phase0: [] })).toContain("(this project has no draft database)");
  });

  it("lists at most 300 files and says how many more there are", () => {
    const files = Object.fromEntries(Array.from({ length: MAX_FILES_IN_PROMPT + 5 }, (_, k) => [`/js/f${String(k).padStart(3, "0")}.js`, "x"]));
    const m = projectContextMessage({ inputs: inputs({ files }), phase0: [] });
    expect(m).toContain("(6 more files not listed: use Glob and Grep to find them)");
  });

  it("the focus names the language, what changed and what the owner accepted", () => {
    const m = scanFocusMessage({ scope: { kind: "changes", changed: ["/src/App.tsx"], diff: "diff --git a/src/App.tsx b/src/App.tsx\n+const k = 1;\n" }, accepted: [rls], language: "Spanish" });
    expect(m).toContain("in Spanish");
    expect(m).toContain("public.productos");
  });

  it("🔴 after a publish it scopes the review like Claude Code: the diff, only what it newly adds, nothing that already existed", () => {
    const m = scanFocusMessage({ scope: { kind: "changes", changed: ["/src/App.tsx"], diff: "diff --git a/src/App.tsx b/src/App.tsx\n+const k = 1;\n" }, accepted: [], language: "English" });
    expect(m).toContain("FILES MODIFIED:\n/src/App.tsx");
    expect(m).toContain("DIFF CONTENT:");
    expect(m).toContain("+const k = 1;");
    expect(m).toContain("Focus ONLY on security implications newly added by these changes");
    expect(m).toContain("Do not comment on existing security concerns");
  });

  it("the first review, with nothing published before, covers everything", () => {
    const m = scanFocusMessage({ scope: { kind: "whole" }, accepted: [], language: "English" });
    expect(m).toContain("FIRST REVIEW");
    expect(m).toContain("review everything");
    expect(m).not.toContain("Do not comment on existing security concerns");
  });

  it("a diff too big is left out, as Claude Code does: the files are listed to read", () => {
    const m = scanFocusMessage({ scope: { kind: "changes", changed: ["/src/a.ts", "/src/b.ts"], diff: null }, accepted: [], language: "English" });
    expect(m).toContain("FILES MODIFIED:\n/src/a.ts\n/src/b.ts");
    expect(m).toContain("the diff was omitted due to size constraints");
  });

  it("no file changed since the published version: it says so", () => {
    const m = scanFocusMessage({ scope: { kind: "changes", changed: [], diff: "" }, accepted: [], language: "English" });
    expect(m).toContain("(no file changed since the published version)");
  });

  it("languageName maps the interface locales and falls back to English", () => {
    expect(languageName("es")).toBe("Spanish");
    expect(languageName("pt-BR")).toBe("Portuguese");
    expect(languageName("zh")).toBe("Simplified Chinese");
    expect(languageName("xx")).toBe("English");
  });

  it("the filter message carries the finding as JSON and where to read", () => {
    const m = filterFindingMessage({ file: "/supabase/functions/cobrar/index.ts", line: 12, severity: "HIGH", category: "missing_webhook_signature", description: "d", exploit_scenario: "e", recommendation: "r", confidence: 0.9 });
    expect(m).toContain('"category": "missing_webhook_signature"');
    expect(m).toContain("Read /supabase/functions/cobrar/index.ts around line 12");
  });
});
