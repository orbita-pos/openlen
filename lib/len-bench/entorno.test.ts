// lib/len-bench/entorno.test.ts
// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_LEN_BENCH, entornoDeLenBench, problemasDelEntorno, variablesApagadas } from "./entorno";

const RAIZ = path.resolve(__dirname, "../..");

describe("variablesApagadas", () => {
  it("encuentra en el CÓDIGO las credenciales de R2 y de Cloudflare", () => {
    const v = variablesApagadas(RAIZ);
    // Consecuencia de producto, no una lista copiada: si publicar leyera una
    // credencial nueva de R2 y esto no la viera, las releases de prueba se
    // subirían al bucket de copias de verdad.
    expect(v).toContain("R2_ACCOUNT_ID");
    expect(v).toContain("R2_PUBLISHED_BUCKET");
    expect(v).toContain("CLOUDFLARE_API_TOKEN");
    expect(v.every((n) => n.startsWith("R2_") || n.startsWith("CLOUDFLARE_") || n.startsWith("RESEND_") || n.startsWith("EXA_"))).toBe(true);
  });
  it("🔴 y la de Exa (F2): una corrida no busca de verdad, que gasta y da otra cosa cada día", () => {
    expect(variablesApagadas(RAIZ)).toContain("EXA_API_KEY");
    const env = entornoDeLenBench({ EXA_API_KEY: "de-verdad" }, RAIZ);
    expect(env.EXA_API_KEY).toBe("");
    expect(env.OPENLEN_WEB_DE_PRUEBA_DIR).toBe(path.join(RAIZ, "plans", "len-2", "web"));
    expect(problemasDelEntorno(env, RAIZ)).toEqual([]);
    expect(problemasDelEntorno({ ...env, OPENLEN_WEB_DE_PRUEBA_DIR: undefined }, RAIZ).join(" ")).toMatch(/web del caso/);
  });
  it("y la de Resend: cada formulario enviado en Len-Bench mandaba un correo de verdad", () => {
    // /api/f/<sub> → notifyOwner → sendLeadNotificationEmail → Resend, al
    // correo +openlen-eval (una bandeja real). Las validaciones de dev y
    // sellado gastaron la cuota de la cuenta (2026-09-23). El grader lee la
    // bandeja en la base, no el correo: apagarlo no cambia lo que se mide.
    expect(variablesApagadas(RAIZ)).toContain("RESEND_API_KEY");
  });
});

describe("entornoDeLenBench", () => {
  it("vacía las credenciales, AUNQUE no estén en el entorno de partida", () => {
    // Next carga .env.local DENTRO del hijo y no pisa una variable que ya
    // existe: vaciarla aquí es lo que la apaga allí.
    const env = entornoDeLenBench({ PATH: "x" }, RAIZ);
    expect(env.R2_ACCOUNT_ID).toBe("");
    expect(env.CLOUDFLARE_API_TOKEN).toBe("");
    expect(env.RESEND_API_KEY).toBe("");
  });
  // 🔴 E del 26/09: sin el secreto, todas las /api/d/ contestaban 500
  // `no_configurado` y ninguna página que guardara en un almacén podía pasar.
  it("🔴 pone un secreto para los almacenes si falta, y respeta el que haya", () => {
    const env = entornoDeLenBench({}, RAIZ);
    expect(env.OPENLEN_INTERNAL_SECRET?.length).toBeGreaterThanOrEqual(32);
    expect(entornoDeLenBench({ OPENLEN_INTERNAL_SECRET: "  " }, RAIZ).OPENLEN_INTERNAL_SECRET?.trim()).not.toBe("");
    expect(entornoDeLenBench({ OPENLEN_INTERNAL_SECRET: "el-suyo" }, RAIZ).OPENLEN_INTERNAL_SECRET).toBe("el-suyo");
  });
  it("apunta la publicación y las grabaciones a plans/len-2", () => {
    const env = entornoDeLenBench({}, RAIZ);
    expect(env.PUBLISH_ROOT).toBe(path.join(RAIZ, "plans", "len-2", "publicadas"));
    expect(env.OPENLEN_AGENT_RECORD_DIR).toBe(path.join(RAIZ, "plans", "len-2", "grabaciones"));
  });
  it("lo que la publicada manda al ápice (formularios, widget) va al Next de Len-Bench, no a producción", () => {
    // Sin esto `submitBase()` (lib/publish/forms.ts) hornea https://openlen.com/api/f/<sub>,
    // y el grader del formulario enviaría a PRODUCCIÓN: .env.local no la define
    // (comprobado el 2026-09-23).
    expect(entornoDeLenBench({ NEXT_PUBLIC_SITE_URL: "https://openlen.com" }, RAIZ).NEXT_PUBLIC_SITE_URL).toBe(
      BASE_LEN_BENCH,
    );
  });
});

describe("problemasDelEntorno", () => {
  it("el entorno de Len-Bench no tiene ninguno", () => {
    expect(problemasDelEntorno(entornoDeLenBench({ R2_ACCOUNT_ID: "x", PATH: "y" }, RAIZ), RAIZ)).toEqual([]);
  });
  it("nombra cada cosa que tocaría producción o mediría mal", () => {
    const env = {
      ...entornoDeLenBench({}, RAIZ),
      R2_ACCOUNT_ID: "abc",
      RESEND_API_KEY: "re_x",
      NEXT_PUBLIC_SITE_URL: undefined,
      PUBLISH_ROOT: "/var/www/openlen",
      OPENLEN_AGENT_RECORD_DIR: undefined,
    };
    const p = problemasDelEntorno(env, RAIZ).join(" | ");
    expect(p).toMatch(/R2_ACCOUNT_ID/);
    expect(p).toMatch(/RESEND_API_KEY/);
    expect(p).toMatch(/NEXT_PUBLIC_SITE_URL/);
    expect(p).toMatch(/PUBLISH_ROOT/);
    expect(p).toMatch(/OPENLEN_AGENT_RECORD_DIR/);
  });
});
