// @vitest-environment node
import { describe, expect, it } from "vitest";

import { etiquetaDeLienzo } from "@/lib/lienzo/host";

import { toolFrameUrl, toolHostLabel } from "./host";

const ID = "4f0c2a8e-1b3d-4c5e-9f7a-0b1c2d3e4f5a";
const ENV = { AUTH_SECRET: "s3cret" };

describe("toolHostLabel", () => {
  it("has the canvas label's shape, so Caddy and the rewrites already route it", () => {
    expect(toolHostLabel(ID, ENV)).toMatch(/^lienzo-[0-9a-f]{32}$/);
  });
  it("is stable per installation and is not the canvas label of the same id", () => {
    expect(toolHostLabel(ID, ENV)).toBe(toolHostLabel(ID, ENV));
    expect(toolHostLabel(ID, ENV)).not.toBe(etiquetaDeLienzo(ID, ENV));
  });
  it("without a secret there is no label", () => {
    expect(toolHostLabel(ID, {})).toBeNull();
  });
});

describe("toolFrameUrl", () => {
  const label = "lienzo-0123456789abcdef0123456789abcdef";
  it("in production, on the canvas domain, with the release in the URL", () => {
    expect(toolFrameUrl({ hostLabel: label, releaseSha: "abc", requestHost: "openlen.com" }, { NODE_ENV: "production", LIENZO_BASE_HOST: "openlen.app" })).toBe(
      `https://${label}.openlen.app/?v=abc`,
    );
  });
  it("locally, on .localhost with the request's port", () => {
    expect(toolFrameUrl({ hostLabel: label, releaseSha: "abc", requestHost: "localhost:3000" }, { NODE_ENV: "development" })).toBe(
      `http://${label}.localhost:3000/?v=abc`,
    );
  });
  it("with the canvas origin switched off, there is nowhere isolated to serve it", () => {
    expect(toolFrameUrl({ hostLabel: label, releaseSha: "abc", requestHost: "localhost:3000" }, { OPENLEN_LIENZO_ORIGEN: "0" })).toBeNull();
  });
});
