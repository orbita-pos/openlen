// @vitest-environment node
// ¿Parece un secreto? (lib/apps/env/secret-patterns.ts): cada clave secreta
// conocida se marca, y ninguna publicable —son justo para lo que existen las
// variables—.
import { describe, expect, it } from "vitest";
import { describeSecretForModel, detectSecret } from "./secret-patterns";

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
