import { describe, it, expect } from "vitest";
import {
  buildPatchPrompt,
  findLeakTargets,
  patchTemplateLeaks,
  type PatchTarget,
} from "./patch-leaks";
import type { ExtractedBusinessData } from "../style-match/autofill/types";
import { tagWithOpIds } from "@/lib/html-ops";

const COPY = {
  business_name: "Residencias Monterrey",
  industry: "inmobiliaria",
  tagline_es: "Tu nuevo hogar te espera",
  pitch: "Casas de autor en San Pedro y Valle.",
} as unknown as ExtractedBusinessData;

const TAGGED = `<!doctype html><html><body>
  <h2 data-op-id="a" class="display">¿Por qué MORADA?</h2>
  <p data-op-id="b">Selección curada esta temporada, visitada y fotografiada por el equipo.</p>
  <p data-op-id="c">Casas de autor en San Pedro, elegidas una por una.</p>
  <span data-op-id="d">Hablemos</span>
</body></html>`;

const LEAKS = [
  "¿por qué morada?",
  "selección curada esta temporada, visitada y fotografiada por el equipo.",
];

describe("findLeakTargets", () => {
  it("señala solo los elementos cuyo texto es una fuga conocida", () => {
    const t = findLeakTargets(TAGGED, LEAKS);
    expect(t.map((x) => x.opId).sort()).toEqual(["a", "b"]);
  });

  it("conserva la etiqueta original de cada elemento", () => {
    const t = findLeakTargets(TAGGED, LEAKS);
    expect(t.find((x) => x.opId === "a")?.tag).toBe("h2");
    expect(t.find((x) => x.opId === "b")?.tag).toBe("p");
  });

  it("sin fugas no señala nada", () => {
    expect(findLeakTargets(TAGGED, [])).toEqual([]);
  });
});

describe("buildPatchPrompt", () => {
  const targets: PatchTarget[] = [
    { opId: "a", tag: "h2", text: "¿Por qué MORADA?" },
  ];
  it("lleva SOLO los elementos señalados, no la página entera", () => {
    const p = buildPatchPrompt(targets, COPY);
    expect(p).toContain('id="a"');
    expect(p).not.toContain('id="c"');
    expect(p).not.toContain("Hablemos");
  });
  it("prohíbe inventar datos y arrastrar la marca anterior", () => {
    const p = buildPatchPrompt(targets, COPY);
    expect(p).toMatch(/never invent facts/i);
    expect(p).toMatch(/must not appear/i);
  });
});

describe("patchTemplateLeaks — la garantía", () => {
  const model = (body: string) => async () => `<edits>${body}</edits>`;
  const SRC = TAGGED.replace(/ data-op-id="[a-z]"/g, "");
  const CLEAN_LINE = "Casas de autor en San Pedro, elegidas una por una.";

  /** Ids que el prompt le pidió al modelo (así se comporta uno de verdad). */
  const idsInPrompt = (prompt: string) =>
    [...prompt.matchAll(/<element id="([^"]+)"/g)].map((m) => m[1]);

  it("reescribe la fuga y deja intacto todo lo demás", async () => {
    const r = await patchTemplateLeaks(SRC, LEAKS, COPY, async (prompt) => {
      const [first] = idsInPrompt(prompt);
      return `<edits><edit op="replace" target="${first}"><new><h2 class="display">¿Por qué Residencias Monterrey?</h2></new></edit></edits>`;
    });
    expect(r.targeted).toBe(2);
    expect(r.patched).toBeGreaterThan(0);
    expect(r.html).toContain("Residencias Monterrey");
    // lo que no era fuga sobrevive palabra por palabra
    expect(r.html).toContain(CLEAN_LINE);
    expect(r.html).toContain("Hablemos");
  });

  it("IGNORA ops para elementos que no se señalaron — un modelo díscolo no puede tocarlos", async () => {
    // ids reales de los elementos LIMPIOS, que el prompt nunca mencionó
    const tagged = tagWithOpIds(SRC).taggedHtml;
    const cleanIds = [
      ...tagged.matchAll(/data-op-id="([^"]+)"[^>]*>([^<]+)</g),
    ]
      .filter(([, , text]) => text.includes("San Pedro") || text.includes("Hablemos"))
      .map(([, id]) => id);
    expect(cleanIds.length).toBeGreaterThan(0);

    const r = await patchTemplateLeaks(SRC, LEAKS, COPY, async (prompt) => {
      const [first] = idsInPrompt(prompt);
      const rogue = cleanIds
        .map((id) => `<edit op="replace" target="${id}"><new><p>TEXTO QUE NADIE PIDIO</p></new></edit>`)
        .join("");
      return `<edits><edit op="replace" target="${first}"><new><h2>¿Por qué Residencias Monterrey?</h2></new></edit>${rogue}</edits>`;
    });

    expect(r.html).toContain(CLEAN_LINE);
    expect(r.html).toContain("Hablemos");
    expect(r.html).not.toContain("TEXTO QUE NADIE PIDIO");
  });

  it("un modelo que devuelve basura deja el HTML tal cual", async () => {
    const src = TAGGED.replace(/ data-op-id="[a-z]"/g, "");
    const r = await patchTemplateLeaks(src, LEAKS, COPY, model("no soy un edit"));
    expect(r.html).toBe(src);
    expect(r.patched).toBe(0);
  });

  it("si el modelo revienta, devuelve el HTML de entrada", async () => {
    const src = TAGGED.replace(/ data-op-id="[a-z]"/g, "");
    const r = await patchTemplateLeaks(src, LEAKS, COPY, async () => {
      throw new Error("Gemini 503");
    });
    expect(r.html).toBe(src);
    expect(r.patched).toBe(0);
  });

  it("sin fugas no llama al modelo", async () => {
    let called = 0;
    const src = TAGGED.replace(/ data-op-id="[a-z]"/g, "");
    await patchTemplateLeaks(src, [], COPY, async () => {
      called++;
      return "";
    });
    expect(called).toBe(0);
  });
});
