// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PRESETS,
  collectionConfigSchema,
  itemInputSchema,
  itemUpdateSchema,
} from "./item-input";

describe("itemInputSchema", () => {
  it("accepts a minimal valid item (title only)", () => {
    expect(itemInputSchema.safeParse({ title: "Espresso" }).success).toBe(true);
  });

  it("accepts a fully-populated valid item", () => {
    const r = itemInputSchema.safeParse({
      title: "Espresso",
      subtitle: "Doble",
      description: "Rico y cargado",
      imageUrl: "https://img.example.com/a.jpg",
      priceDisplay: "$45",
      badge: "Nuevo",
      ctaLabel: "Pedir",
      ctaUrl: "https://wa.me/5215555555555",
      tags: ["café", "caliente"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty / whitespace title", () => {
    expect(itemInputSchema.safeParse({ title: "" }).success).toBe(false);
    expect(itemInputSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("rejects an oversize title", () => {
    expect(itemInputSchema.safeParse({ title: "x".repeat(121) }).success).toBe(false);
  });

  it("rejects unsafe cta url schemes", () => {
    for (const u of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "//evil.com"]) {
      expect(itemInputSchema.safeParse({ title: "a", ctaUrl: u }).success).toBe(false);
    }
  });

  it("accepts http(s)/mailto/tel/anchor/relative cta urls", () => {
    for (const u of ["https://x.com", "http://x.com", "mailto:a@b.com", "tel:+52155", "#contacto", "/menu"]) {
      expect(itemInputSchema.safeParse({ title: "a", ctaUrl: u }).success).toBe(true);
    }
  });

  it("rejects a data: image url, accepts https + site-relative", () => {
    expect(itemInputSchema.safeParse({ title: "a", imageUrl: "data:image/png;base64,xx" }).success).toBe(false);
    expect(itemInputSchema.safeParse({ title: "a", imageUrl: "//evil.com/x.jpg" }).success).toBe(false);
    expect(itemInputSchema.safeParse({ title: "a", imageUrl: "https://x/a.jpg" }).success).toBe(true);
    expect(itemInputSchema.safeParse({ title: "a", imageUrl: "/assets/a.webp" }).success).toBe(true);
  });

  it("caps tags at 8", () => {
    const tags = Array.from({ length: 9 }, (_, i) => `t${i}`);
    expect(itemInputSchema.safeParse({ title: "a", tags }).success).toBe(false);
    expect(itemInputSchema.safeParse({ title: "a", tags: tags.slice(0, 8) }).success).toBe(true);
  });

  it("ignores garbage input without throwing", () => {
    expect(itemInputSchema.safeParse(null).success).toBe(false);
    expect(itemInputSchema.safeParse(42).success).toBe(false);
    expect(itemInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("itemUpdateSchema", () => {
  it("allows a partial patch (incl. empty)", () => {
    expect(itemUpdateSchema.safeParse({ priceDisplay: "$50" }).success).toBe(true);
    expect(itemUpdateSchema.safeParse({}).success).toBe(true);
  });
  it("still rejects a bad field inside a patch", () => {
    expect(itemUpdateSchema.safeParse({ ctaUrl: "javascript:x" }).success).toBe(false);
  });
});

describe("collectionConfigSchema", () => {
  it("accepts known presets + layouts", () => {
    expect(collectionConfigSchema.safeParse({ preset: "menu", layout: "list" }).success).toBe(true);
  });
  it("rejects an unknown preset / layout", () => {
    expect(collectionConfigSchema.safeParse({ preset: "spaceships" }).success).toBe(false);
    expect(collectionConfigSchema.safeParse({ layout: "carousel" }).success).toBe(false);
  });
  it("exposes exactly the 6 presets", () => {
    expect([...PRESETS].sort()).toEqual(
      ["events", "listings", "menu", "portfolio", "products", "team"],
    );
  });
});
