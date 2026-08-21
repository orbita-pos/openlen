import { describe, expect, it } from "vitest";

import type { FireworksJsonClient } from "@/lib/ai/fireworks-client";
import { describeReferenceCharacter } from "./character";

const cliente = (impl: unknown): { client: FireworksJsonClient } => ({
  client: { request: impl } as unknown as FireworksJsonClient,
});

const entrada = { requestId: "r1", screenshotBase64: "AAAA" };

describe("lo que Qwen devuelve", () => {
  it("el carácter, cuando la llamada va bien", async () => {
    const r = await describeReferenceCharacter(
      entrada,
      cliente(async () => ({
        ok: true,
        value: { character: "Respira mucho, tono sobrio, el peso cae en la tipografía." },
      })),
    );
    expect(r).toContain("tipografía");
  });
});

/**
 * LA propiedad de esta capa: es OPCIONAL. `extract/` ya midió la paleta gratis;
 * si la mitad cara falla, la dirección sigue sirviendo. Una referencia a medias
 * es mejor que ninguna.
 */
describe("nunca puede tumbar la mitad gratis", () => {
  it("si el proveedor responde error, devuelve null", async () => {
    const r = await describeReferenceCharacter(
      entrada,
      cliente(async () => ({ ok: false, code: "provider_error" })),
    );
    expect(r).toBeNull();
  });

  it("si el cliente LANZA, devuelve null en vez de propagar", async () => {
    const r = await describeReferenceCharacter(
      entrada,
      cliente(async () => {
        throw new Error("red caída");
      }),
    );
    expect(r).toBeNull();
  });

  // El presupuesto de página puede rechazar la llamada. Quedarse sin crédito
  // para el EXTRA no puede costar la referencia entera.
  it("si el presupuesto la rechaza, devuelve null", async () => {
    const r = await describeReferenceCharacter(
      entrada,
      cliente(async () => {
        throw new Error("budget_exceeded");
      }),
    );
    expect(r).toBeNull();
  });

  it("una respuesta vacía o ridícula se descarta", async () => {
    const r = await describeReferenceCharacter(
      entrada,
      cliente(async () => ({ ok: true, value: { character: "   ok   " } })),
    );
    expect(r).toBeNull();
  });
});

describe("lo que se le PROHÍBE al modelo", () => {
  // Sin la prohibición explícita, un modelo al que le enseñas una web describe
  // la WEB: nombra la marca, resume el copy, lista secciones. Eso es justo lo
  // que no puede viajar al brief — es lo que convierte inspirarse en calcar.
  it("el system prohíbe marca, copy, secciones y estructura", async () => {
    const visto: unknown[] = [];
    const spy = async (req: unknown) => {
      visto.push(req);
      return { ok: true, value: { character: "x".repeat(40) } };
    };
    await describeReferenceCharacter(entrada, cliente(spy));
    const req = visto[0] as { messages: { role: string; content: unknown }[] };
    const system = String(req.messages[0]!.content);
    for (const prohibido of ["marca", "texto", "secciones", "estructura", "hex"]) {
      expect(system.toLowerCase(), `el system no prohíbe ${prohibido}`).toContain(prohibido);
    }
  });

  it("manda la captura como data URI JPEG, igual que el crítico visual", async () => {
    const visto: unknown[] = [];
    const spy = async (req: unknown) => {
      visto.push(req);
      return { ok: true, value: { character: "x".repeat(40) } };
    };
    await describeReferenceCharacter(entrada, cliente(spy));
    const enviado = JSON.stringify(visto[0]);
    expect(enviado).toContain("data:image/jpeg;base64,AAAA");
    expect(enviado).toContain("visual_critic");
  });
});
