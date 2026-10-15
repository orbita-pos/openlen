// @vitest-environment node
import { describe, expect, it } from "vitest";
import { UnknownOption, parseOptions } from "./options";

const SPEC = { flags: ["-s", "--short", "-b", "-a"], values: ["-m", "-n", "--format", "-U"], repeated: ["-m"] };

describe("parseOptions", () => {
  it("flags, values (attached or not), repeats, positionals and --", () => {
    const o = parseOptions(["-sb", "-m", "one", "-mtwo", "--format=%h", "-n3", "x", "--", "-a", "y"], SPEC);
    expect(o.has("-s") && o.has("-b")).toBe(true);
    expect(o.all("-m")).toEqual(["one", "two"]);
    expect(o.value("--format")).toBe("%h");
    expect(o.value("-n")).toBe("3");
    expect(o.positional).toEqual(["x"]);
    expect(o.afterDashDash).toEqual(["-a", "y"]);
  });
  it("-5 means -n 5 when -n exists", () => {
    expect(parseOptions(["-5"], SPEC).value("-n")).toBe("5");
  });
  it("an unknown option is an error, never ignored", () => {
    expect(() => parseOptions(["--frobnicate"], SPEC)).toThrow(UnknownOption);
    expect(() => parseOptions(["-z"], SPEC)).toThrow(UnknownOption);
  });
});
