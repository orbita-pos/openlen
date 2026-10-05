import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ai-gateway";

import { CHECKPOINT_PREAMBLE, COMPACTION_INSTRUCTION, SUMMARY_CLOSE_TAG, SUMMARY_OPEN_TAG, applySummary, buildSummaryRequest } from "./summary-prompt";

const ms: Message[] = [
  { role: "system", content: "s" }, { role: "user", content: "manual" },
  { role: "user", content: "pide" }, { role: "assistant", content: "vale" }, { role: "user", content: "último" },
];

describe("el resumen con el formato de DeepSeek", () => {
  it("las 8 secciones de DeepSeek, en orden", () => {
    const secciones = [...COMPACTION_INSTRUCTION.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(secciones).toEqual([
      "Primary Request and Intent", "Key Technical Concepts", "Files and Code", "Errors and Fixes",
      "Pending Jobs", "Current Work", "Next Step", "Critical Context",
    ]);
  });

  it("la petición repite el principio tal cual (caché) y añade la instrucción AL FINAL", () => {
    const req = buildSummaryRequest(ms, { start: 2, end: 4 });
    expect(req.slice(0, 4)).toEqual(ms.slice(0, 4));
    expect(req.at(-1)).toEqual({ role: "user", content: COMPACTION_INSTRUCTION });
    expect(req).toHaveLength(5);
  });

  it("el tramo se sustituye por UN mensaje con el preámbulo y las etiquetas de DeepSeek", () => {
    const out = applySummary(ms, { start: 2, end: 4 }, "  resumen  ");
    expect(out).toHaveLength(4);
    expect(out[2]).toEqual({ role: "user", content: `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}\nresumen\n${SUMMARY_CLOSE_TAG}` });
    expect(out[3]).toEqual(ms[4]);
  });
});
