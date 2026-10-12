// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { Diagnostico } from "@/lib/agent/diagnosticos";

import { functionDiagnosticsAfterWrite } from "./after-write";

const ERR: Diagnostico = { ruta: "/supabase/functions/a/index.ts", linea: 2, columna: 8, gravedad: "Error", mensaje: "x", codigo: "functions-bundle", fuente: "esbuild" };
const AVISO: Diagnostico = { ...ERR, gravedad: "Warning", codigo: "functions-version" };

describe("functionDiagnosticsAfterWrite", () => {
  it("sólo si se tocó algo de las funciones, y entonces despliega", async () => {
    let veces = 0;
    const deploy = async () => (veces++, { kind: "deployed" as const, functions: ["a"], warnings: [AVISO] });
    expect(await functionDiagnosticsAfterWrite(["/index.html", "/supabase/migrations/1.sql"], deploy)).toEqual([]);
    expect(veces).toBe(0);
    expect(await functionDiagnosticsAfterWrite(["/supabase/functions/a/index.ts"], deploy)).toEqual([AVISO]);
    expect(await functionDiagnosticsAfterWrite(["/supabase/config.toml"], deploy)).toEqual([AVISO]);
    expect(veces).toBe(2);
  });

  it("lo que no compila: errores y avisos; quitar o no contestar: nada", async () => {
    expect(await functionDiagnosticsAfterWrite(["/supabase/functions/a/index.ts"], async () => ({ kind: "failed", errors: [ERR], warnings: [AVISO] }))).toEqual([ERR, AVISO]);
    expect(await functionDiagnosticsAfterWrite(["/supabase/functions/a/index.ts"], async () => ({ kind: "removed" }))).toEqual([]);
    expect(await functionDiagnosticsAfterWrite(["/supabase/functions/a/index.ts"], async () => ({ kind: "unavailable" }))).toEqual([]);
  });
});
