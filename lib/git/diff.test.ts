// @vitest-environment node
// The diff engine against `git diff --no-index`: same hunks, same + and - lines, same headers.
import { afterAll, describe, expect, it } from "vitest";
import { fileDiff } from "./diff";
import { blobOf } from "./objects";
import { RealRepo } from "./test-support/real-git";

const real = new RealRepo();
afterAll(() => real.dispose());

function gitDiff(oldText: string, newText: string): string {
  real.write({ old: oldText, new: newText });
  return real.git(["diff", "--no-index", "old", "new"]).stdout;
}
function ourDiff(oldText: string, newText: string): string {
  return fileDiff({ path: "old", oid: blobOf(oldText).oid, text: oldText }, { path: "new", oid: blobOf(newText).oid, text: newText }).text;
}
function same(oldText: string, newText: string): void {
  expect(ourDiff(oldText, newText)).toBe(gitDiff(oldText, newText));
}

const lines = (...xs: string[]) => xs.map((x) => `${x}\n`).join("");

describe("the diff engine, against git", () => {
  it("one line changed, in the middle and at the ends", () => {
    same(lines("a", "b", "c", "d", "e", "f", "g", "h"), lines("a", "b", "c", "D", "e", "f", "g", "h"));
    same(lines("a", "b"), lines("A", "b"));
    same(lines("a", "b"), lines("a", "B"));
  });

  it("hunks merge when changes are 6 lines apart and split at 7", () => {
    const base = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const six = [...base]; six[5] = "X"; six[12] = "Y";
    const seven = [...base]; seven[5] = "X"; seven[13] = "Y";
    same(lines(...base), lines(...six));
    same(lines(...base), lines(...seven));
  });

  it("slider cases match git (indent heuristic)", () => {
    same(
      lines("function a() {", "  return 1;", "}", "", "function c() {", "  return 3;", "}"),
      lines("function a() {", "  return 1;", "}", "", "function b() {", "  return 2;", "}", "", "function c() {", "  return 3;", "}"),
    );
    same(
      lines("<section>", "  <h2>A</h2>", "</section>", "<section>", "  <h2>C</h2>", "</section>"),
      lines("<section>", "  <h2>A</h2>", "</section>", "<section>", "  <h2>B</h2>", "</section>", "<section>", "  <h2>C</h2>", "</section>"),
    );
    same(lines("if (x) {", "  if (y) {", "    z();", "  }", "}"), lines("if (x) {", "  if (y) {", "    z();", "  }", "  w();", "}"));
    same(lines("a", "", "", "b"), lines("a", "", "", "", "b"));
    same(lines("a", "b", "a", "b"), lines("a", "b", "a", "b", "a", "b"));
  });

  it("the function line after @@ (default funcname, 80 bytes)", () => {
    const long = `export function ${"veryLong".repeat(12)}() {`;
    const body = Array.from({ length: 12 }, (_, i) => `  step${i}();`);
    same(lines(long, ...body, "}"), lines(long, ...body.slice(0, 9), "  changed();", ...body.slice(10), "}"));
    same(lines("<div>", ...body, "</div>"), lines("<div>", ...body.slice(0, 9), "  changed();", ...body.slice(10), "</div>"));
  });

  it("no newline at the end, and CRLF lines", () => {
    same("a\nb", "a\nc");
    same("a\nb", "a\nb\n");
    same("a\nb\n", "a\nb");
    same("a\r\nb\r\n", "a\r\nc\r\n");
  });

  it("a big file with scattered edits", () => {
    const base = Array.from({ length: 3000 }, (_, i) => `<p data-i="${i % 7}">row ${i % 50}</p>`);
    const edited = base.map((l, i) => (i % 97 === 0 ? `${l} edited` : l)).filter((_, i) => i % 211 !== 5);
    same(lines(...base), lines(...edited));
  });
});
