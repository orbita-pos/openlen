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
});
