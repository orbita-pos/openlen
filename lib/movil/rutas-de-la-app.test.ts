// @vitest-environment node
// Guardia: cada ruta de la lista decide quién eres con la llave o la sesión,
// lleva CORS y contesta OPTIONS; y una ruta de fuera NO acepta la llave.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUTAS_DE_LA_APP } from "./rutas-de-la-app";

const leer = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

describe("las rutas de la app", () => {
  for (const r of RUTAS_DE_LA_APP) {
    it(`${r.fichero}: ${r.metodos.join(", ")} con la llave, CORS y OPTIONS`, () => {
      const src = leer(r.fichero);
      if (!r.fichero.endsWith("movil/llave/route.ts")) expect(src).toContain("usuarioDeLaPeticion(req)");
      for (const m of r.metodos) expect(src).toMatch(new RegExp(`export const ${m} = paraLaApp\\(`));
      expect(src).toMatch(/export const OPTIONS = respuestaPrevia;/);
    });
  }

  // Her tab in Len móvil (spec local 2026-11-06-asistente-propio, §4.6.3, phase 5).
  it("🔴 her routes are on the list", () => {
    const listed = new Map(RUTAS_DE_LA_APP.map((r) => [r.fichero, r.metodos]));
    // Created and connected from the phone (spec local 2026-11-16-movil-es-tu-asistente, §5.6, §5.8.3).
    expect(listed.get("app/api/assistants/route.ts")).toEqual(["GET", "POST"]);
    expect(listed.get("app/api/assistants/[id]/projects/route.ts")).toEqual(["POST"]);
    expect(listed.get("app/api/assistants/[id]/chat/route.ts")).toEqual(["GET"]);
    expect(listed.get("app/api/assistants/[id]/visits/route.ts")).toEqual(["GET"]);
    // Phase 4E: seeing her conversations marks them read.
    expect(listed.get("app/api/assistants/[id]/visits/read/route.ts")).toEqual(["POST"]);
    expect(listed.get("app/api/assistants/[id]/requests/route.ts")).toEqual(["GET"]);
    expect(listed.get("app/api/assistants/[id]/requests/[cardId]/route.ts")).toEqual(["POST"]);
    // Her chat's Len cards (spec local 2026-11-16-movil-es-tu-asistente, §5.8.5).
    expect(listed.get("app/api/assistants/[id]/len-requests/route.ts")).toEqual(["GET"]);
  });

  // OAuth of the MCP connectors on the phone (spec local 2026-11-17-oauth-de-conectores-mcp, §10.1): the route that
  // accepts the key for a method lists it (a method that takes the key without being here has no CORS for the app).
  // Final review, M5: the phone signs in (POST) but never disconnects — «Desconectar» is the Herramientas page's, on the web.
  it("🔴 the connector sign-in route lists the one method the phone calls", () => {
    const listed = new Map(RUTAS_DE_LA_APP.map((r) => [r.fichero, r.metodos]));
    expect(listed.get("app/api/mcp-connectors/[name]/oauth/route.ts")).toEqual(["POST"]);
    expect(listed.get("app/api/mcp-connectors/route.ts")).toEqual(["GET"]);
    expect(listed.get("app/api/mcp-connectors/directory/[id]/route.ts")).toEqual(["POST"]);
  });

  it("una ruta de fuera de la lista sigue sólo con la sesión", () => {
    const src = leer("app/api/projects/[id]/versions/route.ts");
    expect(src).not.toContain("usuarioDeLaPeticion");
  });
});
