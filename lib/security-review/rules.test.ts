import { describe, expect, it } from "vitest";

import { runRules } from "./rules";
import type { PolicyDump, ReviewInputs } from "./types";

const SB_SECRET = "sb_secret_abcdefghijklmnopqrstuvwxyzABCDEF";
const SB_PUBLISHABLE = "sb_publishable_abcdefghijklmnopqrstuvwxyzABCDEF";
const STRIPE_LIVE = "sk_live_51Habcdefghijklmnopqrst";
const STRIPE_TEST = "sk_test_51Habcdefghijklmnopqrst";
const b64url = (s: string) => Buffer.from(s).toString("base64url");
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${b64url(JSON.stringify({ role }))}.c2lnbmF0dXJl`;

const inputs = (over: Partial<ReviewInputs> = {}): ReviewInputs => ({
  projectId: "p1",
  ownerId: "u1",
  app: null,
  homeHtml: "<h1>Hola</h1>",
  pages: {},
  files: {},
  productionEnv: {},
  hasBackend: true,
  schema: { tables: [], policies: [], buckets: [] },
  ...over,
});
const policy = (over: Partial<PolicyDump>): PolicyDump => ({
  schema: "public",
  table: "pedidos",
  name: "p",
  command: "UPDATE",
  permissive: true,
  roles: ["anon"],
  using: "true",
  withCheck: null,
  ...over,
});
const withPolicies = (...policies: PolicyDump[]) => inputs({ schema: { tables: [], policies, buckets: [] } });

describe("the database rules", () => {
  it("a table of public with RLS off is HIGH, keyed by the table", () => {
    const f = runRules(inputs({ schema: { tables: [{ name: "productos", rls: false }, { name: "notas", rls: true }], policies: [], buckets: [] } }));
    expect(f).toEqual([
      expect.objectContaining({ key: "rls_disabled:public.productos", source: "rule", severity: "HIGH", category: "rls_disabled", params: { table: "productos" } }),
    ]);
  });

  it("a permissive UPDATE, DELETE or ALL policy to anon or public USING true is HIGH", () => {
    const f = runRules(withPolicies(policy({ name: "a" }), policy({ name: "b", command: "DELETE", roles: ["public"] }), policy({ name: "c", command: "ALL", using: "(true)" })));
    expect(f.map((x) => x.key)).toEqual([
      "policy_open_write:public.pedidos.a",
      "policy_open_write:public.pedidos.b",
      "policy_open_write:public.pedidos.c",
    ]);
    expect(f[0]).toMatchObject({ severity: "HIGH", params: { table: "pedidos", policy: "a", command: "UPDATE" } });
  });

  it("does NOT fire on an open INSERT, an open SELECT, authenticated, a restrictive policy or a real condition", () => {
    const f = runRules(
      withPolicies(
        policy({ name: "insert", command: "INSERT" }),
        policy({ name: "select", command: "SELECT" }),
        policy({ name: "auth", roles: ["authenticated"] }),
        policy({ name: "restrictive", permissive: false }),
        policy({ name: "owner", using: "(( SELECT auth.uid() AS uid) = user_id)" }),
      ),
    );
    expect(f).toEqual([]);
  });

  it("a storage policy that lets anyone delete files is HIGH, named with its schema", () => {
    const f = runRules(withPolicies(policy({ schema: "storage", table: "objects", name: "borrar", command: "DELETE" })));
    expect(f[0]).toMatchObject({ key: "policy_open_write:storage.objects.borrar", params: { table: "storage.objects" } });
  });

  it("without a draft database there are no database findings", () => {
    expect(runRules(inputs({ schema: null }))).toEqual([]);
  });
});

describe("the secret rules", () => {
  it("a Supabase secret key in /src is HIGH, with its file and line, and the finding never carries the key", () => {
    const f = runRules(inputs({ files: { "/src/api.ts": `import x from "y";\n\nconst k = "${SB_SECRET}";\n` } }));
    expect(f).toEqual([
      expect.objectContaining({ key: "secret_in_client:/src/api.ts:supabase_secret", severity: "HIGH", file: "/src/api.ts", line: 3, params: { provider: "Supabase" } }),
    ]);
    expect(JSON.stringify(f)).not.toContain(SB_SECRET);
  });

  it("a service_role JWT in the page is HIGH; the anon JWT and the publishable key are not findings", () => {
    const f = runRules(inputs({ homeHtml: `<script>const a="${jwt("anon")}"; const p="${SB_PUBLISHABLE}"; const s="${jwt("service_role")}";</script>` }));
    expect(f.map((x) => x.key)).toEqual(["secret_in_client:/index.html:supabase_service_role"]);
  });

  it("a Stripe live key is HIGH and a test key is MEDIUM", () => {
    const f = runRules(inputs({ pages: { tienda: `<p>${STRIPE_LIVE}</p>` }, files: { "/js/pago.js": `const k = "${STRIPE_TEST}";` } }));
    expect(f).toEqual([
      expect.objectContaining({ key: "secret_in_client:/tienda/index.html:stripe", severity: "HIGH", params: { provider: "Stripe" } }),
      expect.objectContaining({ key: "test_secret_in_client:/js/pago.js:stripe", severity: "MEDIUM", category: "test_secret_in_client" }),
    ]);
  });

  it("a secret in a production variable is HIGH, named by the variable, with no file", () => {
    const f = runRules(inputs({ productionEnv: { VITE_PAGOS: STRIPE_LIVE } }));
    expect(f).toEqual([expect.objectContaining({ key: "secret_in_client:env:VITE_PAGOS:stripe", file: null, line: null, params: { provider: "Stripe", variable: "VITE_PAGOS" } })]);
  });

  it("does NOT fire on what never reaches the browser: functions, migrations, tests", () => {
    const f = runRules(
      inputs({
        files: {
          "/supabase/functions/cobrar/index.ts": `const k = "${STRIPE_LIVE}";`,
          "/supabase/migrations/20261015_x.sql": `-- ${SB_SECRET}`,
          "/src/api.test.ts": `const k = "${SB_SECRET}";`,
          "/tests/flujo.spec.ts": `const k = "${SB_SECRET}";`,
        },
      }),
    );
    expect(f).toEqual([]);
  });

  it("the same secret twice in a file is one finding", () => {
    const f = runRules(inputs({ files: { "/src/a.ts": `"${SB_SECRET}"\n"${SB_SECRET}"` } }));
    expect(f).toHaveLength(1);
  });
});
