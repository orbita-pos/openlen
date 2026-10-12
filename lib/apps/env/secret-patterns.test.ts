// @vitest-environment node
// ¿Parece un secreto? (lib/apps/env/secret-patterns.ts): cada clave secreta
// conocida se marca, y ninguna publicable —son justo para lo que existen las
// variables—.
import { describe, expect, it } from "vitest";
import { describeSecretForModel, detectSecret, findSecretsInText, secretMode, secretModeWarning, suggestSecretName } from "./secret-patterns";

const jwt = (payload: object) =>
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.firma`;

describe("detectSecret", () => {
  it("marca cada clave secreta conocida, con su servicio", () => {
    const casos: Array<[string, string]> = [
      ["sk_live_51H8abcdefghijklmnop", "stripe"],
      ["sk_test_51H8abcdefghijklmnop", "stripe"],
      ["rk_live_51H8abcdefghijklmnop", "stripe"],
      ["whsec_abcdefghijklmnop", "stripe"],
      ["sk-ant-api03-abcdefghijklmnop", "anthropic"],
      ["sk-proj-abcdefghijklmnopqrstuvwxyz", "openai"],
      ["sk-abcdefghijklmnopqrstuvwxyz012345", "openai"],
      ["ghp_abcdefghijklmnopqrstuvwxyz0123", "github"],
      ["github_pat_11ABCDEFG0123456789_abcdef", "github"],
      ["AKIAIOSFODNN7EXAMPLE", "aws"],
      ["xoxb-1234567890-abcdefghij", "slack"],
      ["SG.abcdefghijklmnopqr.abcdefghijklmnopqrstuv", "sendgrid"],
      ["GOCSPX-abcdefghijklmnop", "google_oauth"],
      ["sb_secret_abcdefghijklmnop", "supabase_secret"],
      [jwt({ role: "service_role", iss: "supabase" }), "supabase_service_role"],
      ["-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----", "private_key"],
      ["-----BEGIN RSA PRIVATE KEY-----", "private_key"],
    ];
    for (const [valor, tipo] of casos) expect(detectSecret("VITE_X", valor), valor).toBe(tipo);
  });

  it("los espacios de alrededor (un valor pegado) no lo esconden", () => {
    expect(detectSecret("VITE_X", "  sk_live_51H8abcdefghijklmnop\n")).toBe("stripe");
  });

  it("🔴 NO marca las publicables: son para lo que existen las variables", () => {
    for (const valor of [
      "pk_live_51H8abcdefghijklmnop",
      "pk_test_51H8abcdefghijklmnop",
      "pk.eyJ1IjoibWFwYm94IiwiYSI6ImNrMTIzIn0.abcdef",
      "AIzaSyA-1234567890abcdefghijklmnopqrstu",
      "phc_abcdefghijklmnopqrstuvwxyz0123456789",
      "sb_publishable_abcdefghijklmnop",
      jwt({ role: "anon", iss: "supabase" }),
      "https://abc123@o123.ingest.sentry.io/456",
      "https://api.example.com",
      "G-ABCDEF1234",
      "",
    ]) {
      expect(detectSecret("VITE_PUBLIC_KEY", valor), valor).toBeNull();
    }
  });

  it("un nombre que dice ser secreto se marca aunque el valor no delate nada", () => {
    expect(detectSecret("VITE_RECAPTCHA_SECRET", "6Lc_abc")).toBe("secret_name");
    expect(detectSecret("VITE_SUPABASE_SERVICE_ROLE_KEY", "x")).toBe("secret_name");
    expect(detectSecret("VITE_private_key", "x")).toBe("secret_name");
    expect(detectSecret("VITE_MAPBOX_TOKEN", "pk.abc")).toBeNull();
  });

  it("lo que lee Len nombra el servicio", () => {
    expect(describeSecretForModel("stripe")).toBe("looks like a Stripe secret key");
    expect(describeSecretForModel("private_key")).toBe("holds a private key");
    expect(describeSecretForModel("secret_name")).toBe("is named as a secret");
  });
});

// EDGE FUNCTIONS (spec local 2026-10-11, Parte 4): Mercado Pago, prueba o real,
// y lo que el compositor del chat encuentra dentro de un mensaje.
const MP_LIVE = "APP_USR-6317427424180639-042414-47e969706991d3a442922b0702a0da44-1181485898";
const MP_TEST = "TEST-2329493628457296-052520-be7d6b43aa1b7c9c6e5ad58cfd0c6b8a-1157012345";

describe("Mercado Pago", () => {
  it("su access token es un secreto; su clave pública, no", () => {
    expect(detectSecret("X", MP_LIVE)).toBe("mercadopago");
    expect(detectSecret("X", MP_TEST)).toBe("mercadopago");
    expect(detectSecret("X", "APP_USR-0d5a1b2c-3d4e-5f6a-7b8c-9d0e1f2a3b4c")).toBeNull();
    expect(detectSecret("X", "TEST-0d5a1b2c-3d4e-5f6a-7b8c-9d0e1f2a3b4c")).toBeNull();
    expect(describeSecretForModel("mercadopago")).toBe("looks like a Mercado Pago secret key");
  });
});

describe("secretMode y secretModeWarning", () => {
  it("prueba o real, en Stripe y en Mercado Pago; lo demás no lo dice", () => {
    expect(secretMode("sk_live_51H8abcdefghijklmnop")).toBe("live");
    expect(secretMode("rk_live_51H8abcdefghijklmnop")).toBe("live");
    expect(secretMode(" sk_test_51H8abcdefghijklmnop\n")).toBe("test");
    expect(secretMode(MP_LIVE)).toBe("live");
    expect(secretMode(MP_TEST)).toBe("test");
    expect(secretMode("whsec_abcdefghijklmnop")).toBeNull();
    expect(secretMode("sk-ant-api03-abcdefghijklmnop")).toBeNull();
  });

  it("🔴 avisa de una clave REAL en el borrador y de una de PRUEBA en producción; al revés, nada", () => {
    expect(secretModeWarning("draft", "sk_live_51H8abcdefghijklmnop")).toBe("live_in_draft");
    expect(secretModeWarning("live", MP_TEST)).toBe("test_in_live");
    expect(secretModeWarning("draft", "sk_test_51H8abcdefghijklmnop")).toBeNull();
    expect(secretModeWarning("live", MP_LIVE)).toBeNull();
    expect(secretModeWarning("live", "whsec_abcdefghijklmnop")).toBeNull();
  });
});

describe("findSecretsInText", () => {
  it("🔴 la encuentra dentro de un mensaje aunque venga entre comillas, con punto final o salto de línea", () => {
    const texto = 'mi clave es "sk_live_51H8abcdefghijklmnop". Y el webhook:\nwhsec_abcdefghijklmnop.';
    const f = findSecretsInText(texto);
    expect(f.map((x) => [x.kind, x.value])).toEqual([
      ["stripe", "sk_live_51H8abcdefghijklmnop"],
      ["stripe", "whsec_abcdefghijklmnop"],
    ]);
    expect(texto.slice(f[0]!.start, f[0]!.end)).toBe("sk_live_51H8abcdefghijklmnop");
  });

  it("un bloque de clave privada cuenta entero; un texto corriente o una publicable, nada", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEabc\n-----END PRIVATE KEY-----";
    expect(findSecretsInText(`toma: ${pem}`)).toMatchObject([{ kind: "private_key", value: pem }]);
    expect(findSecretsInText("pon el precio en 200 pesos y la clave pública pk_live_51H8abcdefghijklmnop")).toEqual([]);
    expect(findSecretsInText("el campo se llama SECRET_KEY")).toEqual([]);
  });
});

describe("suggestSecretName", () => {
  it("el nombre de los ejemplos de Supabase; si no hay uno obvio, vacío", () => {
    expect(suggestSecretName({ kind: "stripe", value: "sk_test_51H8abcdefghijklmnop" })).toBe("STRIPE_SECRET_KEY");
    expect(suggestSecretName({ kind: "stripe", value: "whsec_abcdefghijklmnop" })).toBe("STRIPE_WEBHOOK_SECRET");
    expect(suggestSecretName({ kind: "mercadopago", value: MP_TEST })).toBe("MERCADOPAGO_ACCESS_TOKEN");
    expect(suggestSecretName({ kind: "openai", value: "sk-proj-x" })).toBe("OPENAI_API_KEY");
    expect(suggestSecretName({ kind: "aws", value: "AKIAIOSFODNN7EXAMPLE" })).toBe("");
    expect(suggestSecretName({ kind: "private_key", value: "-----BEGIN PRIVATE KEY-----" })).toBe("");
  });
});
