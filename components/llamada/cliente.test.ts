import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clienteDeLaWeb } from "./cliente";

afterEach(() => vi.unstubAllGlobals());

describe("el cliente de la web", () => {
  it("pide a la misma ruta relativa, con la cookie de siempre", async () => {
    const f = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", f);
    await clienteDeLaWeb.pedir("/api/voz/sesion", { method: "POST" });
    expect(f).toHaveBeenCalledWith("/api/voz/sesion", { method: "POST" });
  });

  it("al cerrar avisa con sendBeacon (sobrevive a cerrar la pestaña)", () => {
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    clienteDeLaWeb.avisarAlCerrar("/api/voz/uso", '{"segundos":3}');
    expect(beacon).toHaveBeenCalledWith("/api/voz/uso", expect.any(Blob));
  });
});

// Guardia: la llamada habla con OpenLen SÓLO por el cliente. Un `fetch` o un
// `sendBeacon` directo saldría sin la llave en la app del teléfono.
describe("la llamada usa el cliente inyectado", () => {
  it("use-llamada.ts no llama a fetch ni a sendBeacon por su cuenta", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/llamada/use-llamada.ts"), "utf8");
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/sendBeacon/);
  });

  // Voice call cannot draw visuals (spec local 2026-11-22-visuales-de-verdad, §1–2; Review Focus 5; Final review I5):
  // it explicitly sends `drawsVisuals: false` (so web voice calls get `visualsHidden` too) and never sends `visualStates`.
  it("🔴 use-llamada.ts sends drawsVisuals: false and never sends visualStates", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/llamada/use-llamada.ts"), "utf8");
    expect(src).toContain("drawsVisuals: false");
    expect(src).not.toContain("drawsVisuals: true");
    expect(src).not.toContain("visualStates");
  });
});
