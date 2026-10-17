import { describe, expect, it } from "vitest";
import { etiquetaDelHost, isVisualsHost } from "./prefijo";
import { visualFrameParentOrigins, visualFrameUrl } from "./visuals-host";

const PROD = { NODE_ENV: "production", LIENZO_BASE_HOST: "openlen.app", NEXT_PUBLIC_SITE_URL: "https://openlen.com" };
const DEV = { NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "https://openlen.com" };

describe("visualFrameUrl", () => {
  it("in production, the visuals host on the lienzo domain", () => {
    expect(visualFrameUrl({ hostDeLaPeticion: "openlen.com" }, PROD)).toBe("https://lienzo-visuals.openlen.app/");
  });

  it("in production without a lienzo domain, none (the chat uses srcdoc)", () => {
    expect(visualFrameUrl({ hostDeLaPeticion: "openlen.com" }, { NODE_ENV: "production" })).toBeNull();
  });

  it("locally, the visuals host on localhost with the request's port", () => {
    expect(visualFrameUrl({ hostDeLaPeticion: "localhost:3000" }, DEV)).toBe("http://lienzo-visuals.localhost:3000/");
    expect(visualFrameUrl({ hostDeLaPeticion: "localhost:3000" }, PROD)).toBe("http://lienzo-visuals.localhost:3000/");
  });

  it("with the lienzo switched off, none", () => {
    expect(visualFrameUrl({ hostDeLaPeticion: "openlen.com" }, { ...PROD, OPENLEN_LIENZO_ORIGEN: "0" })).toBeNull();
  });
});

describe("visualFrameParentOrigins", () => {
  it("in production, only the app", () => {
    expect(visualFrameParentOrigins({ hostDeLaPeticion: "lienzo-visuals.openlen.app" }, PROD)).toEqual(["https://openlen.com"]);
  });

  it("locally, the app plus localhost and 127.0.0.1 on the request's port", () => {
    expect(visualFrameParentOrigins({ hostDeLaPeticion: "lienzo-visuals.localhost:3000" }, DEV)).toEqual([
      "https://openlen.com",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);
  });

  it("no duplicates when the app itself is localhost", () => {
    expect(
      visualFrameParentOrigins({ hostDeLaPeticion: "lienzo-visuals.localhost:3000" }, { NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }),
    ).toEqual(["http://localhost:3000", "http://127.0.0.1:3000"]);
  });
});

describe("isVisualsHost", () => {
  it("is the visuals label, with or without port, in any case", () => {
    expect(isVisualsHost("lienzo-visuals.openlen.app")).toBe(true);
    expect(isVisualsHost("LIENZO-VISUALS.openlen.app")).toBe(true);
    expect(isVisualsHost("lienzo-visuals.localhost:3000")).toBe(true);
  });

  it("is not a project lienzo, nor a bare label", () => {
    expect(isVisualsHost(`lienzo-${"0".repeat(32)}.openlen.app`)).toBe(false);
    expect(isVisualsHost("lienzo-visuals")).toBe(false);
    expect(isVisualsHost(null)).toBe(false);
  });

  it("the lienzo label reader still ignores it", () => {
    expect(etiquetaDelHost("lienzo-visuals.openlen.app")).toBeNull();
  });
});
