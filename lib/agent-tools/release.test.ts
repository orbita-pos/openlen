// @vitest-environment node
import { describe, expect, it } from "vitest";

import { makePointer } from "@/lib/files/blob-pointer";

import { AGENT_TOOL_VERSION_MAX_BYTES } from "./limits";
import { buildAgentToolRelease } from "./release";

const SPACE = "9d1f7c0e-aaaa-4bbb-8ccc-000000000001";
const FOLDER = "/tools/ana/recorrido";

function build(files: Record<string, string>, over: { folder?: string; spaceProjectId?: string } = {}) {
  return buildAgentToolRelease({ spaceProjectId: over.spaceProjectId ?? SPACE, folder: over.folder ?? FOLDER, files });
}

function ok(files: Record<string, string>, over: { folder?: string; spaceProjectId?: string } = {}) {
  const r = build(files, over);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r;
}

const MINIMAL = { [`${FOLDER}/index.html`]: "<h1>hola</h1>" };

describe("buildAgentToolRelease: what it takes", () => {
  it("re-roots the folder's files at / and gives each its content type", () => {
    const r = ok({
      [`${FOLDER}/index.html`]: "<h1>hola</h1>",
      [`${FOLDER}/css/app.css`]: "body{margin:0}",
      [`${FOLDER}/js/main.js`]: "console.log(1)",
    });
    expect(Object.keys(r.files).sort()).toEqual(["/css/app.css", "/index.html", "/js/main.js"]);
    expect(r.files["/index.html"]).toEqual({ content: "<h1>hola</h1>", contentType: "text/html; charset=utf-8" });
    expect(r.files["/css/app.css"]!.contentType).toBe("text/css; charset=utf-8");
    expect(r.files["/js/main.js"]!.contentType).toBe("text/javascript; charset=utf-8");
  });

  it("accepts the folder with or without a trailing slash", () => {
    expect(ok(MINIMAL, { folder: `${FOLDER}/` }).files).toEqual(ok(MINIMAL).files);
    expect(ok(MINIMAL, { folder: `${FOLDER}/` }).sha).toBe(ok(MINIMAL).sha);
  });

  it("leaves out everything that is not strictly under the folder", () => {
    const r = ok({
      ...MINIMAL,
      "/index.html": "<h1>the space's own page</h1>",
      "/tools/ana/recorrido-2/index.html": "<h1>a neighbour</h1>",
      "/tools/ana/recorrido-2/extra.js": "1",
      "/tools/ana/otra/index.html": "<h1>another tool</h1>",
      "/tools/bea/recorrido/index.html": "<h1>another agent's</h1>",
      "/tools/ana/recorrido.html": "<h1>a file with the folder's name</h1>",
    });
    expect(Object.keys(r.files)).toEqual(["/index.html"]);
    expect(r.files["/index.html"]!.content).toBe("<h1>hola</h1>");
  });

  it("keeps a binary as its pointer, with its type from the extension", () => {
    const pointer = makePointer({ sha256: "a".repeat(64), size: 1234, gitOid: "b".repeat(40) });
    const r = ok({ ...MINIMAL, [`${FOLDER}/img/logo.png`]: pointer });
    expect(r.files["/img/logo.png"]).toEqual({ content: pointer, contentType: "image/png" });
  });
});

describe("buildAgentToolRelease: what it refuses", () => {
  it("nothing under the folder is empty, not a missing index", () => {
    expect(build({})).toEqual({ ok: false, error: "empty" });
    expect(build({ "/tools/ana/recorrido-2/index.html": "x", "/index.html": "y" })).toEqual({ ok: false, error: "empty" });
  });

  it("a folder that is the root of the project is empty: a tool is never the whole space", () => {
    expect(build({ "/index.html": "x", "/css/a.css": "y" }, { folder: "/" })).toEqual({ ok: false, error: "empty" });
    expect(build({ "/index.html": "x" }, { folder: "" })).toEqual({ ok: false, error: "empty" });
  });

  it("files but no index.html at the folder's own level is no_index", () => {
    expect(build({ [`${FOLDER}/css/app.css`]: "a{}" })).toEqual({ ok: false, error: "no_index" });
    expect(build({ [`${FOLDER}/sub/index.html`]: "<h1>nested</h1>" })).toEqual({ ok: false, error: "no_index" });
    expect(build({ [`${FOLDER}/INDEX.html`]: "<h1>wrong case</h1>" })).toEqual({ ok: false, error: "no_index" });
  });

  it("the version's size is capped at AGENT_TOOL_VERSION_MAX_BYTES, one byte more is too_big", () => {
    expect(build({ [`${FOLDER}/index.html`]: "a".repeat(AGENT_TOOL_VERSION_MAX_BYTES) }).ok).toBe(true);
    expect(build({ [`${FOLDER}/index.html`]: "a".repeat(AGENT_TOOL_VERSION_MAX_BYTES + 1) })).toEqual({ ok: false, error: "too_big" });
  });

  it("counts the size in bytes, not characters", () => {
    // "é" is 2 bytes in UTF-8: half the cap in characters is the whole cap in bytes
    const twoByte = "é".repeat(AGENT_TOOL_VERSION_MAX_BYTES / 2);
    expect(build({ [`${FOLDER}/index.html`]: twoByte }).ok).toBe(true);
    expect(build({ [`${FOLDER}/index.html`]: twoByte + "a" })).toEqual({ ok: false, error: "too_big" });
  });

  it("adds the files up, and a blob pointer counts its stored size, not its own length", () => {
    const pointer = (size: number) => makePointer({ sha256: "c".repeat(64), size, gitOid: "d".repeat(40) });
    const half = AGENT_TOOL_VERSION_MAX_BYTES / 2;
    const files = (a: number, b: number) => ({
      ...MINIMAL,
      [`${FOLDER}/video/a.mp4`]: pointer(a),
      [`${FOLDER}/video/b.mp4`]: pointer(b),
    });
    expect(build(files(half, half - MINIMAL[`${FOLDER}/index.html`]!.length)).ok).toBe(true);
    expect(build(files(half, half))).toEqual({ ok: false, error: "too_big" });
  });

  it("files outside the folder do not count towards the size", () => {
    const huge = "x".repeat(AGENT_TOOL_VERSION_MAX_BYTES + 1);
    expect(build({ ...MINIMAL, "/tools/ana/recorrido-2/big.bin": huge, "/big.txt": huge }).ok).toBe(true);
  });
});

describe("buildAgentToolRelease: the version's sha", () => {
  it("is a sha256 hex", () => {
    expect(ok(MINIMAL).sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same for the same files, whatever the order they come in", () => {
    const a = ok({ [`${FOLDER}/index.html`]: "<h1>x</h1>", [`${FOLDER}/a.js`]: "1", [`${FOLDER}/b.css`]: "b{}" });
    const b = ok({ [`${FOLDER}/b.css`]: "b{}", [`${FOLDER}/a.js`]: "1", [`${FOLDER}/index.html`]: "<h1>x</h1>" });
    expect(a.sha).toBe(b.sha);
  });

  it("does not change with files outside the folder", () => {
    expect(ok({ ...MINIMAL, "/other.txt": "noise", "/tools/ana/recorrido-2/index.html": "noise" }).sha).toBe(ok(MINIMAL).sha);
  });

  it("changes with one byte of one file", () => {
    const base = { [`${FOLDER}/index.html`]: "<h1>x</h1>", [`${FOLDER}/a.js`]: "var a = 1" };
    expect(ok({ ...base, [`${FOLDER}/a.js`]: "var a = 2" }).sha).not.toBe(ok(base).sha);
  });

  it("changes with a path, with an added file and with the space's project", () => {
    const base = { [`${FOLDER}/index.html`]: "<h1>x</h1>", [`${FOLDER}/a.js`]: "1" };
    const moved = { [`${FOLDER}/index.html`]: "<h1>x</h1>", [`${FOLDER}/b.js`]: "1" };
    expect(ok(moved).sha).not.toBe(ok(base).sha);
    expect(ok({ ...base, [`${FOLDER}/c.js`]: "" }).sha).not.toBe(ok(base).sha);
    expect(ok(base, { spaceProjectId: "9d1f7c0e-aaaa-4bbb-8ccc-000000000002" }).sha).not.toBe(ok(base).sha);
  });

  it("does not depend on where the folder is, only on what is in it", () => {
    const here = ok({ "/tools/ana/recorrido/index.html": "<h1>x</h1>" });
    const there = ok({ "/tools/ana/otra/index.html": "<h1>x</h1>" }, { folder: "/tools/ana/otra" });
    expect(there.sha).toBe(here.sha);
  });

  it("tells apart contents that would run together without a separator", () => {
    const one = ok({ ...MINIMAL, [`${FOLDER}/a`]: "bc", [`${FOLDER}/d`]: "" });
    const two = ok({ ...MINIMAL, [`${FOLDER}/a`]: "b", [`${FOLDER}/cd`]: "" });
    expect(one.sha).not.toBe(two.sha);
    const three = ok({ ...MINIMAL, [`${FOLDER}/ab`]: "c" });
    const four = ok({ ...MINIMAL, [`${FOLDER}/a`]: "bc" });
    expect(three.sha).not.toBe(four.sha);
  });
});
