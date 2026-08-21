import { describe, expect, it } from "vitest";

import { z } from "zod";

import { fireworksJsonSchema } from "@/lib/ai/fireworks-contracts";
import type { FireworksJsonClient } from "@/lib/ai/fireworks-client";
import { CHARACTER_BUDGET_CHARS, CharacterSchema, describeReferenceCharacter, tidyCharacter } from "./character";

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

  it("le exige español y un tope de prosa, para no depender sólo del recorte", async () => {
    const visto: unknown[] = [];
    await describeReferenceCharacter(entrada, cliente(async (req: unknown) => {
      visto.push(req);
      return { ok: true, value: { character: "x".repeat(40) } };
    }));
    const system = String((visto[0] as { messages: { content: unknown }[] }).messages[0]!.content);
    expect(system).toContain("español");
    expect(system).toContain("300");
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

/**
 * LOS DOS DEFECTOS QUE SÓLO APARECIERON CONTRA FIREWORKS DE VERDAD.
 * Con dobles, la capa pasaba entera. La primera URL real (8,4 s, una web
 * cualquiera) devolvió esto, y ninguna prueba con dobles podía haberlo visto.
 */
describe("lo que devolvió Qwen la primera vez que miró una web real", () => {
  const REAL =
    "La página respira con amplitud gracias a un generoso espacio en blanco que contrasta con una " +
    "explosión de color vibrante y fluido en el lateral. El tono es técnico pero cálido y dinámico, " +
    "equilibrando la precisión corporativa con una energía creativa. El peso visual recae en la " +
    "tipografía grande y nítida del titular,以及";

  it("llegó cortado a mitad de palabra Y en chino — el caso exacto", () => {
    expect(REAL).toHaveLength(320);
    const limpio = tidyCharacter(REAL)!;
    expect(limpio).not.toMatch(/[一-鿿]/);
    expect(limpio).not.toMatch(/,$/);
    expect(limpio.endsWith("del titular")).toBe(true);
  });

  /**
   * LA CAUSA RAÍZ, y el test que impide que vuelva.
   *
   * `.max(n)` viaja como `maxLength: n` en un `json_schema` con `strict: true`.
   * Con gramática estricta eso no rechaza: AMORDAZA. El modelo no puede emitir
   * el carácter n+1, así que la frase muere donde se acaba el cupo. Por eso el
   * techo del wire va holgado y el recorte lo hacemos nosotros.
   */
  it("el techo del WIRE va holgado — si baja al presupuesto, vuelve la mordaza", () => {
    const wire = fireworksJsonSchema(CharacterSchema) as {
      properties: { character: { maxLength: number } };
    };
    expect(wire.properties.character.maxLength).toBeGreaterThan(CHARACTER_BUDGET_CHARS);
  });

  it("no es una peculiaridad de zod: cualquier .max() se vuelve gramática", () => {
    const wire = fireworksJsonSchema(z.object({ x: z.string().max(42) })) as {
      properties: { x: { maxLength?: number } };
    };
    expect(wire.properties.x.maxLength).toBe(42);
  });
});

describe("el recorte lo hacemos nosotros, por frases", () => {
  it("lo que cabe se devuelve tal cual", () => {
    expect(tidyCharacter("Respira. Sobria. El peso cae en la tipografía.")).toBe(
      "Respira. Sobria. El peso cae en la tipografía.",
    );
  });

  it("lo que no cabe termina en la última frase COMPLETA", () => {
    const largo = `${"Frase que ocupa espacio y no dice gran cosa. ".repeat(8)}Y esta ya no cabe entera`;
    const limpio = tidyCharacter(largo)!;
    expect(limpio.length).toBeLessThanOrEqual(CHARACTER_BUDGET_CHARS);
    expect(limpio.endsWith("cosa.")).toBe(true);
  });

  // Una sola frase larguísima no tiene punto donde cortar. Devolver el primer
  // tercio en silencio sería mentir sobre lo que dijo el modelo.
  it("sin ningún punto donde cortar, corta por palabra y lo MARCA", () => {
    const limpio = tidyCharacter(`${"palabra ".repeat(60)}final`)!;
    expect(limpio.length).toBeLessThanOrEqual(CHARACTER_BUDGET_CHARS + 1);
    expect(limpio.endsWith("…")).toBe(true);
    expect(limpio).not.toMatch(/palabr…$/);
  });

  it("si tras limpiar no queda nada aprovechable, null", () => {
    expect(tidyCharacter("很好，这个页面")).toBeNull();
    expect(tidyCharacter("   ")).toBeNull();
  });
});
