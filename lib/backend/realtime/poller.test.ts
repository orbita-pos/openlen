// El sondeo de un proyecto (poller.ts) con una fuente doble: su cadencia y que
// una lectura que falla (la conexión del slot se cayó, y el slot temporal con
// ella) vuelve a ABRIR la fuente en vez de fallar para siempre.
import { describe, expect, it } from "vitest";

import { ProjectPoller, type ChangeRow, type ChangeSource, type Listed } from "./poller";

const fila = (n: number): ChangeRow => ({
  type: "INSERT",
  schema: "public",
  table: "t",
  columns: "[]",
  record: JSON.stringify({ n }),
  old_record: "{}",
  commit_timestamp: null,
  subscription_ids: ["s"],
  errors: null,
});

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("ProjectPoller", () => {
  it("una lectura que falla cierra y vuelve a abrir la fuente, y sigue entregando", async () => {
    const pasos: string[] = [];
    const respuestas: (Listed | Error)[] = [new Error("se cayó la conexión"), { rows: [fila(1)], slotChangesCount: 1 }];
    const fuente: ChangeSource = {
      open: async () => {
        pasos.push("open");
      },
      close: async () => {
        pasos.push("close");
      },
      listChanges: async () => {
        const r = respuestas.shift() ?? { rows: [], slotChangesCount: 0 };
        pasos.push("list");
        if (r instanceof Error) throw r;
        return r;
      },
    };
    const vistas: ChangeRow[] = [];
    const p = new ProjectPoller(fuente, (r) => vistas.push(r), { pollIntervalMs: 5, maxChanges: 100, maxRecordBytes: 1000 }, () => {});
    p.start();
    await espera(150);
    await p.stop();
    expect(pasos.slice(0, 5)).toEqual(["open", "list", "close", "open", "list"]);
    expect(vistas.map((r) => JSON.parse(r.record))).toEqual([{ n: 1 }]);
  });
});
