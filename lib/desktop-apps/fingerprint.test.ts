// @vitest-environment node
// «Hay una versión nueva» is the files no longer being the ones that were installed (spec local
// 2026-11-26-apps-en-el-escritorio, §4.4): a fingerprint kept in the row at install, compared with the current one.
import { describe, expect, it } from "vitest";

import { filesFingerprint } from "./fingerprint";

const HTML = '<div id="root"></div><script type="module" src="/src/main.jsx"></script>';
const FILES = { "/src/main.jsx": "import './App'", "/src/App.jsx": "export default () => 1", "/src/style.css": "body{margin:0}" };

describe("filesFingerprint", () => {
  it("same files same fingerprint regardless of key order", () => {
    const reversed = Object.fromEntries(Object.entries(FILES).reverse());
    expect(Object.keys(reversed)).not.toEqual(Object.keys(FILES));
    expect(filesFingerprint(HTML, reversed)).toBe(filesFingerprint(HTML, FILES));
    expect(filesFingerprint(HTML, FILES)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a changed source changes it", () => {
    const before = filesFingerprint(HTML, FILES);
    expect(filesFingerprint(HTML, { ...FILES, "/src/App.jsx": "export default () => 2" })).not.toBe(before);
    // A new file, a removed one and a renamed one are changes too.
    expect(filesFingerprint(HTML, { ...FILES, "/src/extra.jsx": "x" })).not.toBe(before);
    const { "/src/style.css": _removed, ...without } = FILES;
    expect(filesFingerprint(HTML, without)).not.toBe(before);
    expect(filesFingerprint(HTML, { ...without, "/src/other.css": FILES["/src/style.css"] })).not.toBe(before);
  });

  it("the shell counts: a changed index.html shell changes it", () => {
    expect(filesFingerprint(`${HTML}<!-- v2 -->`, FILES)).not.toBe(filesFingerprint(HTML, FILES));
  });

  // The rule is `isCompileInputPath`: what the release is built from. A test, Len's manual, the migrations and Len's
  // artifacts are never in it, so editing them is not «a new version».
  it("a file that is not a compile input (tests, LEN.md, migrations, artifacts) does not", () => {
    const before = filesFingerprint(HTML, FILES);
    const noise = {
      "/tests/App.test.tsx": "expect(1).toBe(1)",
      "/LEN.md": "# notes",
      "/supabase/migrations/001.sql": "select 1",
      "/.artifacts/report/index.html": "<p>hi</p>",
    };
    expect(filesFingerprint(HTML, { ...FILES, ...noise })).toBe(before);
    expect(filesFingerprint(HTML, { ...FILES, ...noise, "/LEN.md": "# other notes" })).toBe(before);
  });

  // An image of the folder ships in the release (`ficherosDeLaApp` serves what isn't a source as it is), so a changed
  // image IS a new version: the rule keeps it in. The editor-only files above are the ones left out.
  it("a file the release serves as it is (an image pointer) counts", () => {
    const before = filesFingerprint(HTML, { ...FILES, "/img/logo.webp": "pointer-1" });
    expect(filesFingerprint(HTML, { ...FILES, "/img/logo.webp": "pointer-2" })).not.toBe(before);
  });

  it("the package.json and the esm lock count: they say where each package comes from", () => {
    const before = filesFingerprint(HTML, FILES);
    expect(filesFingerprint(HTML, { ...FILES, "/package.json": "{}" })).not.toBe(before);
    expect(filesFingerprint(HTML, { ...FILES, "/.openlen/esm-lock.json": "{}" })).not.toBe(before);
  });

  it("a path and a content never run together into another pair", () => {
    expect(filesFingerprint(HTML, { "/a.js": "b", "/c.js": "" })).not.toBe(filesFingerprint(HTML, { "/a.js": "", "/b.js": "c.js" }));
  });
});
