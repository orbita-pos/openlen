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

  // What the scenes of November taught the replayer (12/11): three ways a production row is not
  // «the owner typed this and the model answered», each rebuilt by the history its own way.
  const lastUserText = (request: readonly { role: string; content: string }[]): string => request.findLast((m) => m.role === "user")!.content;

  it("a turn the server started sends what the model read (sentText), not what the row shows", async () => {
    const reminder = row("s", "resume las ventas", [{ role: "assistant", content: "Hecho." }]);
    const started: SceneFile = {
      ...scene,
      rows: [{ ...reminder, transcript: { ...reminder.transcript!, sentText: "[SCHEDULE REMINDER] resume las ventas" } }, row("t", "gracias", [{ role: "assistant", content: "¡De nada!" }])],
    };
    const { checks, requests } = await replayScene(started, ["s", "t"]);
    expect(lastUserText(requests.get("s")![0]!)).toBe("[SCHEDULE REMINDER] resume las ventas");
    expect(checks.map((c) => c.acrossTurns)).toEqual([null, { ok: true }]);
  });

  // THE COLD RETURN (final review, finding 3): a turn that started cold sent the history trimmed and left its
  // mark; the replayer rebuilds that turn's request trimmed too, or the gate goes red on correct behaviour.
  it("a turn that came back cold is replayed trimmed, and the turn after it starts with what it sent", async () => {
    // As production saves a turn: what Len thought travels on the message that calls a tool; his closing
    // answer is saved without it (`transcripcionDelTurno`). A replayed row is saved again the same way.
    const thinking = (id: string, thought: string): SceneRow =>
      row(id, "pide " + id, [
        { role: "assistant", content: "", reasoning: thought, functionCalls: [{ name: "Read", args: { file_path: "/" + id + ".html" } }] },
        { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "<p>" + id + "</p>" } }] },
        { role: "assistant", content: "hecho " + id },
      ]);
    const c = thinking("c", "pensado en c");
    const cold: SceneFile = {
      ...scene,
      rows: [thinking("a", "pensado en a"), thinking("b", "pensado en b"), { ...c, transcript: { ...c.transcript!, coldTrim: { v: 1, keepResults: 12, clearAtLeastTokens: 20_000 } } }, thinking("d", "pensado en d")],
    };
    const { checks, requests } = await replayScene(cold, ["a", "b", "c", "d"]);
    const thoughtsSentBy = (id: string) => requests.get(id)![0]!.flatMap((m) => (m.reasoning ? [m.reasoning] : []));
    expect(thoughtsSentBy("b")).toEqual(["pensado en a"]);
    expect(thoughtsSentBy("c")).toEqual(["pensado en b"]);
    expect(thoughtsSentBy("d")).toEqual(["pensado en b", "pensado en c"]);
    // The cold turn itself (c) is not compared with the turn before it: it rewrote the history on purpose.
    expect(checks.map((k) => k.acrossTurns)).toEqual([null, { ok: true }, null, { ok: true }]);
    expect(checks.every((k) => k.withinTurn.ok)).toBe(true);
  });

  it("a row with no transcript (the «published» note between two turns) is history, not a turn to replay", async () => {
    const note: SceneRow = { ...row("pub-1", "✓ Publicada", []), transcript: null, assistantReasoning: "Tu página está en línea." };
    const withNote: SceneFile = { ...scene, rows: [scene.rows[0]!, note, scene.rows[1]!] };
    const { checks, requests } = await replayScene(withNote, ["a", "b"]);
    expect(checks.map((c) => c.rowId)).toEqual(["a", "b"]);
    expect(checks[1]!.acrossTurns).toEqual({ ok: true });
    expect(requests.get("b")![0]!.map((m) => m.content)).toContain("✓ Publicada");
  });

  it("a photo the turn never saw goes without pixels and with its «did not load» note, as the history rebuilds it", async () => {
    const photo = { url: "https://example.test/a.png" };
    const withPhoto = row("p", "pon esta foto", [{ role: "assistant", content: "No pude verla." }]);
    const unseen: SceneFile = {
      ...scene,
      rows: [{ ...withPhoto, attachedImage: photo, transcript: { ...withPhoto.transcript!, unseenPhotos: [photo.url] } }, row("q", "vale", [{ role: "assistant", content: "Listo." }])],
    };
    const { checks, requests } = await replayScene(unseen, ["p", "q"]);
    expect(requests.get("p")![0]!.at(-1)!.images).toBeUndefined();
    expect(checks.map((c) => c.acrossTurns)).toEqual([null, { ok: true }]);
  });
});
