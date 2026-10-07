// lib/len-bench/pasos.test.ts
// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MensajeDelHistorial } from "@/lib/agent/transcripcion";
import { fallidasDeLaTraza, pasosDeGrabacion, pasosDeProyecto } from "./pasos";

const grabacion = (turnos: unknown[][], cierre?: unknown[]) => ({
  formato: 1,
  grabadoEn: "2026-10-01T00:00:00.000Z",
  meta: { modelId: "m", requestId: "p1" },
  messages: [],
  turnos,
  ...(cierre ? { cierre } : {}),
});

describe("pasosDeGrabacion / pasosDeProyecto", () => {
  it("cada llamada al modelo es un paso, y el cierre por tope también", () => {
    expect(pasosDeGrabacion(grabacion([[], [], []]) as never)).toBe(3);
    expect(pasosDeGrabacion(grabacion([[], []], []) as never)).toBe(3);
  });
  it("suma los turnos de ESE proyecto y ninguno más", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-pasos-"));
    fs.writeFileSync(path.join(dir, "2026-a-proyectoA.json"), JSON.stringify(grabacion([[], []])));
    fs.writeFileSync(path.join(dir, "2026-b-proyectoA.json"), JSON.stringify(grabacion([[]], [])));
    fs.writeFileSync(path.join(dir, "2026-c-proyectoB.json"), JSON.stringify(grabacion([[], [], [], []])));
    expect(pasosDeProyecto(dir, "proyectoA")).toBe(4);
    expect(pasosDeProyecto(path.join(dir, "no-existe"), "proyectoA")).toBe(0);
  });
});

describe("fallidasDeLaTraza", () => {
  it("cuenta por herramienta las respuestas con ok:false (el patrón de los 12 Edit «no leído»)", () => {
    const traza: MensajeDelHistorial[] = [
      { role: "user", content: "cámbialo en todo el sitio" },
      { role: "assistant", content: "", functionCalls: [] },
      {
        role: "user",
        content: "",
        functionResponses: [
          { name: "Grep", response: { ok: true } },
          { name: "Edit", response: { ok: false, error: "You have not read this file in this conversation" } },
          { name: "Edit", response: { ok: false, error: "You have not read this file in this conversation" } },
          { name: "Edit", response: { ok: true } },
        ],
      },
      { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true } }, { name: "Edit", response: { ok: false } }] },
    ];
    expect(fallidasDeLaTraza(traza)).toEqual({ Edit: 3 });
  });
  it("una respuesta sin `ok` no cuenta como fallida", () => {
    expect(fallidasDeLaTraza([{ role: "user", content: "", functionResponses: [{ name: "use_page", response: { resultado: "x" } }] }])).toEqual({});
  });
});
