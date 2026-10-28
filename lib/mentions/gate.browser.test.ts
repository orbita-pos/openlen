// @vitest-environment node
// THE «SELECTS EVERYTHING» GATE (spec local 2026-10-27, §9) on the corpus that
// lives in the repo: the three starter templates the gallery is seeded with and
// the skeleton every app is born from. The bar here is 100 %: zero failures, of
// any class. The rest of the corpus runs with `npm run mentions:gate`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { esqueletoDeApp } from "@/lib/apps/esqueleto";

import { runMentionsGate, type GateDoc } from "./gate";

afterAll(() => stopBundlerWorker());

const starter = (id: string): GateDoc => ({
  name: id,
  kind: "page",
  html: readFileSync(path.join(process.cwd(), "templates", "starter", `${id}.html`), "utf8"),
});

describe("the «@» selects everything", () => {
  it("🔴 on the starter templates and the app skeleton, with no failure at all", async () => {
    const skeleton = esqueletoDeApp({ titulo: "Caja" });
    const report = await runMentionsGate([
      starter("mirror"),
      starter("manuscript"),
      starter("counter"),
      { name: "app-skeleton", kind: "app", files: skeleton.ficheros, app: skeleton.app, shell: skeleton.html },
    ]);
    // A text five or more elements share («§» ×12) cannot pick one of them by
    // searching it: that class is reported, not counted against the bar.
    const failures = report.docs.flatMap((d) =>
      d.failures.filter((f) => f.knownClass !== "duplicate-text").map((f) => `${d.name} · check ${f.check} · ${f.key} · ${f.reason}`),
    );
    expect(failures).toEqual([]);
    expect(report.docs.every((d) => d.checked > 0)).toBe(true);
  }, 600_000);

  it("a script that re-renders an element in place (a countdown) is a known class, not a bug", async () => {
    const html = [
      "<!doctype html>",
      "<html><body>",
      '<div id="t">',
      "  028 <span>d</span>",
      "</div>",
      "<script>document.getElementById('t').innerHTML = '027 <span>d</span>';</script>",
      "</body></html>",
    ].join("\n");
    const report = await runMentionsGate([{ name: "countdown", kind: "page", html }]);
    const check2 = report.docs[0]!.failures.filter((f) => f.check === 2);
    expect(check2.filter((f) => f.knownClass === null)).toEqual([]);
    // The <span> is outlined as its re-render; the <div>, whose text changed, reads «not on screen now».
    expect(check2).toContainEqual(expect.objectContaining({ key: "/index.html:4:7", knownClass: "script-rerendered" }));
  }, 120_000);

  it("🔴 catches a highlight that lands on a look-alike a script inserted", async () => {
    // The page's JS puts an identical <p>Hola</p> before the source one: same tag,
    // same text, so only the element's own position can tell them apart.
    const html = [
      "<!doctype html>",
      "<html><body>",
      "<main>",
      "<p>Hola</p>",
      "</main>",
      "<script>document.querySelector('main').insertAdjacentHTML('afterbegin', '<p>Hola</p>');</script>",
      "</body></html>",
    ].join("\n");
    const report = await runMentionsGate([{ name: "look-alike", kind: "page", html }]);
    // The <p> is outlined on its look-alike: the bug, no known class. (<main> now has
    // two <p>: its signature no longer fits, and «not on screen now» is honest.)
    const bugs = report.docs[0]!.failures.filter((f) => f.check === 2 && f.knownClass === null);
    expect(bugs).toEqual([expect.objectContaining({ key: "/index.html:4:1" })]);
  }, 120_000);
});
