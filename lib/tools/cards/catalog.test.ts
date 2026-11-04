// WHAT ALREADY EXISTS (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): the list the `tool-suggestions`
// skill carries, as DeepSeek's `personalized-pages` carries its official plugins — so Len names an existing feature
// or tool instead of proposing a duplicate.
import { describe, expect, it } from "vitest";

import type { InstalledToolView } from "../types";

import { BUILT_INS, suggestionCatalog } from "./catalog";

const tool = (over: Partial<InstalledToolView> = {}): InstalledToolView => ({
  id: "i1",
  projectId: "t1",
  title: "Reservas de hoy",
  description: "Ver y confirmar las reservas del día.",
  placement: "rail",
  iconUrl: "/api/tools/i1/icon?v=1",
  iconTinted: true,
  frameUrl: "http://x/?v=1",
  frameOrigin: "http://x",
  releaseSha: "1",
  enabled: true,
  installedAt: "",
  status: "ok",
  ...over,
});

describe("suggestionCatalog", () => {
  it("names OpenLen's own features and the person's installed tools, as JSON after a heading", () => {
    const text = suggestionCatalog({ installed: [tool(), tool({ id: "i2", title: "Notas", enabled: false, placement: "project" })] });
    expect(text.startsWith("## What already exists in OpenLen\n\n")).toBe(true);
    const json = JSON.parse(text.slice(text.indexOf("{"))) as { openlen: { name: string }[]; installedTools: unknown[] };
    expect(json.openlen.map((f) => f.name)).toEqual(BUILT_INS.map((f) => f.name));
    expect(json.installedTools).toEqual([
      { title: "Reservas de hoy", description: "Ver y confirmar las reservas del día.", placement: "rail", enabled: true },
      { title: "Notas", description: "Ver y confirmar las reservas del día.", placement: "project", enabled: false },
    ]);
  });

  it("a removed tool isn't there", () => {
    const json = JSON.parse(suggestionCatalog({ installed: [tool({ status: "removed" })] }).split("\n\n")[1]!) as { installedTools: unknown[] };
    expect(json.installedTools).toEqual([]);
  });
});
