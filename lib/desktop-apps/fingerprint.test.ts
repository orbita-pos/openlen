// @vitest-environment node
// «Hay una versión nueva» is the files no longer being the ones that were installed (spec local
// 2026-11-26-apps-en-el-escritorio, §4.4): a fingerprint kept in the row at install, compared with the current one.
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { secretDigest } from "@/lib/functions/secrets";

import { filesFingerprint, secretsStamp, versionFingerprint } from "./fingerprint";

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

  // The rule is what the install READS: `isCompileInputPath` (what the release is built from) and `/supabase/**` (what the
  // gates migrate and deploy). A test, Len's manual and Len's artifacts are in neither, so editing them is not «a new version».
  it("a file that is not an install input (tests, LEN.md, artifacts) does not", () => {
    const before = filesFingerprint(HTML, FILES);
    const noise = {
      "/tests/App.test.tsx": "expect(1).toBe(1)",
      "/LEN.md": "# notes",
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

  // 🔴 The gates read the backend: the functions are bundled from `/supabase/functions/**` and `config.toml`, and the data
  // changes follow the migrations. A desktop-only app has no other way to bring them to production, so a change there is an
  // update even though none of it reaches the release.
  it("a migration-only change is an update", () => {
    const MIGRATION = "/supabase/migrations/20261126000000_init.sql";
    const before = filesFingerprint(HTML, { ...FILES, [MIGRATION]: "create table a (id int);" });
    expect(filesFingerprint(HTML, { ...FILES, [MIGRATION]: "create table a (id int, n int);" })).not.toBe(before);
    expect(filesFingerprint(HTML, { ...FILES, [MIGRATION]: "create table a (id int);", "/supabase/migrations/20261127000000_more.sql": "select 1;" })).not.toBe(before);
    expect(filesFingerprint(HTML, FILES)).not.toBe(before);
  });

  it("a function-only change is an update", () => {
    const FUNCTION = "/supabase/functions/hello/index.ts";
    const before = filesFingerprint(HTML, { ...FILES, [FUNCTION]: "Deno.serve(() => new Response('a'))" });
    expect(filesFingerprint(HTML, { ...FILES, [FUNCTION]: "Deno.serve(() => new Response('b'))" })).not.toBe(before);
    expect(filesFingerprint(HTML, { ...FILES, [FUNCTION]: "Deno.serve(() => new Response('a'))", "/supabase/config.toml": "[functions.hello]\nverify_jwt = false" })).not.toBe(before);
  });

  it("a path and a content never run together into another pair", () => {
    expect(filesFingerprint(HTML, { "/a.js": "b", "/c.js": "" })).not.toBe(filesFingerprint(HTML, { "/a.js": "", "/b.js": "c.js" }));
  });
});

// THE WHOLE VERSION (Claude's `ver` bumps with ANY change to what the installed thing runs): the files, plus what the
// install bakes in or ships besides them — the production public environment (it ends up in the JS) and the function
// secrets of production (the install deploys them). 🔴 A secret's VALUE is never an input: only the name and the digest the
// store already keeps, folded in through an HMAC with the server's secret, so a leaked database cannot be used to guess a weak
// secret offline.
const KEY = "server-secret-for-the-tests";
const SECRET_VALUE = "sk_live_hunter2-this-must-never-be-stored";
const SECRETS = [
  { name: "SENDGRID_API_KEY", digest: secretDigest(SECRET_VALUE) },
  { name: "WEBHOOK_TOKEN", digest: secretDigest("whsec_abc") },
];
const ENV = { VITE_API_BASE: "https://api.example.com", VITE_FLAG: "1" };
const inputs = (over: Partial<Parameters<typeof versionFingerprint>[0]> = {}): Parameters<typeof versionFingerprint>[0] => ({
  html: HTML,
  files: FILES,
  env: ENV,
  secrets: SECRETS,
  key: KEY,
  ...over,
});

describe("versionFingerprint", () => {
  it("is a hex digest, stable, and independent of the order of the environment and of the secrets", () => {
    const before = versionFingerprint(inputs());
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    expect(versionFingerprint(inputs({ env: Object.fromEntries(Object.entries(ENV).reverse()), secrets: [...SECRETS].reverse() }))).toBe(before);
  });

  it("the files count, as they always did", () => {
    const before = versionFingerprint(inputs());
    expect(versionFingerprint(inputs({ files: { ...FILES, "/src/App.jsx": "export default () => 2" } }))).not.toBe(before);
    expect(versionFingerprint(inputs({ html: `${HTML}<!-- v2 -->` }))).not.toBe(before);
    expect(versionFingerprint(inputs({ files: { ...FILES, "/LEN.md": "# notes" } }))).toBe(before);
  });

  it("an environment-only change is a new version: a changed, added or removed variable", () => {
    const before = versionFingerprint(inputs());
    expect(versionFingerprint(inputs({ env: { ...ENV, VITE_FLAG: "2" } }))).not.toBe(before);
    expect(versionFingerprint(inputs({ env: { ...ENV, VITE_EXTRA: "x" } }))).not.toBe(before);
    expect(versionFingerprint(inputs({ env: { VITE_API_BASE: ENV.VITE_API_BASE } }))).not.toBe(before);
    // A name and a value never run together into another pair.
    expect(versionFingerprint(inputs({ env: { A: "b", C: "" } }))).not.toBe(versionFingerprint(inputs({ env: { A: "", B: "c" } })));
  });

  it("a secret-only change is a new version: a changed value, an added secret and a removed one", () => {
    const before = versionFingerprint(inputs());
    expect(versionFingerprint(inputs({ secrets: [{ name: "SENDGRID_API_KEY", digest: secretDigest("another value") }, SECRETS[1]!] }))).not.toBe(before);
    expect(versionFingerprint(inputs({ secrets: [...SECRETS, { name: "NEW_SECRET", digest: secretDigest("x") }] }))).not.toBe(before);
    expect(versionFingerprint(inputs({ secrets: [SECRETS[0]!] }))).not.toBe(before);
    expect(versionFingerprint(inputs({ secrets: [] }))).not.toBe(before);
    // The same value under another name is another secret.
    expect(versionFingerprint(inputs({ secrets: [{ name: "OTHER_NAME", digest: SECRETS[0]!.digest }, SECRETS[1]!] }))).not.toBe(before);
  });

  it("a secret saved again with the same value is NOT a new version (the digest is what moves, not the save)", () => {
    expect(versionFingerprint(inputs({ secrets: SECRETS.map((s) => ({ ...s })) }))).toBe(versionFingerprint(inputs()));
  });

  it("🔴 the fingerprint never contains a secret value (nor its plain digest)", () => {
    const fingerprint = versionFingerprint(inputs());
    expect(fingerprint).not.toContain(SECRET_VALUE);
    for (const s of SECRETS) expect(fingerprint).not.toContain(s.digest);
    const stamp = secretsStamp(SECRETS, KEY);
    expect(stamp).not.toContain(SECRET_VALUE);
    for (const s of SECRETS) expect(stamp).not.toContain(s.digest);
  });

  it("🔴 the secrets are folded in with the server's secret: without it the fingerprint cannot be reproduced", () => {
    expect(versionFingerprint(inputs({ key: "another-server-secret" }))).not.toBe(versionFingerprint(inputs()));
    expect(secretsStamp(SECRETS, "another-server-secret")).not.toBe(secretsStamp(SECRETS, KEY));
    // Not a plain hash of what is known: the digest, the name, or both, whichever way they are joined.
    const plain = (s: string) => createHash("sha256").update(s).digest("hex");
    const stamp = secretsStamp(SECRETS, KEY);
    for (const s of SECRETS) for (const candidate of [s.digest, s.name, `${s.name}\0${s.digest}`, `${s.name}${s.digest}`, `${s.name}:${s.digest}`]) expect(stamp).not.toBe(plain(candidate));
  });
});
