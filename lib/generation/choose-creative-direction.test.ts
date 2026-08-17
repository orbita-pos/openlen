// Reemplazo del vecino-más-cercano entre 7 nichos que le dio a una clínica
// dental la paleta de terror ([[seven-palettes-horror-attractor]]).
//
// El modelo elige SÓLO lo estético —modo, un acento, tipografía, geometría—
// porque lo semántico (dominios, audiencia, señales) ya vive en IntentAnalysis.
// La paleta la deriva el código: un modelo elige un color bonito, no promete
// que ocho contrasten.
//
// Y falla blando por diseño: la dirección es gusto, no corrección. Una llamada
// caída cuesta el gusto, jamás la página.
import { describe, expect, it, vi } from "vitest";
import { chooseCreativeDirection } from "./choose-creative-direction";
import { CreativeDirectionSchema } from "./creative-contracts";
import { buildDeterministicIntent } from "@/lib/curate/deterministic-page-input";

const BRIEF = "Clínica dental en Monterrey para familias, 14 años de experiencia. Limpieza, ortodoncia e implantes, con cita por WhatsApp.";
const INTENT = buildDeterministicIntent(BRIEF);

const GOOD = JSON.stringify({
  mode: "light",
  accent: "#1769AA",
  display: "friendly_high_legibility",
  body: "friendly_high_legibility",
  scale: "balanced",
  radius: "round",
  density: "medium",
  imagery: "photo_first",
  archetype: "trusted_family_clinic",
  tone: ["calm", "trustworthy"],
});

describe("chooseCreativeDirection", () => {
  it("builds a direction the schema accepts", async () => {
    const result = await chooseCreativeDirection(BRIEF, INTENT, { ask: async () => GOOD });

    expect(result).not.toBeNull();
    expect(() => CreativeDirectionSchema.parse(result)).not.toThrow();
  });

  it("uses the accent the model chose, and derives the palette around it", async () => {
    const result = await chooseCreativeDirection(BRIEF, INTENT, { ask: async () => GOOD });

    expect(result?.mode).toBe("light");
    // Not the literal accent necessarily — it is contrast-corrected against its
    // own background — but the hue must survive: blue in, blue out.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(result!.palette.accent.slice(i, i + 2), 16));
    expect(b, `accent came out ${result!.palette.accent}`).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it("never returns the horror palette for a dental clinic", async () => {
    // The whole point. #09090B/#B91C35 is the seven-niche lookup's answer.
    const result = await chooseCreativeDirection(BRIEF, INTENT, { ask: async () => GOOD });

    expect(result?.palette.background).not.toBe("#09090B");
    expect(result?.palette.accent).not.toBe("#B91C35");
  });

  it.each([
    ["the call throws", async () => { throw new Error("provider down"); }],
    ["the answer is not JSON", async () => "lo siento, no puedo"],
    ["the answer is JSON but the wrong shape", async () => JSON.stringify({ mode: "neon" })],
    ["the accent is not a colour", async () => JSON.stringify({ ...JSON.parse(GOOD), accent: "azul" })],
    ["the font mood is invented", async () => JSON.stringify({ ...JSON.parse(GOOD), display: "brutalist_vhs" })],
    ["the answer is empty", async () => ""],
  ])("returns null when %s, so the caller can fall back", async (_name, ask) => {
    expect(await chooseCreativeDirection(BRIEF, INTENT, { ask: ask as never })).toBeNull();
  });

  it("tolerates a fenced answer, which models emit despite instructions", async () => {
    const fenced = async () => "```json\n" + GOOD + "\n```";
    const result = await chooseCreativeDirection(BRIEF, INTENT, { ask: fenced });

    expect(result).not.toBeNull();
  });

  it("carries the intent's own signals rather than inventing new ones", async () => {
    const result = await chooseCreativeDirection(BRIEF, INTENT, { ask: async () => GOOD });

    expect(result?.forbiddenVisualSignals).toEqual([...INTENT.forbiddenVisualSignals]);
  });

  it("asks once and does not retry a refusal into a bill", async () => {
    const ask = vi.fn(async () => "no");

    await chooseCreativeDirection(BRIEF, INTENT, { ask });

    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe("the final contract check is a guard, not decoration", () => {
  it("refuses a direction whose derived fields do not fit the contract", async () => {
    // `requiredVisualSignals` se copia del intento tal cual, y la dirección
    // admite 24 como mucho. Un intento con más produce una dirección inválida
    // que NADIE más atraparía: el modelo respondió bien y la paleta es
    // correcta. Sin este chequeo se entregaría medio válida.
    const tooMany = {
      ...INTENT,
      requiredVisualSignals: Array.from({ length: 25 }, (_, i) => `signal_${i}`),
    } as never;

    expect(await chooseCreativeDirection(BRIEF, tooMany, { ask: async () => GOOD })).toBeNull();
  });
});
