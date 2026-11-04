// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { makePointer } from "@/lib/files/blob-pointer";

import { ICON_MAX_BYTES, readToolManifest } from "./manifest";

const SVG = `<?xml version="1.0"?>\n<!-- reservas -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const pkg = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "reservas-de-hoy",
    version: "1.0.0",
    private: true,
    openlen: { tool: { placement: "rail" } },
    exports: { "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
    ...over,
  });

const meta = (title: string, description: string) => JSON.stringify({ meta: { title, description } });

const valid = (over: Record<string, string | undefined> = {}): Record<string, string> => {
  const files: Record<string, string | undefined> = {
    "/package.json": pkg(),
    "/locale/en.json": meta("Today's bookings", "See and confirm today's bookings."),
    "/locale/es.json": meta("Reservas de hoy", "Ver y confirmar las reservas de hoy."),
    "/icon.svg": SVG,
    ...over,
  };
  return Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => e[1] !== undefined));
};

const read = (files: Record<string, string>, personLocale = "es", placeholderIconSha = "x") =>
  readToolManifest(files, { personLocale, placeholderIconSha });

const codes = (files: Record<string, string>, personLocale = "es", placeholderIconSha = "x") => {
  const r = read(files, personLocale, placeholderIconSha);
  return r.ok ? [] : r.problems.map((p) => p.code);
};

describe("readToolManifest", () => {
  it("reads a valid tool", () => {
    const r = read(valid());
    expect(r).toEqual({
      ok: true,
      manifest: {
        name: "reservas-de-hoy",
        version: "1.0.0",
        placement: "rail",
        titles: { en: "Today's bookings", es: "Reservas de hoy" },
        descriptions: { en: "See and confirm today's bookings.", es: "Ver y confirmar las reservas de hoy." },
        iconPath: "/icon.svg",
      },
    });
  });

  it("no package.json, or not JSON", () => {
    expect(codes(valid({ "/package.json": undefined }))).toEqual(["no_package_json"]);
    expect(codes(valid({ "/package.json": "{nope" }))).toEqual(["bad_json"]);
  });

  it("placement missing or not one of the two", () => {
    expect(codes(valid({ "/package.json": pkg({ openlen: {} }) }))).toContain("no_placement");
    expect(codes(valid({ "/package.json": pkg({ openlen: { tool: { placement: "sidebar" } } }) }))).toContain("bad_placement");
  });

  it("the exports the display record needs", () => {
    expect(codes(valid({ "/package.json": pkg({ exports: { "./icon": "./icon.svg" } }) }))).toContain("no_locale_export");
    expect(codes(valid({ "/package.json": pkg({ exports: { "./locale/*.json": "./locale/*.json" } }) }))).toContain("no_icon_export");
  });

  it("the person's locale and English both need a title and a description", () => {
    const r = read(valid({ "/locale/es.json": undefined }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContainEqual({ code: "missing_meta", file: "/locale/es.json" });
    expect(codes(valid({ "/locale/en.json": meta("", "x") }))).toContain("missing_meta");
    expect(codes(valid(), "en")).toEqual([]);
  });

  it("titles over 60 and descriptions over 200 characters", () => {
    expect(codes(valid({ "/locale/en.json": meta("x".repeat(61), "ok") }))).toContain("meta_too_long");
    expect(codes(valid({ "/locale/en.json": meta("ok", "x".repeat(201)) }))).toContain("meta_too_long");
  });

  it("the icon must exist, be small enough, of an image type, inside the package", () => {
    expect(codes(valid({ "/icon.svg": undefined }))).toContain("no_icon");
    const big = `<svg xmlns="http://www.w3.org/2000/svg">${"x".repeat(ICON_MAX_BYTES)}</svg>`;
    expect(codes(valid({ "/icon.svg": big }))).toContain("icon_too_big");
    expect(codes(valid({ "/package.json": pkg({ exports: { "./locale/*.json": "./locale/*.json", "./icon": "https://x/y.png" } }) }))).toContain(
      "icon_bad_type",
    );
    expect(codes(valid({ "/package.json": pkg({ exports: { "./locale/*.json": "./locale/*.json", "./icon": "./icon.gif" } }), "/icon.gif": "GIF89a" }))).toContain(
      "icon_bad_type",
    );
  });

  it("an .svg that isn't an image", () => {
    expect(codes(valid({ "/icon.svg": "<html><body>hi</body></html>" }))).toContain("icon_not_an_image");
  });

  it("the skeleton's placeholder icon is refused", () => {
    expect(codes(valid(), "es", sha(SVG))).toEqual(["icon_is_placeholder"]);
  });

  it("a binary icon kept as a blob pointer is judged by its declared size and its extension", () => {
    const pointer = (size: number) => makePointer({ sha256: "a".repeat(64), size, gitOid: "b".repeat(40) });
    const png = (p: string) => valid({ "/package.json": pkg({ exports: { "./locale/*.json": "./locale/*.json", "./icon": "./icon.png" } }), "/icon.svg": undefined, "/icon.png": p });
    expect(codes(png(pointer(1000)))).toEqual([]);
    expect(codes(png(pointer(ICON_MAX_BYTES + 1)))).toContain("icon_too_big");
  });

  it("collects every problem before answering", () => {
    expect(codes(valid({ "/package.json": pkg({ openlen: { tool: { placement: "x" } } }), "/icon.svg": undefined }))).toEqual(
      expect.arrayContaining(["bad_placement", "no_icon"]),
    );
  });
});
