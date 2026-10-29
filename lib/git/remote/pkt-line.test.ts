// @vitest-environment node
// git's pkt-line framing (gitprotocol-common): four hex digits of length, then the payload; 0000 flush, 0001 delim,
// 0002 response-end.
import { describe, expect, it } from "vitest";

import { DELIM, FLUSH, encodePkts, pkt, readPkts } from "./pkt-line";

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("pkt-line", () => {
  it("frames a line with its length, the four digits included", () => {
    expect(text(pkt("command=ls-refs\n"))).toBe("0014command=ls-refs\n");
    expect(text(encodePkts(["a\n", DELIM, "b\n", FLUSH]))).toBe("0006a\n00010006b\n0000");
  });

  it("reads data, flush, delim and response-end back", () => {
    const parsed = [...readPkts(new TextEncoder().encode("0006a\n000100000002000bhola\0x\n"))];
    expect(parsed.map((p) => (p.kind === "data" ? `data:${text(p.data)}` : p.kind))).toEqual(["data:a\n", "delim", "flush", "end", "data:hola\0x\n"]);
  });

  it("refuses a length that runs past the buffer", () => {
    expect(() => [...readPkts(new TextEncoder().encode("00ffab"))]).toThrow(/truncated/);
  });
});
