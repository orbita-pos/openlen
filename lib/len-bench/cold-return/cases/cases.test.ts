// The cases are generated, so what could be wrong with them is checked here, at $0: that every question can
// be answered, that an «old result» is really only in the page (or the file) it came from, and that the
// conversations are about as heavy as the spec asks.
import { describe, expect, it } from "vitest";

import { textoVisible } from "@/lib/len-bench/extraer";
import { buscarEnLaWeb, leerDeLaWeb, problemasDeLaWeb } from "@/lib/len-bench/web-sustituta";
import { numberPattern, namePattern, printed } from "../corpus";
import { QUESTION_KINDS, type Check, type ReturnCase } from "../types";
import { BUILD_CASES } from "./build";
import { CHAT_CASES } from "./chat";
import { PILOT_CASE_IDS, RETURN_CASES, selectCases } from "./index";

const answerChecks = (c: ReturnCase, i: number) => c.questions[i]!.checks.filter((k): k is Extract<Check, { on: "answer"; has: RegExp }> => k.on === "answer" && "has" in k);
const pagesText = (c: ReturnCase) => Object.values(c.web?.paginas ?? {}).map(textoVisible);

describe("the twelve cases", () => {
  it("are the spec's: six of chat and six of building, in its sizes", () => {
    expect(RETURN_CASES).toHaveLength(12);
    expect(new Set(RETURN_CASES.map((c) => c.id)).size).toBe(12);
    const sizes = (family: string) => RETURN_CASES.filter((c) => c.family === family).map((c) => c.targetKTokens).sort((a, b) => a - b);
    expect(sizes("chat")).toEqual([40, 40, 40, 100, 100, 100]);
    expect(sizes("build")).toEqual([40, 40, 100, 100, 220, 220]);
  });

  it("each asks its three questions in the same order: what was said at the start, the work where it was left, a result of long ago", () => {
    for (const c of RETURN_CASES) {
      expect(c.questions.map((q) => q.kind), c.id).toEqual([...QUESTION_KINDS]);
      for (const q of c.questions) expect(q.checks.length, `${c.id} ${q.kind}`).toBeGreaterThan(0);
      for (const message of [...c.build, ...c.questions.map((q) => q.prompt)]) expect(message.trim().length, c.id).toBeGreaterThan(20);
    }
  });

  it("the pilot is one case of each family, and a case that does not exist is an error", () => {
    expect(selectCases(PILOT_CASE_IDS).map((c) => c.family).sort()).toEqual(["build", "chat"]);
    expect(selectCases()).toHaveLength(12);
    expect(() => selectCases(["chat-pumps-40k", "typo"])).toThrow(/no such case: typo/);
  });
});

describe("a chat case", () => {
  it("is with the assistant, over a web where every result leads to a page that exists", () => {
    // One person cannot have two assistants of the same name, and every case is the same owner's.
    expect(new Set(CHAT_CASES.map((c) => c.assistant?.name)).size).toBe(CHAT_CASES.length);
    for (const c of CHAT_CASES) {
      expect(c.assistant?.name, c.id).toMatch(/^[A-ZÁÉÍÓÚ][a-záéíóúñ]+$/);
      expect(problemasDeLaWeb(c.web!), c.id).toEqual([]);
      expect(c.build, c.id).toHaveLength(15);
    }
  });

  it("every list the person asks for is found by searching for it, and nothing else is", () => {
    for (const c of CHAT_CASES) {
      const d = c.corpus.spec;
      for (let k = 0; k < d.categories.length; k++) {
        const [first] = buscarEnLaWeb(c.web, `${d.plural} ${d.categories[k]} ${d.site}`);
        expect(first?.url, `${c.id} ${d.categories[k]}`).toBe(c.corpus.url(k));
        expect(leerDeLaWeb(c.web, c.corpus.url(k)), c.id).not.toBeNull();
      }
      // The lists named in the building messages are all there.
      for (const k of [0, 1, 2, 3, 4, 5, 6, 7, d.categories.length - 1]) expect(c.build.join("\n"), c.id).toContain(`${d.plural} ${d.categories[k]}`);
    }
  });

  it("what the person said about themselves is in the first message and nowhere on the web", () => {
    for (const c of CHAT_CASES) {
      for (const check of answerChecks(c, 0)) {
        expect(check.has.test(c.build[0]!), `${c.id}: ${check.why}`).toBe(true);
        for (const page of pagesText(c)) expect(check.has.test(page), `${c.id}: the web gives away «${check.has.source}»`).toBe(false);
      }
    }
  });

  it("the question about the last list is answered by the last list's page", () => {
    for (const c of CHAT_CASES) {
      const d = c.corpus.spec;
      const last = d.categories.length - 1;
      const page = textoVisible(leerDeLaWeb(c.web, c.corpus.url(last))!);
      for (const check of answerChecks(c, 1)) expect(check.has.test(page), `${c.id}: ${check.why}`).toBe(true);
      // And it is the dearest there: no other item of the list costs as much.
      const prices = c.corpus.of(last).map((item) => item.values[d.attrs[0].key]!);
      expect(prices.filter((p) => p === Math.max(...prices))).toHaveLength(1);
    }
  });

  it("🔴 the old result is ONLY in the first list's page: no message of the conversation gives it away", () => {
    for (const c of CHAT_CASES) {
      const d = c.corpus.spec;
      const item = c.corpus.of(0)[3]!;
      const value = item.values[d.hidden.key]!;
      const [check] = answerChecks(c, 2);
      expect(check!.has.source, c.id).toBe(numberPattern(value).source);
      expect(textoVisible(leerDeLaWeb(c.web, c.corpus.url(0))!), c.id).toContain(`${printed(value)} ${d.hidden.unit}`);
      expect(c.questions[2].prompt, c.id).toContain(item.name);
      // Nobody asks about that attribute while the conversation is built: an answer cannot come from an
      // earlier reply of the assistant.
      expect(c.build.join("\n").toLowerCase(), c.id).not.toContain(d.hidden.label);
      // Nor does the question itself carry the number.
      expect(check!.has.test(c.questions[2].prompt), c.id).toBe(false);
    }
  });

  it("the pages weigh what a conversation of its size needs: a third as much for 40.000 as for 100.000", () => {
    const perPage = (c: (typeof CHAT_CASES)[number]) => textoVisible(leerDeLaWeb(c.web, c.corpus.url(0))!).length;
    for (const c of CHAT_CASES) {
      const chars = perPage(c);
      if (c.targetKTokens === 40) expect(chars, c.id).toBeGreaterThan(4_000), expect(chars, c.id).toBeLessThan(10_000);
      else expect(chars, c.id).toBeGreaterThan(13_000), expect(chars, c.id).toBeLessThan(26_000);
      // Under what `web_fetch` hands back whole.
      expect(chars, c.id).toBeLessThan(50_000);
    }
  });

  it("is the same web every time it is generated", async () => {
    const again = await import("./chat");
    expect(JSON.stringify(again.CHAT_CASES[0]!.web!.paginas)).toBe(JSON.stringify(CHAT_CASES[0]!.web!.paginas));
  });
});

describe("a build case", () => {
  const csv = (c: ReturnCase) => c.start.ficheros!["/data/catalogo.csv"]!;

  it("starts with the data file Len is told to read, and the apps start as apps", () => {
    for (const c of BUILD_CASES) {
      expect(csv(c).split("\n")[0], c.id).toBe("nombre,categoria,precio,proveedor");
      expect(c.build[0], c.id).toContain("/data/catalogo.csv");
      expect(c.assistant, c.id).toBeUndefined();
      if (c.id.startsWith("build-app-")) {
        expect(c.start.app, c.id).toBeDefined();
        expect(Object.keys(c.start.ficheros!).some((f) => f.startsWith("/src/")), c.id).toBe(true);
      } else {
        expect(c.start.app, c.id).toBeUndefined();
      }
    }
    expect(BUILD_CASES.filter((c) => c.targetKTokens === 220).every((c) => c.build.length === 6)).toBe(true);
    expect(BUILD_CASES.filter((c) => c.targetKTokens === 100).every((c) => c.build.length === 4)).toBe(true);
  });

  it("what the owner said at the start is in the first message, and the colour they ruled out too", () => {
    for (const c of BUILD_CASES) for (const check of answerChecks(c, 0)) expect(check.has.test(c.build[0]!), `${c.id}: ${check.why}`).toBe(true);
  });

  it("the work to go on with is the last thing that was asked for", () => {
    for (const c of BUILD_CASES) {
      const last = c.build.at(-1)!;
      for (const check of c.questions[1].checks) {
        if ("lacks" in check) expect(check.lacks.test(last), `${c.id}: «${check.lacks.source}» is what the last message asked for`).toBe(true);
      }
    }
  });

  it("🔴 the supplier asked about is only in the data file: no message names it, and it is not one of the first rows", () => {
    for (const c of BUILD_CASES) {
      const [check] = answerChecks(c, 2);
      const line = csv(c).split("\n").find((l) => c.questions[2].prompt.includes(l.split(",")[0]!) && l.split(",")[0] !== "nombre");
      expect(line, c.id).toBeDefined();
      const [name, , , maker] = line!.split(",");
      expect(check!.has.source, c.id).toBe(namePattern(maker!).source);
      expect(csv(c).split("\n").findIndex((l) => l.startsWith(`${name},`)), c.id).toBeGreaterThan(20);
      for (const message of [...c.build, ...c.questions.map((q) => q.prompt)]) expect(check!.has.test(message), c.id).toBe(false);
    }
  });
});

describe("how a number or a name is looked for in an answer", () => {
  it("a number is found however it was written back, and not inside another", () => {
    const p = numberPattern(18_400);
    for (const ok of ["18400 pesos", "18,400", "18.400 pesos.", "eran 18 400", "$18,400."]) expect(p.test(ok), ok).toBe(true);
    for (const no of ["118400", "184000", "18,4001", "1840"]) expect(p.test(no), no).toBe(false);
    expect(numberPattern(37).test("37 metros")).toBe(true);
    expect(numberPattern(37).test("137 metros")).toBe(false);
    expect(numberPattern(37).test("3.7")).toBe(false);
  });

  it("a name is found whatever the case and the dash", () => {
    const p = namePattern("Kuntur K-417");
    for (const ok of ["la Kuntur K-417", "kuntur k417", "KUNTUR K 417"]) expect(p.test(ok), ok).toBe(true);
    expect(p.test("Kuntur K-418")).toBe(false);
  });
});
