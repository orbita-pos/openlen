// A delivered HTML opened on the canvas host, never on openlen.com (spec local 2026-10-31-len-movil, §5.1).
import { describe, expect, it } from "vitest";

import { leerDocumento } from "./almacen";
import { LIENZO_PARAM } from "./host";
import { openDeliveredHtml } from "./open-delivered";

const PROJECT = "3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";
const ENV = { NODE_ENV: "development", AUTH_SECRET: "s3cret" } as const;

describe("openDeliveredHtml", () => {
  it("stores the HTML as it is and answers a canvas-host URL", () => {
    const out = openDeliveredHtml({ projectId: PROJECT, personId: "ana", html: "<h1>Panel</h1>", requestHost: "localhost:3000", framedBy: ["https://localhost"] }, ENV);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.url).not.toContain("/api/");
    expect(out.url).toMatch(/^https?:\/\//);
    const docId = new URL(out.url).searchParams.get(LIENZO_PARAM)!;
    const doc = leerDocumento(docId);
    expect(doc?.html).toBe("<h1>Panel</h1>");
    expect(doc?.app ?? null).toBeNull();
    expect(doc?.framedBy).toEqual(["https://localhost"]);
  });

  it("wraps an SVG in a page", () => {
    const out = openDeliveredHtml({ projectId: PROJECT, personId: "ana", html: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', svg: true, requestHost: null, framedBy: [] }, ENV);
    if (!out.ok) throw new Error("expected a URL");
    const doc = leerDocumento(new URL(out.url).searchParams.get(LIENZO_PARAM)!);
    expect(doc?.html).toBe('<!doctype html><meta charset="utf-8"><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg"></svg>');
  });

  it("without a canvas host it says so", () => {
    expect(openDeliveredHtml({ projectId: PROJECT, personId: "ana", html: "x", requestHost: null, framedBy: [] }, { NODE_ENV: "development" })).toEqual({ ok: false, status: 503, error: "sin_host" });
  });
});
