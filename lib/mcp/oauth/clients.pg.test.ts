// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { registerDcrClient, resolveClient } from "./clients";

const CIMD = "https://ejemplo.invalido/oauth/client.json";

beforeAll(async () => {
  await exigirBaseLocal();
});
afterAll(async () => {
  await db.delete(schema.mcpOauthClients).where(like(schema.mcpOauthClients.name, "Prueba OAuth%"));
  await db.delete(schema.mcpOauthClients).where(like(schema.mcpOauthClients.id, "https://ejemplo.invalido/%"));
});

describe("los clientes OAuth", () => {
  it("DCR registra y se resuelve por su id", async () => {
    const r = await registerDcrClient({ client_name: "Prueba OAuth DCR", redirect_uris: ["http://127.0.0.1:9/cb"], token_endpoint_auth_method: "none" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.client.id).toMatch(/^olc_/);
    expect(await resolveClient(r.client.id)).toMatchObject({ kind: "dcr", name: "Prueba OAuth DCR" });
  });

  it("DCR rechaza un redirect_uri no aceptable", async () => {
    const r = await registerDcrClient({ client_name: "Prueba OAuth mala", redirect_uris: ["http://evil.com/cb"] });
    expect(r).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
  });

  it("CIMD: se descarga, se guarda y se reutiliza sin volver a descargar", async () => {
    let downloads = 0;
    const fetchJson = async () => {
      downloads++;
      return { client_id: CIMD, client_name: "Prueba OAuth CIMD", redirect_uris: ["https://ejemplo.invalido/cb"] };
    };
    expect(await resolveClient(CIMD, fetchJson)).toMatchObject({ kind: "cimd", name: "Prueba OAuth CIMD" });
    expect(await resolveClient(CIMD, fetchJson)).toMatchObject({ kind: "cimd" });
    expect(downloads).toBe(1);
  });

  it("un id que no existe y no es CIMD: null", async () => {
    expect(await resolveClient("olc_no_existe")).toBeNull();
  });
});
