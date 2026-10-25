import { describe, expect, it } from "vitest";
import type { SceneFile, SceneRow } from "./scene-files";
import { readScene, scenes } from "./scene-files";
import { replayScene } from "./replay-scene";

// LAYER 1 OF LEN 3.1 (spec local 2026-10-24-len-3-1-layers-0-1, §5.2). The scenes
// are real production turns, downloaded outside the repo with
// `npm run replay-scenes:fetch`. Without them each test says so and passes,
// except under the deploy gate (OPENLEN_GATE=1), where a missing scene fails.
describe("real production scenes replay byte for byte", () => {
  for (const scene of scenes) {
    it(`scene ${scene.name} replays byte for byte within and across turns`, async () => {
      const file = readScene(scene.name);
      if (!file) {
        if (process.env.OPENLEN_GATE === "1") throw new Error(`scene ${scene.name} missing: run npm run replay-scenes:fetch`);
        console.warn(`⚠ scene ${scene.name} not downloaded — skipped`);
        return;
      }
      const { checks } = await replayScene(file, scene.rowIds);
      expect(checks.length).toBeGreaterThan(0);
      for (const c of checks) {
        expect({ rowId: c.rowId, ok: c.withinTurn.ok || (scene.allow ?? []).includes(c.withinTurn.cause as never), check: c.withinTurn }).toMatchObject({ ok: true });
        if (c.acrossTurns) expect({ rowId: c.rowId, check: c.acrossTurns }).toMatchObject({ check: { ok: true } });
      }
    });
  }
});

// The replayer itself, on a made-up scene: it needs nothing downloaded.
describe("replayScene", () => {
  const row = (id: string, userText: string, mensajes: SceneRow["transcript"] extends infer T ? (T extends { mensajes: infer M } ? M : never) : never): SceneRow => ({
    id,
    createdAt: "2026-10-24T00:00:00Z",
    status: "applied",
    tipo: null,
    userText,
    assistantReasoning: "",
    transcript: { mensajes, leidos: [], contexto: `CONTEXT ${id}` },
    attachedImage: null,
    actions: null,
  });
  const scene: SceneFile = {
    name: "made-up",
    projectId: "p",
    fetchedAt: "2026-10-24T00:00:00Z",
    olderTurns: 0,
    rows: [
      row("a", "lee la página", [
        { role: "assistant", content: "", functionCalls: [{ name: "Read", args: { limit: 50, offset: 1, file_path: "/index.html" } }] },
        { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "<h1>Hola</h1>" } }] },
        { role: "assistant", content: "Leída." },
      ]),
      row("b", "gracias", [{ role: "assistant", content: "¡De nada!" }]),
    ],
  };

  it("replays two turns: each request extends the previous, and the next turn starts with the last one", async () => {
    const { checks, requests } = await replayScene(scene, ["a", "b"]);
    expect(checks).toEqual([
      { rowId: "a", withinTurn: { ok: true }, acrossTurns: null },
      { rowId: "b", withinTurn: { ok: true }, acrossTurns: { ok: true } },
    ]);
    expect(requests.get("a")).toHaveLength(2);
  });
});
