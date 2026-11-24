// Seen on the phone on 24/11: a message couldn't be copied. The whole screen turns text selection off (`.lm-screen` in
// prototipo.css, so a drag of the sheet never selects words); the messages turn it back on, so a long press offers Copy as
// in any chat app.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const css = (name: string) => readFileSync(join(__dirname, "..", "estilos", name), "utf8");

it("🔴 the screen turns selection off, and the message bubbles turn it back on", () => {
  expect(css("prototipo.css")).toMatch(/\.lm-screen\{[^}]*user-select:none/);
  const app = css("app.css");
  const rule = app.match(/\.lm-screen \.ch-b\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(rule).toMatch(/-webkit-user-select:\s*text/);
  expect(rule).toMatch(/(^|[^-])user-select:\s*text/);
});
