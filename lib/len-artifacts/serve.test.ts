// @vitest-environment node
//
// SERVING AN AGENT'S TOOL on its own private label (spec local 2026-11-22-artifacts-de-len, §2): its published
// version, the bridge first in <head>, and a tight content policy on every answer.
import { describe, expect, it, vi } from "vitest";

import { ORIGENES_DE_LA_APP } from "@/lib/movil/cors";
import { VISUALS_CDN_ORIGINS } from "@/lib/visuals/frame-document";

import { lenArtifactContentPolicy, serveLenArtifact, type LenArtifactServeDeps } from "./serve";
import type { LenArtifactRow } from "./store";

const WORKSPACE_LABEL = "lienzo-0123456789abcdef0123456789abcdef";
const PHONE_LABEL = "lienzo-fedcba9876543210fedcba9876543210";

const ROW: LenArtifactRow & { servedTo: "workspace" | "phone" } = {
  id: "t1",
  assistantId: "a1",
  personId: "u1",
  projectId: "p1",
  slug: "recorrido",
  title: "Recorrido",
  folder: "/.artifacts/ana/recorrido",
  releaseSha: "sha1",
  hostLabel: WORKSPACE_LABEL,
  phoneHostLabel: PHONE_LABEL,
  createdAt: new Date(),
  updatedAt: new Date(),
  dataChangedAt: null,
  makerSeenAt: null,
  servedTo: "workspace",
};

const RELEASE = {
  "/index.html": { content: `<!doctype html><html><head><title>R</title></head><body><div id="app"></div><script src="/app.js"></script></body></html>`, contentType: "text/html; charset=utf-8" },
  "/app.js": { content: "console.log(1)", contentType: "text/javascript; charset=utf-8" },
  "/data/seed.json": { content: `{"a":1}`, contentType: "application/json; charset=utf-8" },
  "/openlen/tool-bridge.js": { content: "alert('the release shadows the bridge')", contentType: "text/javascript; charset=utf-8" },
};

const deps = (over: Partial<LenArtifactServeDeps> = {}): LenArtifactServeDeps => ({
  readRelease: vi.fn(async () => RELEASE),
  getBlob: vi.fn(async () => new Uint8Array([1, 2, 3])),
  ...over,
});

const ENV = { NEXT_PUBLIC_SITE_URL: "https://openlen.com", NODE_ENV: "production" };
const serve = (path: string, d = deps(), row = ROW, env: Record<string, string | undefined> = ENV) =>
  serveLenArtifact(row, path, { requestHost: "openlen.com", env }, d);
const onPhone = (path: string, d = deps()) => serve(path, d, { ...ROW, servedTo: "phone" });

// The phone app's origins as the app declares them: a change there is a change here.
const PHONE_ORIGINS = ORIGENES_DE_LA_APP.join(" ");

/** `{ "script-src": ["'self'", ...] }` — each directive's sources, to assert on one at a time. */
function directives(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name] = sources;
  }
  return out;
}

describe("lenArtifactContentPolicy", () => {
  const d = directives(lenArtifactContentPolicy("https://openlen.com"));
  const cdns = [...VISUALS_CDN_ORIGINS];

  it("loads scripts and styles from the visuals' CDNs and from its own files", () => {
    expect(d["default-src"]).toEqual(["'none'"]);
    expect(d["script-src"]).toEqual(["'self'", "'unsafe-inline'", ...cdns]);
    expect(d["style-src"]).toEqual(["'self'", "'unsafe-inline'", ...cdns, "https://fonts.googleapis.com"]);
    expect(d["font-src"]).toEqual(["'self'", ...cdns, "https://fonts.gstatic.com", "data:"]);
  });

  it("images and media are its own files or inline: no remote picture is a way out", () => {
    expect(d["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(d["media-src"]).toEqual(["'self'", "data:", "blob:"]);
  });

  it("🔴 the only place it can connect to is itself: what it stores can't leave it", () => {
    expect(d["connect-src"]).toEqual(["'self'"]);
    for (const origin of cdns) expect(d["connect-src"]).not.toContain(origin);
  });

  it("no form posts, no <base>, no frames, workers only from blobs", () => {
    expect(d["form-action"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'none'"]);
    expect(d["frame-src"]).toEqual(["'none'"]);
    expect(d["worker-src"]).toEqual(["blob:"]);
  });

  it("is framed only by who it is given", () => {
    expect(d["frame-ancestors"]).toEqual(["https://openlen.com"]);
    expect(directives(lenArtifactContentPolicy(PHONE_ORIGINS))["frame-ancestors"]).toEqual(PHONE_ORIGINS.split(" "));
  });
});

describe("serveLenArtifact — the page", () => {
  it("`/` is the version's index, with the bridge first in <head>, once", async () => {
    const res = await serve("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html.match(/tool-bridge\.js/g)).toHaveLength(1);
    expect(html).toContain(`<head><script src="/openlen/tool-bridge.js"></script><title>R</title>`);
  });

  it("`/index.html` is the same document", async () => {
    expect(await (await serve("/index.html")).text()).toBe(await (await serve("/")).text());
  });

  it("reads the version its row names", async () => {
    const d = deps();
    await serve("/", d);
    expect(d.readRelease).toHaveBeenCalledWith("sha1");
  });

  it("every answer is never cached, never sniffed, sends no referrer and carries the content policy", async () => {
    const policy = lenArtifactContentPolicy("https://openlen.com");
    for (const path of ["/", "/app.js", "/data/seed.json", "/openlen/tool-bridge.js"]) {
      const res = await serve(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("content-security-policy")).toBe(policy);
    }
  });

  it("every answer switches off DNS prefetching and the camera, microphone, location and payments", async () => {
    for (const path of ["/", "/app.js", "/openlen/tool-bridge.js"]) {
      const res = await serve(path);
      expect(res.headers.get("x-dns-prefetch-control")).toBe("off");
      expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=(), payment=()");
    }
  });

  it("on the workspace's label the workspace frames it", async () => {
    const res = await serve("/");
    expect(directives(res.headers.get("content-security-policy")!)["frame-ancestors"]).toEqual(["https://openlen.com"]);
  });
});

describe("serveLenArtifact — the other files", () => {
  it("a file of the version comes with its stored type", async () => {
    const res = await serve("/app.js");
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await res.text()).toBe("console.log(1)");
    const json = await serve("/data/seed.json");
    expect(json.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await json.text()).toBe(`{"a":1}`);
  });

  it("a binary comes as its bytes, never its pointer", async () => {
    const pointer = "￿openlen-blob:" + "a".repeat(64) + ":3:" + "b".repeat(40);
    const d = deps({ readRelease: vi.fn(async () => ({ ...RELEASE, "/img/a.png": { content: pointer, contentType: "image/png" } })) });
    const res = await serve("/img/a.png", d);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(d.getBlob).toHaveBeenCalledWith(pointer);
  });

  it("a path the version doesn't have is a 404, and so is one that only looks like a key of an object", async () => {
    for (const path of ["/nope.js", "/data/", "/../index.html", "/__proto__", "/constructor", "/toString"]) {
      expect((await serve(path)).status).toBe(404);
    }
  });

  it("a version without an index doesn't serve `/`", async () => {
    const { "/index.html": _index, ...rest } = RELEASE;
    expect((await serve("/", deps({ readRelease: vi.fn(async () => rest) }))).status).toBe(404);
  });
});

describe("serveLenArtifact — the bridge script", () => {
  it("is the agent tool's: data, and none of the installed tools' methods", async () => {
    const res = await serve("/openlen/tool-bridge.js");
    expect(res.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    const js = await res.text();
    expect(js).toContain("window.openlen");
    expect(js).toContain("data.subscribe");
    for (const gone of ["jobs.", "files.", '"backend"', '"projects"', '"forms"', '"visits"']) expect(js).not.toContain(gone);
  });

  it("answers only the app's origin, and wins over a file of the version with its name", async () => {
    const js = await (await serve("/openlen/tool-bridge.js")).text();
    expect(js).toContain(`"https://openlen.com"`);
    expect(js).not.toContain("the release shadows the bridge");
  });

  it("reads no version at all", async () => {
    const d = deps();
    await serve("/openlen/tool-bridge.js", d);
    expect(d.readRelease).not.toHaveBeenCalled();
  });

  it("in development, the workspace on localhost may be its parent too", async () => {
    const res = await serveLenArtifact(ROW, "/openlen/tool-bridge.js", { requestHost: "localhost:3000", env: { NEXT_PUBLIC_SITE_URL: "https://openlen.com", NODE_ENV: "development" } }, deps());
    const js = await res.text();
    expect(js).toContain(`"http://localhost:3000"`);
  });
});

describe("serveLenArtifact — on the phone's label", () => {
  it("the page is framed only by the app's origins", async () => {
    const res = await onPhone("/");
    expect(res.status).toBe(200);
    expect(directives(res.headers.get("content-security-policy")!)["frame-ancestors"]).toEqual(PHONE_ORIGINS.split(" "));
    expect(res.headers.get("content-security-policy")).toBe(lenArtifactContentPolicy(PHONE_ORIGINS));
  });

  it("its bridge answers only the app's origins", async () => {
    const res = await onPhone("/openlen/tool-bridge.js");
    const js = await res.text();
    expect(js).toContain(`"https://localhost"`);
    expect(js).toContain(`"capacitor://localhost"`);
    expect(js).not.toContain(`"https://openlen.com"`);
    expect(res.headers.get("content-security-policy")).toBe(lenArtifactContentPolicy(PHONE_ORIGINS));
  });

  it("its other files carry the same policy", async () => {
    expect((await onPhone("/app.js")).headers.get("content-security-policy")).toBe(lenArtifactContentPolicy(PHONE_ORIGINS));
  });
});

describe("serveLenArtifact — when it isn't there", () => {
  it("with agent tools off: 404, and nothing is read", async () => {
    const d = deps();
    for (const path of ["/", "/app.js", "/openlen/tool-bridge.js"]) {
      expect((await serve(path, d, ROW, { ...ENV, OPENLEN_LEN_ARTIFACTS: "0" })).status).toBe(404);
    }
    expect(d.readRelease).not.toHaveBeenCalled();
  });

  it("its version gone: 404", async () => {
    expect((await serve("/", deps({ readRelease: vi.fn(async () => null) }))).status).toBe(404);
  });
});
