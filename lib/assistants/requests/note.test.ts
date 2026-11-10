// `note_request` (spec local 2026-11-06-asistente-propio, §4.3.1): with a visitor she notes what they wanted and she
// can't do — one sentence, without contact details, one per answer — and nothing else happens now.
import { describe, expect, it } from "vitest";

import { REQUEST_MAX_CHARS } from "./limits";
import { NOTE_REQUEST, NOTE_REQUEST_DECLARATION, noteRequestTool, scrubContact } from "./note";

const AT = new Date("2026-11-09T12:00:00Z");

function tool(result: "noted" | "visit_limit" | "assistant_limit" | Error = "noted") {
  const noted: Parameters<Parameters<typeof noteRequestTool>[0]["note"]>[0][] = [];
  const run = noteRequestTool({
    assistantId: "a1",
    projectId: "p1",
    visitorId: "vid-aaaaaaaaaaaaaaaa",
    locale: "es",
    at: AT,
    note: async (o) => {
      if (result instanceof Error) throw result;
      noted.push(o);
      return result;
    },
  });
  return { run, noted };
}

const answer = (out: Awaited<ReturnType<ReturnType<typeof noteRequestTool>>>) => out.response as { ok: boolean; tool_result?: string; error?: string };

describe("note_request", () => {
  it("is declared with one required sentence", () => {
    expect(NOTE_REQUEST).toBe("note_request");
    const params = NOTE_REQUEST_DECLARATION.parameters as unknown as { properties: Record<string, { type: string }>; required: string[] };
    expect(Object.keys(params.properties)).toEqual(["request"]);
    expect(params.properties.request!.type).toBe("STRING");
    expect(params.required).toEqual(["request"]);
  });

  // Phase 4E (measured 10/11): noting replaced answering. Both what she reads before calling it and what it tells her
  // after say the business's answer comes first.
  it("🔴 noting never replaces answering: the declaration and the reply say the business's answer comes first", async () => {
    expect(NOTE_REQUEST_DECLARATION.description).toContain("It never replaces answering: what the business's information says comes first. At most once per answer.");
    const t = tool();
    expect(answer(await t.run({ request: "Envío a Zapopan" })).tool_result).toBe(
      "Noted for the owner. If the business's information already answers it, a «no» included, that answer comes first; you may add that you'll pass it on; promise nothing.",
    );
  });

  it("🔴 emails and phones never reach the row", async () => {
    expect(scrubContact("escríbanme a ana.perez+1@gmail.com o al +52 (33) 1234-5678")).toBe("escríbanme a [contact] o al [contact]");
    expect(scrubContact("¿hacen envíos a Zapopan?")).toBe("¿hacen envíos a Zapopan?");
    const t = tool();
    await t.run({ request: "Quiere pastel sin gluten para 20 personas; llamar al 33 1234 5678 o a ana@x.mx" });
    expect(t.noted[0]!.text).toBe("Quiere pastel sin gluten para 20 personas; llamar al [contact] o a [contact]");
    expect(t.noted[0]).toMatchObject({ assistantId: "a1", projectId: "p1", visitorId: "vid-aaaaaaaaaaaaaaaa", locale: "es", at: AT });
  });

  it("keeps one tidy sentence of at most 300 characters", async () => {
    const t = tool();
    await t.run({ request: `  envíos\n\na   domicilio ${"x".repeat(400)}` });
    expect(t.noted[0]!.text.startsWith("envíos a domicilio x")).toBe(true);
    expect(t.noted[0]!.text.length).toBe(REQUEST_MAX_CHARS);
  });

  it("an empty request is refused and nothing is stored", async () => {
    const t = tool();
    expect(answer(await t.run({ request: "   " })).ok).toBe(false);
    expect(answer(await t.run({})).ok).toBe(false);
    expect(t.noted).toHaveLength(0);
  });

  it("a second note in one turn is refused", async () => {
    const t = tool();
    expect(answer(await t.run({ request: "envíos" })).ok).toBe(true);
    const second = answer(await t.run({ request: "reservas" }));
    expect(second.ok).toBe(false);
    expect(t.noted.map((n) => n.text)).toEqual(["envíos"]);
  });

  it("🔴 a note that can't be saved doesn't lose the answer, and she is told not to promise", async () => {
    const t = tool(new Error("connection refused"));
    const out = answer(await t.run({ request: "envíos" }));
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).toContain("Couldn't note it: don't say you passed it on.");
  });

  it("over a limit she hears ok and nothing is stored", async () => {
    for (const limit of ["visit_limit", "assistant_limit"] as const) {
      const t = tool(limit);
      const out = answer(await t.run({ request: "envíos" }));
      expect(out).toEqual(answer(await tool().run({ request: "envíos" })));
      expect(out.ok).toBe(true);
    }
  });
});
