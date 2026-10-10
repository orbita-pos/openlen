// @vitest-environment node
// Las reglas de las variables de entorno (lib/apps/env/rules.ts): qué nombre
// vale, qué se guarda de un valor, qué problemas tiene una lista y cómo pinta y
// edita el diálogo sus filas.
import { describe, expect, it } from "vitest";
import {
  MAX_ENV_NAMES,
  applyGroupEdit,
  groupEnvVars,
  normalizeEnvValue,
  parseEnvVarsBody,
  suggestEnvName,
  validateEnvVars,
  type StoredEnvVar,
} from "./rules";

const v = (name: string, target: "draft" | "production", value: string): StoredEnvVar => ({ name, target, value });

describe("suggestEnvName", () => {
  it("propone el nombre que vale", () => {
    expect(suggestEnvName("stripe key")).toBe("VITE_STRIPE_KEY");
    expect(suggestEnvName("vite_api_url")).toBe("VITE_API_URL");
    expect(suggestEnvName("NEXT_PUBLIC_MAPS_KEY")).toBe("VITE_MAPS_KEY");
    expect(suggestEnvName("REACT_APP_SENTRY_DSN")).toBe("VITE_SENTRY_DSN");
    expect(suggestEnvName("api-url")).toBe("VITE_API_URL");
  });
  it("nada que proponer si ya vale o no queda nada", () => {
    expect(suggestEnvName("VITE_apiUrl")).toBeNull();
    expect(suggestEnvName("  ")).toBeNull();
    expect(suggestEnvName("VITE_")).toBeNull();
    expect(suggestEnvName("vite")).toBeNull();
  });
});

describe("normalizeEnvValue", () => {
  it("🔴 un valor pegado de un panel: sin \\r ni espacios o saltos en los extremos", () => {
    expect(normalizeEnvValue("  pk_live_abc\r\n")).toBe("pk_live_abc");
    expect(normalizeEnvValue("a b")).toBe("a b");
  });
});

describe("validateEnvVars", () => {
  it("una lista buena no tiene problemas", () => {
    expect(validateEnvVars([v("VITE_A", "draft", "1"), v("VITE_A", "production", "2"), v("VITE_B", "production", "")])).toEqual([]);
  });

  it("cada problema con su código, en el orden de la lista", () => {
    expect(
      validateEnvVars([
        v("stripe", "draft", "x"),
        v("VITE_SUPABASE_URL", "draft", "x"),
        v("VITE_A", "draft", "1"),
        v("VITE_A", "draft", "2"),
        v("VITE_BIG", "production", "x".repeat(4097)),
        v(`VITE_${"X".repeat(100)}`, "draft", "x"),
      ]),
    ).toEqual([
      { code: "name_format", name: "stripe", suggestion: "VITE_STRIPE" },
      { code: "reserved", name: "VITE_SUPABASE_URL" },
      { code: "duplicate", name: "VITE_A", target: "draft" },
      { code: "value_too_long", name: "VITE_BIG" },
      { code: "name_too_long", name: `VITE_${"X".repeat(100)}` },
    ]);
  });

  it("cuenta los bytes, no los caracteres", () => {
    expect(validateEnvVars([v("VITE_A", "draft", "ñ".repeat(2049))])).toEqual([{ code: "value_too_long", name: "VITE_A" }]);
  });

  it("más de 100 NOMBRES (no filas) es demasiado", () => {
    const cien = Array.from({ length: MAX_ENV_NAMES }, (_, i) => [v(`VITE_${i}`, "draft", "a"), v(`VITE_${i}`, "production", "b")]).flat();
    expect(validateEnvVars(cien)).toEqual([]);
    expect(validateEnvVars([...cien, v("VITE_X", "draft", "a")])).toEqual([{ code: "too_many", max: MAX_ENV_NAMES }]);
  });

  it("🔴 un secreto NUEVO pide el «entiendo que será público»; uno ya guardado, no", () => {
    const secreto = v("VITE_STRIPE", "production", "sk_live_51H8abcdefghijklmnop");
    expect(validateEnvVars([secreto])).toEqual([{ code: "looks_like_secret", name: "VITE_STRIPE", kind: "stripe" }]);
    expect(validateEnvVars([{ ...secreto, acknowledgedPublic: true }])).toEqual([]);
    expect(validateEnvVars([secreto], [secreto])).toEqual([]);
    expect(validateEnvVars([{ ...secreto, value: "sk_live_51H8zzzzzzzzzzzzzzzz" }], [secreto])).toHaveLength(1);
  });
});

describe("groupEnvVars y applyGroupEdit — las filas del diálogo", () => {
  const lista = [v("VITE_B", "draft", "1"), v("VITE_A", "draft", "x"), v("VITE_A", "production", "x"), v("VITE_B", "production", "2")];

  it("el mismo valor en los dos entornos es UNA fila; distinto, dos (borrador primero)", () => {
    expect(groupEnvVars(lista)).toEqual([
      { name: "VITE_A", value: "x", targets: ["draft", "production"] },
      { name: "VITE_B", value: "1", targets: ["draft"] },
      { name: "VITE_B", value: "2", targets: ["production"] },
    ]);
  });

  it("editar una fila la sustituye entera (con el valor limpio); borrar es editar sin líneas", () => {
    const [a] = groupEnvVars(lista);
    expect(applyGroupEdit(lista, a!, { lines: [{ name: "VITE_A", value: " y\n" }], targets: ["production"] })).toEqual([
      v("VITE_B", "draft", "1"),
      v("VITE_B", "production", "2"),
      v("VITE_A", "production", "y"),
    ]);
    expect(applyGroupEdit(lista, a!, { lines: [], targets: [] })).toEqual([v("VITE_B", "draft", "1"), v("VITE_B", "production", "2")]);
  });

  it("añadir varias líneas en los dos entornos", () => {
    expect(
      applyGroupEdit([], null, { lines: [{ name: " VITE_A ", value: "1" }, { name: "VITE_B", value: "2" }], targets: ["draft", "production"] }),
    ).toEqual([v("VITE_A", "draft", "1"), v("VITE_A", "production", "1"), v("VITE_B", "draft", "2"), v("VITE_B", "production", "2")]);
  });
});

describe("parseEnvVarsBody", () => {
  it("lo que la ruta acepta, limpio", () => {
    expect(parseEnvVarsBody({ version: "v1", vars: [{ name: " VITE_A ", target: "draft", value: "x\r\n", acknowledgedPublic: true }] })).toEqual({
      version: "v1",
      vars: [{ name: "VITE_A", target: "draft", value: "x", acknowledgedPublic: true }],
    });
  });
  it("cualquier otra forma es null", () => {
    for (const malo of [
      null,
      "x",
      {},
      { version: 1, vars: [] },
      { version: "v", vars: {} },
      { version: "v", vars: [{ name: "VITE_A", target: "staging", value: "" }] },
      { version: "v", vars: [{ name: 1, target: "draft", value: "" }] },
    ]) {
      expect(parseEnvVarsBody(malo), JSON.stringify(malo)).toBeNull();
    }
  });
});
