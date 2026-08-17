import { describe, expect, it, vi } from "vitest";

import { electCreativeDirectionWith } from "./elect-creative-direction";
import { buildDeterministicIntent } from "./deterministic-page-input";

const BRIEF = "Clínica dental familiar en Coyoacán, atención a niños y adultos";
const INTENT = buildDeterministicIntent(BRIEF);

const CHOICE = {
  mode: "light",
  accent: "#2E86C1",
  display: "modern_geometric",
  body: "friendly_high_legibility",
  scale: "balanced",
  radius: "round",
  density: "medium",
  imagery: "photo_first",
  archetype: "family_dental_clinic",
  tone: ["calm", "clean"],
};

function client(result: unknown) {
  return { request: vi.fn(async () => result) } as never;
}

describe("elector de dirección creativa sobre el transporte de la página", () => {
  it("convierte la elección estética en una dirección completa", async () => {
    const transport = client({ ok: true, value: CHOICE });
    const elect = electCreativeDirectionWith(transport, "proj-1");
    const direction = await elect(BRIEF, INTENT);
    expect(direction).toMatchObject({ mode: "light", visualArchetype: "family_dental_clinic" });
    // El acento se corrige por contraste antes de usarse: lo que importa es que
    // la paleta salga completa y del acento elegido, no que sobreviva el hex.
    expect(Object.keys(direction!.palette)).toHaveLength(8);
  });

  it("pide un solo intento con el rol y el esfuerzo de la política", async () => {
    const transport = client({ ok: true, value: CHOICE });
    await electCreativeDirectionWith(transport, "proj-1")(BRIEF, INTENT);
    expect((transport as unknown as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(
      expect.objectContaining({ role: "reasoner", reasoningEffort: "none", maxAttempts: 1, requestId: "proj-1:direction" }),
    );
  });

  it.each(["budget_exceeded", "timeout", "schema"] as const)("devuelve null cuando el transporte falla con %s", async (code) => {
    const elect = electCreativeDirectionWith(client({ ok: false, code }), "proj-1");
    await expect(elect(BRIEF, INTENT)).resolves.toBeNull();
  });

  it("devuelve null cuando el transporte lanza", async () => {
    const transport = { request: vi.fn(async () => { throw new Error("socket"); }) } as never;
    await expect(electCreativeDirectionWith(transport, "proj-1")(BRIEF, INTENT)).resolves.toBeNull();
  });
});
