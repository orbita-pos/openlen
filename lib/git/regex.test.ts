// @vitest-environment node
import { describe, expect, it } from "vitest";
import { basicToJs, grepRegExp } from "./regex";

describe("git's regular expressions", () => {
  it("basic (git's default): ( ) { } | + ? are literal; \\( \\| \\+ are operators", () => {
    expect(new RegExp(basicToJs("a+b")).test("a+b")).toBe(true);
    expect(new RegExp(basicToJs("a\\+b")).test("aab")).toBe(true);
    expect(new RegExp(basicToJs("x\\|y")).test("y")).toBe(true);
    expect(new RegExp(basicToJs("f(x)")).test("f(x)")).toBe(true);
  });
  it("POSIX classes, -F, -i, -w", () => {
    expect(grepRegExp(["[[:digit:]]+"], { extended: true }).test("a1")).toBe(true);
    expect(grepRegExp(["a.b"], { fixed: true }).test("axb")).toBe(false);
    expect(grepRegExp(["HOLA"], { ignoreCase: true }).test("hola")).toBe(true);
    expect(grepRegExp(["cart"], { word: true }).test("carts")).toBe(false);
  });
});
