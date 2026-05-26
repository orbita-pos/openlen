// Generate byte-equal expected outputs for each normalize-*.ts pass on each
// starter template. The Rust port asserts byte-equal against these files,
// so this regenerator is the single source of truth tying the two engines
// together until the TS implementation is deleted in Sem 12.
//
// Run with: npx tsx __test__/gen-fixtures.ts
// or:       node --import tsx __test__/gen-fixtures.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeRadius } from "../../../lib/normalize-radius";
import { normalizeSpace } from "../../../lib/normalize-space";
import { normalizeType } from "../../../lib/normalize-type";
import { normalizeFont } from "../../../lib/normalize-font";
import { normalizeAccent } from "../../../lib/normalize-accent";
import { normalizeColor } from "../../../lib/normalize-color";
import { normalizeColorModes } from "../../../lib/normalize-modes";
import { normalizeBornCanonical } from "../../../lib/normalize";

const here = dirname(fileURLToPath(import.meta.url));
const STARTERS = ["mirror.html", "counter.html", "manuscript.html"];

const passes: Array<[string, (html: string) => string]> = [
  ["radius", normalizeRadius],
  ["space", (h) => normalizeSpace(normalizeRadius(h))],
  ["type", (h) => normalizeType(normalizeSpace(normalizeRadius(h)))],
  ["font", (h) => normalizeFont(normalizeType(normalizeSpace(normalizeRadius(h))))],
  [
    "accent",
    (h) => normalizeAccent(normalizeFont(normalizeType(normalizeSpace(normalizeRadius(h))))),
  ],
  [
    "color",
    (h) =>
      normalizeColor(
        normalizeAccent(normalizeFont(normalizeType(normalizeSpace(normalizeRadius(h))))),
      ),
  ],
  [
    "modes",
    (h) =>
      normalizeColorModes(
        normalizeColor(
          normalizeAccent(
            normalizeFont(normalizeType(normalizeSpace(normalizeRadius(h)))),
          ),
        ),
      ),
  ],
  ["chain", normalizeBornCanonical],
];

const readStarter = (name: string) =>
  readFileSync(resolve(here, "../../../templates/starter", name), "utf8");

const writeFixture = (pass: string, name: string, body: string) => {
  const path = resolve(here, "../tests/fixtures", pass, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
};

for (const [name, fn] of passes) {
  for (const tpl of STARTERS) {
    const src = readStarter(tpl);
    writeFixture(name, tpl, fn(src));
  }
  console.log(`wrote ${STARTERS.length} fixtures for pass ${name}`);
}
