// @vitest-environment node
//
// THE PHONE'S TOOL TEXTS (spec local 2026-11-04-herramientas-hechas-por-len, §4.14). Two deferred minors of the final
// review, fixed at Jesús's request:
//   · the phone reads the web's own words (wsChrome `tools`, panelsChat `installCard` and `toolCard`, see textos.tsx)
//     — a key renamed on the web would silently leave the phone showing its name, so every key the phone uses is
//     pinned here, in the 10 languages, including the job statuses its line builds by name;
//   · the empty tab must not say tools are made only on the web: the phone's «Crear» card makes them too.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { IDIOMAS } from "../config";
import { textosHerramientas } from "../textos-herramientas";

const json = (idioma: string, fichero: string) => JSON.parse(readFileSync(path.join(process.cwd(), "messages", idioma, `${fichero}.json`), "utf8")) as Record<string, unknown>;
const at = (o: unknown, key: string): unknown => key.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), o);

// What the phone says through `movil.herramientas.tools` (wsChrome.tools), `.installCard` and `.toolCard` (panelsChat).
const TOOLS = [
  "planRequired",
  "change.title",
  "change.subtitle",
  "change.apply",
  "change.cancel",
  "jobs.confirm.title",
  "jobs.confirm.subtitle",
  "jobs.confirm.minutes",
  "jobs.confirm.credits",
  "jobs.confirm.files",
  "jobs.confirm.run",
  "jobs.confirm.cancel",
  "jobs.running.stop",
  "jobs.running.stopping",
  "jobs.running.dismiss",
  // The line builds these by name: `jobs.running.${status}` for every settled status.
  "jobs.running.completed",
  "jobs.running.failed",
  "jobs.running.killed",
  "files.pick.title",
  "files.pick.subtitle",
  "files.pick.choose",
  "files.pick.use",
  "files.pick.cancel",
];
const INSTALL_CARD = ["title", "inRail", "inProject", "install", "installAnyway", "findings", "destructive", "failed"];
const TOOL_CARD = [
  "dismissed", "more", "less", "initialContent", "place", "inRail", "inProject", "custom", "customPlaceholder", "notice",
  "closeNotice", "showNotice", "create", "notNow", "creating", "cancel", "cancelling", "installing", "installed", "open",
  "undo", "removed", "restore", "failed", "cancelled", "interrupted", "retry", "needsReview", "installAnyway", "openProject",
  "planRequired", "sourceMissing", "refused",
];

describe("the web's tool texts the phone reads", () => {
  for (const idioma of IDIOMAS) {
    it(`${idioma}: every key is there`, () => {
      const ws = json(idioma, "wsChrome");
      const pc = json(idioma, "panelsChat");
      const missing = [
        ...TOOLS.filter((k) => typeof at(ws, `tools.${k}`) !== "string").map((k) => `wsChrome.tools.${k}`),
        ...INSTALL_CARD.filter((k) => typeof at(pc, `installCard.${k}`) !== "string").map((k) => `panelsChat.installCard.${k}`),
        ...TOOL_CARD.filter((k) => typeof at(pc, `toolCard.${k}`) !== "string").map((k) => `panelsChat.toolCard.${k}`),
      ];
      expect(missing).toEqual([]);
    });
  }
});

describe("the empty tab", () => {
  const WEB: Record<string, string> = { es: "web", en: "web", pt: "web", fr: "web", de: "web", it: "web", ja: "ウェブ", ko: "웹", zh: "网页", nl: "web" };
  for (const idioma of IDIOMAS) {
    it(`${idioma}: doesn't say tools are made only on the web`, () => {
      expect(textosHerramientas[idioma].vacio.toLowerCase()).not.toContain(WEB[idioma]);
    });
  }
});
