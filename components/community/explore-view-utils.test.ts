import { describe, expect, it } from "vitest";
import { appendExplorePage } from "./explore-view-utils";

describe("appendExplorePage", () => {
  it("appends new items and dedupes by id", () => {
    const a = [{ id: "1" }, { id: "2" }] as any;
    const b = [{ id: "2" }, { id: "3" }] as any;
    expect(appendExplorePage(a, b).map((x: any) => x.id)).toEqual(["1", "2", "3"]);
  });
  it("returns the page as-is when the accumulator is empty", () => {
    const b = [{ id: "1" }] as any;
    expect(appendExplorePage([], b)).toEqual(b);
  });
});
