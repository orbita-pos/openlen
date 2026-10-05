// Las cabeceras de un objeto: las de Supabase (su `Renderer`) más lo que hace
// que un fichero subido por un visitante NUNCA se ejecute (Review Focus 1) y
// que lo privado no se quede en la CDN (Review Focus 3).
import { describe, expect, it } from "vitest";

import { objectHeaders } from "./serve-headers";

const meta = (mimetype: string) => ({ mimetype, eTag: '"abc"', cacheControl: "max-age=3600", lastModified: "2026-10-04T12:00:00.000Z", size: 3 });

describe("objectHeaders", () => {
  it("text/html sale como text/plain (su normalizeContentType), con nosniff y sandbox", () => {
    const h = objectHeaders(meta("text/html; charset=utf-8"), { visibility: "public" });
    expect(h.get("content-type")).toBe("text/plain");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it.each(["image/svg+xml", "application/xml", "text/xml", "application/xhtml+xml", "application/javascript", "text/javascript", "application/json"])(
    "%s guarda su tipo pero lleva sandbox: no ejecuta",
    (mime) => {
      const h = objectHeaders(meta(mime), { visibility: "public" });
      expect(h.get("content-type")).toBe(mime);
      expect(h.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    },
  );

  it.each(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "video/mp4", "audio/mpeg", "application/pdf", "text/plain", "application/octet-stream"])(
    "%s, que no ejecuta, va sin CSP (el visor de PDF de Chrome no pinta con sandbox)",
    (mime) => {
      const h = objectHeaders(meta(mime), { visibility: "public" });
      expect(h.get("content-security-policy")).toBeNull();
      expect(h.get("x-content-type-options")).toBe("nosniff");
    },
  );

  it("lo privado no se cachea en la CDN: private delante", () => {
    expect(objectHeaders(meta("image/png"), { visibility: "private" }).get("cache-control")).toBe("private, max-age=3600");
    expect(objectHeaders(meta("image/png"), { visibility: "public" }).get("cache-control")).toBe("max-age=3600");
  });

  it("ETag, Last-Modified, Accept-Ranges y X-Robots-Tag de Supabase", () => {
    const h = objectHeaders(meta("image/png"), { visibility: "public" });
    expect(h.get("etag")).toBe('"abc"');
    expect(h.get("last-modified")).toBe("Sun, 04 Oct 2026 12:00:00 GMT");
    expect(h.get("accept-ranges")).toBe("bytes");
    expect(h.get("x-robots-tag")).toBe("none");
  });

  it("?download → attachment; con nombre, como su handleDownload", () => {
    expect(objectHeaders(meta("image/png"), { visibility: "public", download: "" }).get("content-disposition")).toBe("attachment;");
    expect(objectHeaders(meta("image/png"), { visibility: "public", download: "foto de ñu.png" }).get("content-disposition")).toBe(
      `attachment; filename="foto de _u.png"; filename*=UTF-8''foto%20de%20%C3%B1u.png`,
    );
  });
});
