import { describe, expect, it } from "vitest";
import { formatCents, parsePriceCents } from "./orders-price";

describe("parsePriceCents — conservative single-price parser", () => {
  it.each([
    ["$90", 9000],
    ["90", 9000],
    ["$90.50", 9050],
    ["90,50", 9050],
    ["MX$1,250", 125000],
    ["1,250", 125000],
    ["1.250", 125000],
    ["1.250,50", 125050],
    ["$ 249", 24900],
    ["  $35  ", 3500],
  ])("parses %s → %i", (display, cents) => {
    expect(parsePriceCents(display)).toBe(cents);
  });

  it.each([
    [""],
    ["   "],
    [null],
    [undefined],
    ["Desde $200"],
    ["desde 200"],
    ["From $50"],
    ["a partir de $99"],
    ["aprox $50"],
    ["$90–$120"],
    ["$90-$120"],
    ["2 x $50"],
    ["gratis"],
    ["consultar"],
    ["$0"],
    ["-$90"],
    ["$-90"],
    ["- $50"],
    ["-90"],
    ["$90-"],
  ])("returns null for %s (ambiguous / no honest single price)", (display) => {
    expect(parsePriceCents(display as string | null | undefined)).toBeNull();
  });
});

describe("formatCents", () => {
  it.each([
    [9000, "$90"],
    [9050, "$90.50"],
    [125000, "$1,250"],
    [125050, "$1,250.50"],
  ])("formats %i → %s", (cents, out) => {
    expect(formatCents(cents)).toBe(out);
  });
});
