// @vitest-environment node
import { describe, expect, it } from "vitest";

import { GRANTABLE, readDeclaredPermissions } from "./declared";

const manifest = (json: string, attrs = 'id="openlen-app-manifest" type="application/json"') =>
  `<!doctype html><html><head><title>t</title><script ${attrs}>${json}</script></head><body><div id="root"></div></body></html>`;

describe("GRANTABLE", () => {
  it("is only notifications", () => {
    expect(GRANTABLE).toEqual(["notifications"]);
  });
});

describe("readDeclaredPermissions", () => {
  it("gives no permissions and no error for a shell without the tag", () => {
    expect(readDeclaredPermissions("<html><body><div id=root></div></body></html>")).toEqual({ permissions: [], error: null });
    expect(readDeclaredPermissions("")).toEqual({ permissions: [], error: null });
  });

  it("reads the names of a valid tag", () => {
    expect(readDeclaredPermissions(manifest('{"permissions":["notifications"]}'))).toEqual({
      permissions: ["notifications"],
      error: null,
    });
    expect(readDeclaredPermissions(manifest('{"permissions":["shortcuts","overlay","menu-bar","full-access"]}'))).toEqual({
      permissions: ["shortcuts", "overlay", "menu-bar", "full-access"],
      error: null,
    });
  });

  it("reads the tag whatever the order, quotes and case of its attributes", () => {
    for (const attrs of [
      "type='application/json' id='openlen-app-manifest'",
      'type=application/json id=openlen-app-manifest',
      'data-x="a>b" ID="openlen-app-manifest" TYPE="Application/JSON"',
      'defer id="openlen-app-manifest" type=" application/json "',
    ]) {
      expect(readDeclaredPermissions(manifest('{"permissions":["notifications"]}', attrs))).toEqual({
        permissions: ["notifications"],
        error: null,
      });
    }
  });

  it("drops names that do not exist, in silence", () => {
    expect(readDeclaredPermissions(manifest('{"permissions":["camera","notifications","Notifications",""]}'))).toEqual({
      permissions: ["notifications"],
      error: null,
    });
  });

  it("drops what is not a name and keeps each name once", () => {
    expect(readDeclaredPermissions(manifest('{"permissions":[1,null,{"a":1},"notifications","notifications"]}'))).toEqual({
      permissions: ["notifications"],
      error: null,
    });
  });

  it("ignores the keys it does not know", () => {
    expect(readDeclaredPermissions(manifest('{"version":3,"permissions":["notifications"],"extra":{"permissions":["overlay"]}}'))).toEqual({
      permissions: ["notifications"],
      error: null,
    });
  });

  it("declares nothing, without an error, when the object has no permissions key", () => {
    expect(readDeclaredPermissions(manifest("{}"))).toEqual({ permissions: [], error: null });
  });

  it("gives no permissions and an error for JSON that does not parse", () => {
    const out = readDeclaredPermissions(manifest('{"permissions":["notifications"'));
    expect(out.permissions).toEqual([]);
    expect(out.error).toMatch(/openlen-app-manifest/);
    expect(out.error).toMatch(/JSON/);
  });

  it("gives no permissions and an error for JSON of the wrong shape", () => {
    for (const json of ["[]", "null", '"notifications"', "7", '{"permissions":"notifications"}', '{"permissions":{"0":"notifications"}}']) {
      const out = readDeclaredPermissions(manifest(json));
      expect(out.permissions).toEqual([]);
      expect(out.error).toMatch(/openlen-app-manifest/);
    }
  });

  it("gives no permissions and an error for a tag over 16000 characters, and accepts one of exactly 16000", () => {
    const wrap = (len: number) => {
      const head = '{"permissions":["notifications"],"pad":"';
      const tail = '"}';
      return head + "a".repeat(len - head.length - tail.length) + tail;
    };
    const ok = wrap(16000);
    expect(ok).toHaveLength(16000);
    expect(readDeclaredPermissions(manifest(ok))).toEqual({ permissions: ["notifications"], error: null });

    const big = wrap(16001);
    expect(big).toHaveLength(16001);
    const out = readDeclaredPermissions(manifest(big));
    expect(out.permissions).toEqual([]);
    expect(out.error).toMatch(/16000/);
  });

  it("keeps only the first 32 names", () => {
    const names = ["notifications", ...Array.from({ length: 31 }, (_, i) => `unknown-${i}`), "shortcuts"];
    expect(names).toHaveLength(33);
    expect(readDeclaredPermissions(manifest(JSON.stringify({ permissions: names })))).toEqual({
      permissions: ["notifications"],
      error: null,
    });

    const first = ["overlay", ...Array.from({ length: 31 }, (_, i) => `unknown-${i}`)];
    expect(readDeclaredPermissions(manifest(JSON.stringify({ permissions: [...first, "notifications"] }))).permissions).toEqual(["overlay"]);
  });

  it("drops a name over 64 characters without it counting toward the 32", () => {
    const tooLong = "n".repeat(65);
    const exactly64 = "x".repeat(64);
    const names = [...Array.from({ length: 40 }, () => tooLong), exactly64, "notifications"];
    expect(readDeclaredPermissions(manifest(JSON.stringify({ permissions: names })))).toEqual({
      permissions: ["notifications"],
      error: null,
    });
    expect(readDeclaredPermissions(manifest(JSON.stringify({ permissions: [tooLong] })))).toEqual({ permissions: [], error: null });
  });

  it("ignores a tag of another type or another id", () => {
    const json = '{"permissions":["notifications"]}';
    expect(readDeclaredPermissions(manifest(json, 'id="openlen-app-manifest" type="text/javascript"'))).toEqual({ permissions: [], error: null });
    expect(readDeclaredPermissions(manifest(json, 'id="openlen-app-manifest"'))).toEqual({ permissions: [], error: null });
    expect(readDeclaredPermissions(manifest(json, 'id="other-manifest" type="application/json"'))).toEqual({ permissions: [], error: null });
    expect(readDeclaredPermissions(manifest(json, 'type="application/json"'))).toEqual({ permissions: [], error: null });
  });

  it("ignores a tag that is not a script, one inside a comment and one inside another script's text", () => {
    const json = '{"permissions":["notifications"]}';
    expect(
      readDeclaredPermissions(`<div id="openlen-app-manifest" type="application/json">${json}</div>`),
    ).toEqual({ permissions: [], error: null });
    expect(
      readDeclaredPermissions(`<!-- <script id="openlen-app-manifest" type="application/json">${json}</script> --><p></p>`),
    ).toEqual({ permissions: [], error: null });
    expect(
      readDeclaredPermissions(
        `<script>const s = '<script id="openlen-app-manifest" type="application/json">${json}</script>';</script>`,
      ),
    ).toEqual({ permissions: [], error: null });
  });

  it("reads the manifest that comes after other scripts and comments", () => {
    const html =
      '<!-- <script id="openlen-app-manifest" type="application/json">{"permissions":["overlay"]}</script> -->' +
      '<script type="module">console.log("<!--")</script>' +
      '<SCRIPT id="openlen-app-manifest" type="application/json">\n  { "permissions": ["notifications"] }\n</SCRIPT>';
    expect(readDeclaredPermissions(html)).toEqual({ permissions: ["notifications"], error: null });
  });

  it("uses the first tag that matches", () => {
    const html =
      '<script id="openlen-app-manifest" type="application/json">{"permissions":["notifications"]}</script>' +
      '<script id="openlen-app-manifest" type="application/json">{"permissions":["overlay"]}</script>';
    expect(readDeclaredPermissions(html)).toEqual({ permissions: ["notifications"], error: null });
  });
});
