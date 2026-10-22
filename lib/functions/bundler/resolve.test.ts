// @vitest-environment node
import { describe, expect, it } from "vitest";

import { FUNCTIONS_CATALOGS } from "../catalog";
import { applyImportMap, resolveSpecifier, STD_HTTP_SERVER, TYPES_ONLY } from "./resolve.mjs";

const CAT = FUNCTIONS_CATALOGS["2026-11"]!;

describe("resolveSpecifier", () => {
  it("a subpath the catalog declares (react/jsx-runtime, react-dom/server) goes to its own file; another one is still refused", () => {
    const c12 = FUNCTIONS_CATALOGS["2026-12"]!;
    expect(resolveSpecifier(c12, "react/jsx-runtime")).toMatchObject({ kind: "catalog", file: "react-jsx-runtime.mjs" });
    expect(resolveSpecifier(c12, "npm:react-dom@19/server")).toMatchObject({ kind: "catalog", file: "react-dom-server.mjs" });
    expect(resolveSpecifier(c12, "npm:react-email")).toMatchObject({ kind: "catalog", file: "react-email.mjs" });
    expect(resolveSpecifier(c12, "react-dom/client")).toMatchObject({ kind: "error" });
  });

  it("npm:, jsr:, esm.sh y el nombre suelto van al MISMO fichero del catálogo", () => {
    for (const s of ["npm:stripe", "npm:stripe@23", "npm:stripe@^23.0.0", "https://esm.sh/stripe@23?target=deno", "https://esm.sh/v135/stripe@23", "stripe"]) {
      expect(resolveSpecifier(CAT, s), s).toEqual({ kind: "catalog", name: "stripe", file: "stripe.mjs", warning: null });
    }
    expect(resolveSpecifier(CAT, "jsr:@supabase/supabase-js@2")).toMatchObject({ kind: "catalog", file: "supabase-js.mjs", warning: null });
    expect(resolveSpecifier(CAT, "https://esm.sh/@supabase/supabase-js@2.45.0")).toMatchObject({ kind: "catalog", file: "supabase-js.mjs" });
  });

  it("otra versión mayor resuelve igual, CON aviso", () => {
    const r = resolveSpecifier(CAT, "npm:stripe@14");
    expect(r).toMatchObject({ kind: "catalog", file: "stripe.mjs" });
    expect(r.kind === "catalog" && r.warning).toBe("npm:stripe@14 resolves to stripe 23.0.0, the version in this project's Edge Functions catalog.");
  });

  it("node:* fuera; los tipos de Supabase, vacíos; el serve de std, del envoltorio", () => {
    expect(resolveSpecifier(CAT, "node:crypto")).toEqual({ kind: "node", id: "node:crypto" });
    expect(resolveSpecifier(CAT, "jsr:@supabase/functions-js/edge-runtime.d.ts")).toEqual({ kind: "runtime", id: TYPES_ONLY });
    expect(resolveSpecifier(CAT, "npm:@supabase/functions-js/edge-runtime.d.ts")).toEqual({ kind: "runtime", id: TYPES_ONLY });
    expect(resolveSpecifier(CAT, "https://deno.land/std@0.168.0/http/server.ts")).toEqual({ kind: "runtime", id: STD_HTTP_SERVER });
  });

  it("lo que no está en el catálogo es un error que dice qué hay", () => {
    const r = resolveSpecifier(CAT, "npm:left-pad@1");
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.message).toMatch(/^"npm:left-pad@1" isn't in this project's Edge Functions catalog\. Import one of: npm:@supabase\/supabase-js, npm:stripe/);
    expect(resolveSpecifier(CAT, "https://deno.land/x/oak/mod.ts").kind).toBe("error");
    expect(resolveSpecifier(CAT, "npm:stripe/lib/foo").kind).toBe("error");
  });

  it("un módulo de Node sin `node:` dice cómo escribirlo", () => {
    const r = resolveSpecifier(CAT, "crypto");
    expect(r.kind === "error" && r.message).toBe('"crypto" is a Node built-in: import it as "node:crypto".');
  });
});

describe("applyImportMap", () => {
  it("clave exacta, y la de prefijo más larga que acaba en /", () => {
    const m = { stripe: "npm:stripe@23", "@shared/": "./_shared/", "@shared/deep/": "./deep/" };
    expect(applyImportMap(m, "stripe")).toBe("npm:stripe@23");
    expect(applyImportMap(m, "@shared/cors.ts")).toBe("./_shared/cors.ts");
    expect(applyImportMap(m, "@shared/deep/x.ts")).toBe("./deep/x.ts");
    expect(applyImportMap(m, "zod")).toBe("zod");
    expect(applyImportMap(null, "zod")).toBe("zod");
  });
});
