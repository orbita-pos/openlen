import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentSession } from "@/lib/agent/tools";
import { childToolDeclarations } from "@/lib/agent/subagents/presets";

import { assistantTools } from "./agent";
import { DEFAULT_LOOK, checkLook } from "@/lib/figure/look";

import { CREATE_ASSISTANT, CREATE_ASSISTANT_DECLARATION, SUGGESTABLE, runCreateAssistant, suggestedLookOf } from "./create-tool";

const LEN = { projectId: "p1", userId: "u1" } as unknown as AgentSession;
const LUCIA = { id: "a1", name: "Lucía", slug: "lucia" };
const none = { assistantOfProject: async () => null, assistantsOf: async () => [], accentOf: async () => null };

describe("create_assistant", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("offers the card when the project has no assistant", async () => {
    const out = await runCreateAssistant(LEN, {}, none);
    expect(out.response).toMatchObject({ ok: true, card: "assistant_create" });
    expect((out.response as { existing?: unknown }).existing).toBeUndefined();
    expect(out.action).toMatchObject({ tool: CREATE_ASSISTANT, ok: true });
  });

  // Phase 4 (spec §4.4, step 2): «Ya tienes a Lucía. ¿La uso también aquí o creas uno nuevo?»
  it("with an assistant elsewhere, Len hears its name and asks before making another", async () => {
    const seen: string[] = [];
    const out = await runCreateAssistant(LEN, {}, { ...none, assistantsOf: async (personId) => (seen.push(personId), [LUCIA as never]) });
    expect(seen).toEqual(["u1"]);
    expect(out.response).toMatchObject({ ok: true, card: "assistant_create", existing: [{ name: "Lucía", slug: "lucia" }] });
    const said = String((out.response as { tool_result?: string }).tool_result);
    expect(said).toContain("Lucía");
    expect(said).toMatch(/use .* here too or create another/i);
    expect(out.action).toMatchObject({ tool: CREATE_ASSISTANT, ok: true });
  });

  it("says which one it already has", async () => {
    const out = await runCreateAssistant(LEN, {}, { ...none, assistantOfProject: async () => LUCIA as never, assistantsOf: async () => [LUCIA as never] });
    expect(out.response).toMatchObject({ ok: false, error: "project_has_assistant", assistant: { name: "Lucía", slug: "lucia" } });
    expect(out.action).toBeUndefined();
  });

  // Phase 6 (spec local 2026-11-10-figuras-del-asistente, §5.6): Len may suggest her figure; the owner decides on the card.
  const lookOf = (out: Awaited<ReturnType<typeof runCreateAssistant>>) => suggestedLookOf(out.action?.summary);

  it("🔴 what Len suggests of her figure opens the creator, part by part", async () => {
    const look = lookOf(await runCreateAssistant(LEN, { shape: "heart", color: "#19C3B1", accessory: "crown" }, none))!;
    expect(look).toMatchObject({ shape: "heart", color: "#19c3b1", accessory: "crown" });
    expect(checkLook(look)).toEqual({ ok: true, value: look });
    // What he left unsaid is the plain default, never a draw.
    expect(look.eyes).toBe(DEFAULT_LOOK.eyes);
    expect(look.eyewear).toBe("none");
  });

  // 11/11/2026, real turns: in four calls of four Len never named eyewear, and the card opened with glasses — a random
  // draw filled what he left out, and he never heard it. An optional parameter left out is its default (the JSON
  // schema's way, OpenAI's function calling): what he doesn't put on her, she doesn't wear.
  it("🔴 what Len leaves out stays plain: no glasses and nothing on her head that he didn't name", async () => {
    for (let seed = 0; seed < 40; seed++) {
      const look = lookOf(await runCreateAssistant(LEN, { shape: "flower", eyes: "smile", color: "#E8A0BF" }, { ...none, seed: () => seed } as never))!;
      expect(look).toEqual({ v: 1, shape: "flower", eyes: "smile", color: "#e8a0bf", eyewear: "none", accessory: "none" });
    }
  });

  // And he describes what the card opens with, not what he meant: like Claude Code's Edit answering with what the file
  // now says, the tool's result says what the card shows, part by part, in words.
  it("🔴 his result says exactly what the card opens with, in words", async () => {
    const said = (args: Record<string, unknown>) => runCreateAssistant(LEN, args, none).then((o) => String((o.response as { tool_result?: string }).tool_result));
    const flower = await said({ shape: "flower", eyes: "smile", color: "#E8A0BF" });
    expect(flower).toMatch(/opens with .*flower.*smiling.*no glasses.*nothing on (her|its) head.*#e8a0bf/i);
    expect(flower).toMatch(/describe (it as|exactly) that|say exactly that/i);
    expect(await said({ shape: "round", accessory: "hat", eyewear: "shades" })).toMatch(/sunglasses.*top hat/i);
    // With one elsewhere too.
    const elsewhere = await runCreateAssistant(LEN, { shape: "drop" }, { ...none, assistantsOf: async () => [LUCIA as never] });
    expect(String((elsewhere.response as { tool_result?: string }).tool_result)).toMatch(/Lucía[\s\S]*opens with .*drop/i);
  });

  it("🔴 a part that is not of the catalog is dropped, never an error, and the rest stands", async () => {
    const out = await runCreateAssistant(LEN, { shape: "blob", eyes: "round", color: "red", accessory: 7 }, none);
    expect(out.response).toMatchObject({ ok: true, card: "assistant_create" });
    const look = lookOf(out)!;
    expect(look.eyes).toBe("round");
    expect(look.shape).toBe(DEFAULT_LOOK.shape);
    expect(look.color).toBe(DEFAULT_LOOK.color);
  });

  it("with no color from Len she opens in the page's own accent; with none, in the default color", async () => {
    expect(lookOf(await runCreateAssistant(LEN, {}, { ...none, accentOf: async () => "#2F8BFF" }))!.color).toBe("#2f8bff");
    expect(lookOf(await runCreateAssistant(LEN, { color: "#112233" }, { ...none, accentOf: async () => "#2F8BFF" }))!.color).toBe("#112233");
    expect(lookOf(await runCreateAssistant(LEN, {}, { ...none, accentOf: async () => Promise.reject(new Error("no page")) }))!.color).toBe(DEFAULT_LOOK.color);
  });

  // He called the «hat» a «gorro de panadero»: an enum value with no words is read as whatever the model imagines.
  // OpenAI's function-calling guide and Claude Code's own tool descriptions say what each choice means.
  it("🔴 every choice he may name is described, so what he picks is what he means", () => {
    const p = CREATE_ASSISTANT_DECLARATION.parameters.properties as Record<string, { description: string }>;
    for (const category of ["shape", "eyes", "eyewear", "accessory"] as const) {
      for (const id of SUGGESTABLE[category]) expect(p[category]!.description, `${category}: ${id}`).toContain(id);
    }
    expect(p.accessory!.description).toMatch(/hat \(a short top hat with a brim/);
    expect(p.eyewear!.description).toMatch(/shades \(dark sunglasses\)/);
    expect(p.eyewear!.description).toMatch(/left out.*none/i);
  });

  it("the suggestion fits where a turn keeps it (200 characters), and what is not one is none", async () => {
    const out = await runCreateAssistant(LEN, { shape: "triangle", eyes: "sleepy", eyewear: "shades", accessory: "headphones", color: "#ff5fa8" }, none);
    expect(out.action!.summary.length).toBeLessThanOrEqual(200);
    expect(suggestedLookOf("create_assistant")).toBeUndefined();
    expect(suggestedLookOf("create_assistant {not json")).toBeUndefined();
    expect(suggestedLookOf('create_assistant {"v":1,"shape":"blob"}')).toBeUndefined();
    expect(suggestedLookOf(undefined)).toBeUndefined();
  });

  // His tools are a cached prefix of every turn: the catalog growing must not move it.
  it("🔴 what Len may name is a list kept here, not the live catalog: adding an entry to the catalog changes no byte of his tools", () => {
    const p = CREATE_ASSISTANT_DECLARATION.parameters.properties as Record<string, { enum?: readonly string[] }>;
    for (const category of ["shape", "eyes", "eyewear", "accessory"] as const) {
      expect(p[category]!.enum).toEqual([...SUGGESTABLE[category]]);
      expect(Object.isFrozen(SUGGESTABLE[category])).toBe(true);
      // And every one of them is still a figure that draws.
      for (const id of SUGGESTABLE[category]) expect(checkLook({ ...DEFAULT_LOOK, [category]: id }).ok, `${category}: ${id}`).toBe(true);
    }
    expect(JSON.stringify(CREATE_ASSISTANT_DECLARATION)).toMatchInlineSnapshot(`"{"name":"create_assistant","description":"Shows the owner the card to create their own assistant: a chat assistant of theirs, with the name and the look they pick, that knows their business and talks with them about it — not you. Call it when the owner asks for an assistant, a chatbot or an AI of their own. It creates nothing: the owner names it and picks its look on the card. If this project already has one, you get which, and say so. You may suggest its figure — any of shape, eyes, eyewear, accessory and color — when something fits the business; the card opens with it and the owner changes whatever they like. Name only the parts you mean: what you leave out stays plain. The result says exactly what the card opens with.","parameters":{"type":"OBJECT","properties":{"shape":{"type":"STRING","enum":["drop","round","capsule","cube","ears","heart","flower","triangle"],"description":"Optional. The figure's body: drop, round (a ball), capsule, cube, ears (a ball with two round ears), heart, flower, triangle."},"eyes":{"type":"STRING","enum":["oval","round","dot","smile","sleepy"],"description":"Optional. oval, round, dot (two small dots), smile (closed, smiling arcs), sleepy (half-closed)."},"eyewear":{"type":"STRING","enum":["none","round","shades"],"description":"Optional. none, round (round glasses), shades (dark sunglasses). Left out, it wears none."},"accessory":{"type":"STRING","enum":["none","beret","beanie","bow","crown","hat","headphones"],"description":"Optional. What it wears on its head: none, beret, beanie (a knit cap with a pompom), bow, crown, hat (a short top hat with a brim), headphones. There is no chef's hat. Left out, it wears none."},"color":{"type":"STRING","description":"Optional. The figure's color as #RRGGBB. Left out, it takes the page's accent."}}}}"`);
  });

  it("is not the assistant's: an assistant doesn't make assistants", async () => {
    const session = { ...LEN, assistant: { id: "a1", name: "Lucía" } } as AgentSession;
    expect((await runCreateAssistant(session, {}, none)).response).toMatchObject({ ok: false, error: "not_available" });
    expect(assistantTools([CREATE_ASSISTANT_DECLARATION]).map((d) => d.name)).toEqual([]);
  });

  it("no subagent gets it", () => {
    expect(childToolDeclarations([CREATE_ASSISTANT_DECLARATION], "general-purpose", false).map((d) => d.name)).toEqual([]);
  });

  it("is off with the switch", async () => {
    vi.stubEnv("OPENLEN_ASSISTANT", "0");
    expect((await runCreateAssistant(LEN, {}, none)).response).toMatchObject({ ok: false, error: "assistants_off" });
  });
});
