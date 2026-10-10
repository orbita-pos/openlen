// @vitest-environment node
// El `.env` de una app (lib/apps/env/dotenv.ts): lo que dotenv —y por tanto
// Vite— lee, y lo que dotenv callaría y aquí se dice con su línea.
import { describe, expect, it } from "vitest";
import { dotEnvPublicVars, dotEnvSaveProblem, parseDotEnv } from "./dotenv";

describe("parseDotEnv — lo que dotenv (y Vite) leen", () => {
  it("comentarios, export, espacios alrededor del =, comillas y valor vacío", () => {
    const r = parseDotEnv(
      [
        "# claves públicas",
        "",
        "VITE_A=uno",
        "export VITE_B = dos ",
        "VITE_C='tres # no es comentario'",
        'VITE_D="línea\\notra"',
        "VITE_E=`cinco`",
        "VITE_F=",
        "VITE_G=siete # y un comentario",
        "VITE_H= # sólo comentario",
      ].join("\n"),
    );
    expect(r.errors).toEqual([]);
    expect(r.vars).toEqual({
      VITE_A: "uno",
      VITE_B: "dos",
      VITE_C: "tres # no es comentario",
      VITE_D: "línea\notra",
      VITE_E: "cinco",
      VITE_F: "",
      VITE_G: "siete",
      VITE_H: "",
    });
    expect(r.entries.map((e) => e.line)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("🔴 con finales de línea de Windows, lo mismo", () => {
    expect(parseDotEnv('VITE_A=uno\r\nVITE_B="dos"\r\n').vars).toEqual({ VITE_A: "uno", VITE_B: "dos" });
  });

  it("si un nombre se repite, gana el último (como dotenv)", () => {
    expect(parseDotEnv("VITE_A=1\nVITE_A=2").vars).toEqual({ VITE_A: "2" });
  });

  it("🔴 lo que dotenv ignoraría o cortaría en silencio es un error con su línea", () => {
    expect(parseDotEnv("VITE_A=1\nesto no\n").errors).toEqual([{ line: 2, message: "line 2 is not NAME=value" }]);
    expect(parseDotEnv('VITE_A="sin cerrar').errors[0]?.message).toMatch(/quote is not closed/);
    expect(parseDotEnv('VITE_A="x" y').errors[0]?.message).toMatch(/text after the closing/);
    expect(parseDotEnv("VITE_COLOR=#fff").errors[0]?.message).toBe(
      'line 1: # starts a comment here, so the value would be cut; quote it: VITE_COLOR="#fff"',
    );
    expect(parseDotEnv("VITE_URL=https://x.com/#/a").errors).toHaveLength(1);
  });
});

describe("dotEnvPublicVars", () => {
  it("sólo los VITE_ llegan a la app", () => {
    expect(dotEnvPublicVars("VITE_A=1\nSECRETO=2\nvite_b=3")).toEqual({ VITE_A: "1" });
  });
});

describe("dotEnvSaveProblem — lo que Len lee si /.env no se guarda", () => {
  it("un /.env bueno se guarda", () => {
    expect(dotEnvSaveProblem("# Stripe\nVITE_STRIPE_PUBLISHABLE_KEY=pk_test_abc\n")).toBeNull();
    expect(dotEnvSaveProblem("")).toBeNull();
  });
  it("cada rechazo con su línea y su porqué", () => {
    expect(dotEnvSaveProblem("VITE_A=1\nSTRIPE_KEY=pk_test_abc")).toMatch(/^line 2: STRIPE_KEY would never reach the app — only VITE_ variables/);
    expect(dotEnvSaveProblem("VITE_SUPABASE_URL=https://x")).toMatch(/^line 1: VITE_SUPABASE_URL is set by OpenLen/);
    expect(dotEnvSaveProblem("VITE_STRIPE=sk_live_51H8abcdefghijklmnop")).toMatch(
      /^line 1: VITE_STRIPE looks like a Stripe secret key\. Everything in \/\.env ends up in the JavaScript/,
    );
    expect(dotEnvSaveProblem("VITE_COLOR=#fff")).toMatch(/^line 1: # starts a comment/);
    expect(dotEnvSaveProblem(`VITE_A=${"x".repeat(4097)}`)).toMatch(/its value is larger than 4 KB/);
    expect(dotEnvSaveProblem(Array.from({ length: 101 }, (_, i) => `VITE_${i}=a`).join("\n"))).toBe("it has more than 100 variables.");
    expect(dotEnvSaveProblem(`VITE_A=${"x".repeat(17 * 1024)}`)).toBe("it is larger than 16 KB.");
  });
});
