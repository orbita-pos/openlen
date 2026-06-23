import { describe, it, expect } from "vitest";
import { extractVideoId, buildEmbedUrl, bakeVideoEmbeds, bakeMediaPreconnect } from "./video-embed";

describe("extractVideoId — valid", () => {
  it("youtube watch", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
  });
  it("youtu.be short", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
  });
  it("youtube /embed and /shorts", () => {
    expect(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
  });
  it("watch with extra params keeps only the id", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLx")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
  });
  it("vimeo plain + player", () => {
    expect(extractVideoId("https://vimeo.com/123456789")).toEqual({ provider: "vimeo", id: "123456789" });
    expect(extractVideoId("https://player.vimeo.com/video/123456789")).toEqual({ provider: "vimeo", id: "123456789" });
  });
});

describe("extractVideoId — malicious / invalid → null", () => {
  const bad = [
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ", // lookalike host
    "https://evil.com/watch?v=dQw4w9WgXcQ",
    "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://www.youtube.com/watch?v=<script>",
    "https://www.youtube.com/watch?v=../../evil",
    "https://www.youtube.com/watch?v=tooShort",
    "https://vimeo.com/notanumber",
    "https://vimeo.com/12", // too short
    "not a url",
    "",
  ];
  for (const u of bad) it(`rejects ${u.slice(0, 48)}`, () => expect(extractVideoId(u)).toBeNull());
});

describe("buildEmbedUrl — fixed canonical origins", () => {
  it("youtube → youtube-nocookie", () => {
    expect(buildEmbedUrl({ provider: "youtube", id: "dQw4w9WgXcQ" })).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0");
  });
  it("vimeo → player.vimeo", () => {
    expect(buildEmbedUrl({ provider: "vimeo", id: "123456789" })).toBe("https://player.vimeo.com/video/123456789?autoplay=1");
  });
});

describe("bakeVideoEmbeds", () => {
  const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

  it("tags a youtube anchor + injects the lightbox, keeps the href", () => {
    const out = bakeVideoEmbeds(page(`<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Watch</a>`));
    expect(out).toContain(`data-ol-video="yt:dQw4w9WgXcQ"`);
    expect(out).toContain(`href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"`); // preserved
    expect(out).toContain("data-ol-video-lightbox");
    expect(out).toContain("youtube-nocookie.com/embed/"); // canonical origin in the runtime
  });

  it("is idempotent", () => {
    const once = bakeVideoEmbeds(page(`<a href="https://youtu.be/dQw4w9WgXcQ">x</a>`));
    expect(bakeVideoEmbeds(once)).toBe(once);
  });

  it("no-op when there are no video links", () => {
    const p = page(`<a href="https://example.com/about">About</a><p>hi</p>`);
    expect(bakeVideoEmbeds(p)).toBe(p);
    expect(bakeVideoEmbeds(p)).not.toContain("data-ol-video");
  });

  it("does NOT tag a lookalike host (security)", () => {
    const out = bakeVideoEmbeds(page(`<a href="https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ">x</a>`));
    expect(out).not.toContain("data-ol-video=");
    expect(out).not.toContain("data-ol-video-lightbox");
  });

  it("tags multiple + only the runtime once", () => {
    const out = bakeVideoEmbeds(page(`<a href="https://youtu.be/dQw4w9WgXcQ">a</a><a href="https://vimeo.com/123456789">b</a>`));
    expect(out).toContain(`data-ol-video="yt:dQw4w9WgXcQ"`);
    expect(out).toContain(`data-ol-video="vm:123456789"`);
    expect((out.match(/<script data-ol-video-lightbox>/g) || []).length).toBe(1);
  });
});

describe("bakeVideoEmbeds — embed preconnect hint", () => {
  const page = (href: string) => `<html><head></head><body><a href="${href}">v</a></body></html>`;
  it("adds a YouTube preconnect (only) when a YT link is present", () => {
    const out = bakeVideoEmbeds(page("https://youtu.be/dQw4w9WgXcQ"));
    expect(out).toContain('<link rel="preconnect" href="https://www.youtube-nocookie.com">');
    // (the runtime JS always mentions player.vimeo.com in its provider map; assert
    // on the preconnect LINK, which should NOT be present for a YT-only page.)
    expect(out).not.toContain('<link rel="preconnect" href="https://player.vimeo.com">');
  });
  it("adds a Vimeo preconnect when a Vimeo link is present", () => {
    const out = bakeVideoEmbeds(page("https://vimeo.com/123456789"));
    expect(out).toContain('<link rel="preconnect" href="https://player.vimeo.com">');
  });
  it("adds NO preconnect when there is no recognized video link", () => {
    const out = bakeVideoEmbeds(page("https://example.com/about"));
    expect(out).not.toContain("preconnect");
  });
});

describe("bakeMediaPreconnect — self-hosted video", () => {
  it("preconnects to the cross-origin host of a <video src>", () => {
    const out = bakeMediaPreconnect(
      '<html><head></head><body><video src="https://uploads.openlen.com/v/abc.mp4"></video></body></html>',
    );
    expect(out).toContain('<link rel="preconnect" href="https://uploads.openlen.com" data-ol-media-preconnect>');
  });
  it("preconnects for a cross-origin <source src> too", () => {
    const out = bakeMediaPreconnect('<head></head><video><source src="https://r2.example.com/a.webm"></video>');
    expect(out).toContain('href="https://r2.example.com"');
  });
  it("is a no-op for relative / same-origin media", () => {
    const html = '<head></head><video src="/uploads/a.mp4"></video>';
    expect(bakeMediaPreconnect(html)).toBe(html);
  });
  it("is idempotent", () => {
    const html = '<head></head><video src="https://uploads.openlen.com/a.mp4"></video>';
    const once = bakeMediaPreconnect(html);
    expect(bakeMediaPreconnect(once)).toBe(once);
  });
});
