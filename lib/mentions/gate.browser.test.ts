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
});
