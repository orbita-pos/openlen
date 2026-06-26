// Tests for ensureSocialOgImage — the publish-time og:image decision + social
// meta. Deps (render + upload) are injected so this runs with NO headless
// Chrome. Run standalone:
//   npx tsx --test lib/branding/social-image.test.ts

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  absolutizeSocialMeta,
  ensureSocialOgImage,
  type SocialImageDeps,
} from "./social-image";

const DOC = (ogImage: string | null) =>
  `<!doctype html><html><head><title>T</title>${
    ogImage ? `<meta property="og:image" content="${ogImage}" />` : ""
  }</head><body><h1>Hi</h1></body></html>`;

function content(
  html: string,
  attr: string,
  value: string,
): string | null {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const a = m[0].match(new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, "i"));
    if (a && a[1].toLowerCase() === value.toLowerCase()) {
      const c = m[0].match(/\bcontent\s*=\s*"([^"]*)"/i);
      return c ? c[1] : null;
    }
  }
  return null;
}

const HOSTED = "https://img.openlen.com/og-cards/abc.png";
const okDeps: SocialImageDeps = {
  renderCard: async () => Buffer.from("PNG"),
  uploadPng: async () => HOSTED,
};

test("hosted hero og:image is kept; twitter:image mirrors it; no render", async () => {
  let rendered = false;
  const deps: SocialImageDeps = {
    renderCard: async () => {
      rendered = true;
      return null;
    },
    uploadPng: async () => null,
  };
  const out = await ensureSocialOgImage(
    DOC("https://cdn.example.com/hero.jpg"),
    { title: "T", baseUrl: "https://x.openlen.com" },
    deps,
  );
  assert.equal(rendered, false, "no render when a hosted hero exists");
  assert.equal(content(out, "property", "og:image"), "https://cdn.example.com/hero.jpg");
  assert.equal(content(out, "name", "twitter:image"), "https://cdn.example.com/hero.jpg");
  assert.equal(content(out, "property", "og:url"), "https://x.openlen.com/");
});

test("SVG card → rendered PNG hosted + dims + twitter:image", async () => {
  const out = await ensureSocialOgImage(
    DOC("data:image/svg+xml;base64,PHN2"),
    { title: "Café Luna", baseUrl: "https://x.openlen.com/" },
    okDeps,
  );
  assert.equal(content(out, "property", "og:image"), HOSTED);
  assert.equal(content(out, "name", "twitter:image"), HOSTED);
  assert.equal(content(out, "property", "og:image:width"), "1200");
  assert.equal(content(out, "property", "og:image:height"), "630");
  assert.ok(
    !(content(out, "property", "og:image") ?? "").startsWith("data:"),
    "svg replaced",
  );
});

test("missing og:image → rendered PNG inserted", async () => {
  const out = await ensureSocialOgImage(
    DOC(null),
    { title: "T", baseUrl: "https://x.openlen.com" },
    okDeps,
  );
  assert.equal(content(out, "property", "og:image"), HOSTED);
  assert.equal(content(out, "property", "og:image:width"), "1200");
});

test("render fails → SVG card dropped, og:url still added", async () => {
  const deps: SocialImageDeps = {
    renderCard: async () => null,
    uploadPng: async () => {
      throw new Error("upload must not be called when render is null");
    },
  };
  const out = await ensureSocialOgImage(
    DOC("data:image/svg+xml;base64,PHN2"),
    { title: "T", baseUrl: "https://x.openlen.com" },
    deps,
  );
  assert.equal(content(out, "property", "og:image"), null, "unreachable data: card dropped");
  assert.equal(content(out, "property", "og:url"), "https://x.openlen.com/");
});

test("upload fails → SVG card dropped too", async () => {
  const deps: SocialImageDeps = {
    renderCard: async () => Buffer.from("x"),
    uploadPng: async () => null,
  };
  const out = await ensureSocialOgImage(
    DOC("data:image/svg+xml;base64,PHN2"),
    { title: "T", baseUrl: "https://x.openlen.com" },
    deps,
  );
  assert.equal(content(out, "property", "og:image"), null);
});

test("og:url is non-destructive", async () => {
  const html = `<!doctype html><html><head><meta property="og:url" content="https://custom.example/page" /><meta property="og:image" content="https://cdn.x/h.jpg" /></head><body></body></html>`;
  const out = await ensureSocialOgImage(
    html,
    { title: "T", baseUrl: "https://x.openlen.com" },
    okDeps,
  );
  assert.equal(content(out, "property", "og:url"), "https://custom.example/page");
});

test("headless / no </head> → no-op", async () => {
  assert.equal(
    await ensureSocialOgImage("", { title: "T", baseUrl: "https://x" }, okDeps),
    "",
  );
});

// ── absolutizeSocialMeta (post-bake) ─────────────────────────────────────────

const BASE = "https://acme.openlen.com";

test("absolutize: a relativized Unsplash hero og:image + twitter:image → absolute", () => {
  // mirrors what migrateUnsplashAssets does to the meta downstream
  const html =
    `<!doctype html><html><head>` +
    `<meta property="og:image" content="/assets/abc.webp" />` +
    `<meta name="twitter:image" content="/assets/abc.webp" />` +
    `</head><body></body></html>`;
  const out = absolutizeSocialMeta(html, BASE);
  assert.equal(content(out, "property", "og:image"), `${BASE}/assets/abc.webp`);
  assert.equal(content(out, "name", "twitter:image"), `${BASE}/assets/abc.webp`);
});

test("absolutize: absolute + data: + protocol-relative are left untouched", () => {
  const html =
    `<!doctype html><html><head>` +
    `<meta property="og:image" content="https://img.x/og.png" />` +
    `<meta name="twitter:image" content="//cdn.x/y.png" />` +
    `</head><body></body></html>`;
  const out = absolutizeSocialMeta(html, BASE);
  assert.equal(content(out, "property", "og:image"), "https://img.x/og.png");
  assert.equal(content(out, "name", "twitter:image"), "//cdn.x/y.png");
});

test("absolutize: data: SVG card og:image is left alone", () => {
  const html = DOC("data:image/svg+xml;base64,PHN2");
  const out = absolutizeSocialMeta(html, BASE);
  assert.ok((content(out, "property", "og:image") ?? "").startsWith("data:"));
});

test("absolutize: relative og:url is absolutized; invalid baseUrl is a no-op", () => {
  const html = `<!doctype html><html><head><meta property="og:url" content="/es/" /></head><body></body></html>`;
  assert.equal(content(absolutizeSocialMeta(html, BASE), "property", "og:url"), `${BASE}/es/`);
  assert.equal(absolutizeSocialMeta(html, "not-a-url"), html);
});
