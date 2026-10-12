// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { functionSecretsAvailable, postFunctionSecrets } from "./function-secrets-request";

const responde = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("postFunctionSecrets", () => {
  it("manda los valores a la ruta del proyecto, y entiende cada respuesta", async () => {
    const f = responde(200, { ok: true });
    expect(await postFunctionSecrets("p 1", [{ environment: "draft", name: "K", value: "v" }], f as unknown as typeof fetch)).toEqual({ kind: "saved" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects/p%201/function-secrets");
    expect(JSON.parse(String(init.body))).toEqual({ secrets: [{ environment: "draft", name: "K", value: "v" }] });
    expect(await postFunctionSecrets("p", [], responde(422, { error: "env_too_large", environment: "live", availableVars: 120 }) as unknown as typeof fetch)).toEqual({ kind: "too_large", environment: "live", availableVars: 120 });
    expect(await postFunctionSecrets("p", [], responde(400, { error: "invalid_name", name: "AWS_X" }) as unknown as typeof fetch)).toEqual({ kind: "invalid_name", name: "AWS_X" });
    expect(await postFunctionSecrets("p", [], responde(503, { error: "functions_unavailable" }) as unknown as typeof fetch)).toEqual({ kind: "error" });
    expect(await postFunctionSecrets("p", [], vi.fn(async () => { throw new Error("sin red"); }) as unknown as typeof fetch)).toEqual({ kind: "error" });
  });
});

describe("functionSecretsAvailable", () => {
  it("sí sólo si el servidor lo dice", async () => {
    expect(await functionSecretsAvailable("p", responde(200, { available: true }) as unknown as typeof fetch)).toBe(true);
    expect(await functionSecretsAvailable("p", responde(200, { available: false }) as unknown as typeof fetch)).toBe(false);
    expect(await functionSecretsAvailable("p", responde(404, {}) as unknown as typeof fetch)).toBe(false);
  });
});
