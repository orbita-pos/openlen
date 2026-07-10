// Shape-only unit test for the eval battery (F3 T6). NO Gemini, NO DB — this
// validates the static contract of EVAL_CASES + coverage so a malformed case
// (dup id, empty prompt, uncovered tool) fails fast in CI-adjacent `vitest run`
// long before anyone spends credits on the real runner.
import { describe, expect, it } from "vitest";
import { CANARY_IDS, EVAL_CASES, claimsFalseAction, claimsOnlinePayment, coverage } from "./cases";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("EVAL_CASES shape", () => {
  it("has at least 35 cases", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(35);
  });

  it("every id is unique and kebab-case", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(KEBAB);
  });

  it("every prompt is a non-empty Spanish string", () => {
    for (const c of EVAL_CASES) {
      expect(typeof c.prompt, c.id).toBe("string");
      expect(c.prompt.trim().length, c.id).toBeGreaterThan(0);
    }
  });

  it("every case has an assert function and (if present) a function setup", () => {
    for (const c of EVAL_CASES) {
      expect(typeof c.assert, c.id).toBe("function");
      if (c.setup !== undefined) expect(typeof c.setup, c.id).toBe("function");
    }
  });

  it("costly flag, where set, is exactly the paid image-edit case", () => {
    const costly = EVAL_CASES.filter((c) => c.costly).map((c) => c.id);
    expect(costly).toEqual(["editar-imagen-fondo"]);
  });
});

describe("CANARY_IDS (F4 Task 9)", () => {
  it("is exactly 6 ids, all real EVAL_CASES ids, no duplicates", () => {
    expect(CANARY_IDS.length).toBe(6);
    expect(new Set(CANARY_IDS).size).toBe(CANARY_IDS.length);
    const caseIds = new Set(EVAL_CASES.map((c) => c.id));
    for (const id of CANARY_IDS) {
      expect(caseIds.has(id), `CANARY_IDS: id desconocido "${id}"`).toBe(true);
    }
  });

  it("excludes the costly case", () => {
    const costlyIds = new Set(EVAL_CASES.filter((c) => c.costly).map((c) => c.id));
    for (const id of CANARY_IDS) {
      expect(costlyIds.has(id), `CANARY_IDS: "${id}" es costly — el smoke debe ser barato`).toBe(false);
    }
  });
});

describe("claimsFalseAction — honesty negative-check (F4 Task 9)", () => {
  it("does NOT flag an honest denial as a false claim", () => {
    // "no agregué ..." is a DENIAL, not a claim — the negation guard must
    // keep this FALSE even though the action verb + feature noun are both
    // present in the sentence.
    expect(
      claimsFalseAction("no agregué un carrito de compras, pero puedo activar collections", "carrito"),
    ).toBe(false);
  });

  it("DOES flag a real false claim of action on the nonexistent feature", () => {
    expect(claimsFalseAction("listo, ya activé el carrito", "carrito")).toBe(true);
  });

  it("does NOT flag an honest denial with a clitic pronoun (no LO/LA apliqué)", () => {
    // The pronoun pushes the verb past a bare "(?<!no )" guard — without the
    // clitic lookbehinds these honest denials would false-FAIL.
    expect(claimsFalseAction("no lo apliqué al carrito, mejor usa Collections", "carrito")).toBe(false);
    expect(claimsFalseAction("no la instalé, esa función no existe", "tienda")).toBe(false);
  });
});

describe("claimsOnlinePayment — sentence-scoped online-payment lie detector (Task 8 fix)", () => {
  it("does NOT flag the canonical honest reply (negation + activé Pedidos in the same sentence)", () => {
    expect(
      claimsOnlinePayment(
        "No tenemos pago en línea, pero te activé Pedidos por WhatsApp para que ordenen ahí.",
      ),
    ).toBe(false);
  });

  it("does NOT flag an honest reply split across two sentences", () => {
    expect(
      claimsOnlinePayment("El pago en línea no está disponible. Activé Pedidos por WhatsApp."),
    ).toBe(false);
  });

  it("DOES flag the reviewer's false-PASS repro (pagos plural + integrados)", () => {
    expect(
      claimsOnlinePayment(
        "Listo, ya tienes pagos en línea integrados, y también activé Pedidos por WhatsApp.",
      ),
    ).toBe(true);
  });

  it("DOES flag a simple false claim", () => {
    expect(claimsOnlinePayment("Activé el pago en línea con tarjeta.")).toBe(true);
  });
});

describe("coverage map", () => {
  it("has one entry per case id, and no stray ids", () => {
    const caseIds = new Set(EVAL_CASES.map((c) => c.id));
    const covIds = new Set(Object.keys(coverage));
    for (const c of EVAL_CASES) expect(covIds.has(c.id), `falta coverage para ${c.id}`).toBe(true);
    for (const id of covIds) expect(caseIds.has(id), `coverage sobra para ${id}`).toBe(true);
  });

  it("covers all 15 catalog tools across the battery", () => {
    const toolNames = buildFunctionDeclarations().map((d) => d.name as string);
    expect(toolNames.length).toBe(15);
    const covered = new Set<string>(Object.values(coverage).flat());
    for (const tool of toolNames) {
      expect(covered.has(tool), `ninguna caso cubre "${tool}"`).toBe(true);
    }
  });

  it("only references real catalog tool names", () => {
    const toolNames = new Set(buildFunctionDeclarations().map((d) => d.name as string));
    for (const [id, tools] of Object.entries(coverage)) {
      for (const t of tools) expect(toolNames.has(t), `${id}: tool inexistente "${t}"`).toBe(true);
    }
  });
});
