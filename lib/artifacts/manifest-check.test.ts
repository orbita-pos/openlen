// @vitest-environment node
import { expect, it } from "vitest";
import { checkManifestSource } from "./manifest-check";

it("answers a broken JSON at its line and column", () => {
  expect(checkManifestSource("motion.json", '{\n  "version": 1,\n  "entry": "index.html",,\n}')).toEqual([{ line: 3, column: 25, message: expect.stringMatching(/not valid JSON/) }]);
});

it("says what a manifest is missing, field by field", () => {
  expect(checkManifestSource("motion.json", JSON.stringify({ version: 1, entry: "index.html", runtime: "gsap-3.15.0", width: 1920, height: 720, fps: 30, durationSeconds: 6 }))[0]!.message).toMatch(/^width: .*1280/);
  expect(checkManifestSource("dashboard.json", JSON.stringify({ entry: "index.html", datasetIds: [], width: 1280, height: 720 }))[0]!.message).toMatch(/datasetIds needs at least one dataset/);
  expect(checkManifestSource("deck.json", JSON.stringify({ version: 3, title: "Turnia" }))[0]!.message).toMatch(/^order: /);
});

it("names a retired format and what to write instead", () => {
  expect(checkManifestSource("deck.json", JSON.stringify({ version: 2, title: "x", slides: [] }))[0]!.message).toMatch(/version 2.*retired.*version 3/);
});

it("is quiet about a manifest that is fine, and about files that are not manifests", () => {
  expect(checkManifestSource("deck.json", JSON.stringify({ version: 3, title: "Turnia", order: ["cover"] }))).toEqual([]);
  expect(checkManifestSource("motion.json", JSON.stringify({ version: 1, entry: "index.html", runtime: "gsap-3.15.0", width: 1280, height: 720, fps: 30, durationSeconds: 6 }))).toEqual([]);
  expect(checkManifestSource("escenario.csv", "a,b\n1,2")).toEqual([]);
});
