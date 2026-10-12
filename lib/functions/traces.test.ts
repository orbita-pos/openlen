// @vitest-environment node
import { describe, expect, it } from "vitest";

import { firstProjectSite, translateStack } from "./traces";

// Tres líneas generadas → líneas 1, 2 y 3 del fuente, columna 0.
const MAPA_APP = JSON.stringify({ version: 3, sources: ["app:/supabase/functions/checkout/index.ts"], names: [], mappings: "AAAA;AACA;AACA" });
const MAPA_CATALOGO = JSON.stringify({ version: 3, sources: ["vendor:stripe.mjs"], names: [], mappings: "AAAA;AACA" });
const MAPAS = { "index.mjs": MAPA_APP, "chunks/stripe-AB12.mjs": MAPA_CATALOGO };

const PILA = [
  "TypeError: Cannot read properties of undefined (reading 'price')",
  "    at handler (file:///tmp/openlen-functions/openlen-x-draft/abc/index.mjs:2:9)",
  "    at Stripe.request (file:///tmp/openlen-functions/openlen-x-draft/abc/chunks/stripe-AB12.mjs:1:3)",
  "    at file:///var/task/chunks/runtime-ZZ.mjs:40:7",
  "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
].join("\n");

describe("translateStack", () => {
  it("lo del proyecto a su fichero y línea; catálogo, envoltorio y Node, fuera", () => {
    expect(translateStack(PILA, MAPAS)).toBe(
      ["TypeError: Cannot read properties of undefined (reading 'price')", "    at handler (supabase/functions/checkout/index.ts:2:1)"].join("\n"),
    );
  });

  it("sin mapas deja sólo el mensaje", () => {
    expect(translateStack(PILA, {})).toBe("TypeError: Cannot read properties of undefined (reading 'price')");
  });
});

describe("firstProjectSite", () => {
  it("el primer marco del proyecto", () => {
    expect(firstProjectSite(PILA, MAPAS)).toEqual({ ruta: "/supabase/functions/checkout/index.ts", linea: 2, columna: 1 });
    expect(firstProjectSite("Error: x", MAPAS)).toBeNull();
  });
});
