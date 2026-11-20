// Generates crates/edge/tests/fixtures/ab/evaluate.json — shared by the Rust and TS evaluators.
// Run from the repo root:  node crates/edge/tests/fixtures/ab/gen-evaluate.cjs
const { createHash } = require("node:crypto");
const fs = require("node:fs");

const SALT = "3f9a1c8e7b2d4012";
const ID = "ab_9f3c2a1b";
const bucket = (ip, ua, lang, salt = SALT, id = ID) =>
  createHash("sha256").update(`${salt}:${id}:${ip}:${ua}:${lang}`, "utf8").digest().readUInt32BE(0) % 10000;
const variantOf = (ip, ua, lang, split = 5000) => (bucket(ip, ua, lang) < split ? "b" : "a");

const exp = (over = {}) => ({
  id: ID,
  cookieName: "ol_ab_9f3c2a1b",
  targetPath: "/",
  includeLocales: true,
  locales: ["es", "fr"],
  splitBps: 5000,
  salt: SALT,
  prefixB: "openlen/ab/ab_9f3c2a1b/b",
  overrideParam: "_ol_ab",
  expiresAt: null,
  ...over,
});
const manifest = (experiments, extra = {}) => ({
  version: 1,
  releaseSha: "abc123456789",
  overrides: ["/css/site.css", "/img/hero.png", "js/app.js", "/fonts/a b.woff2"],
  experiments,
  ...extra,
});

const CHROME = "Mozilla/5.0 Chrome/131.0";
const LANG = "es-MX,es;q=0.9";
const B_IP = "203.0.113.10"; // bucket 4692 -> B at 5000
const A_IP = "198.51.100.42"; // with Safari/en-US below: bucket 8330 -> A
const SAFARI = "Mozilla/5.0 Safari/605.1";
const EN = "en-US,en;q=0.9";
const NOW = Date.parse("2026-06-01T00:00:00Z");

if (variantOf(B_IP, CHROME, LANG) !== "b" || variantOf(A_IP, SAFARI, EN) !== "a") throw new Error("vectors drifted");

const req = (over = {}) => ({
  path: "/",
  query: "",
  cookie: null,
  ua: CHROME,
  lang: LANG,
  ip: B_IP,
  secure: true,
  nowMs: NOW,
  ...over,
});
const COOKIE_B = "ol_ab_9f3c2a1b=b";
const SET_B = "ol_ab_9f3c2a1b=b; Path=/; Max-Age=2592000; SameSite=Lax; Secure";
const SET_A = "ol_ab_9f3c2a1b=a; Path=/; Max-Age=2592000; SameSite=Lax; Secure";
const B_HOME = "/openlen/ab/ab_9f3c2a1b/b/index.html";

const page = (variant, source, extra = {}) => ({
  experimentId: ID,
  variant,
  source,
  isPageRoute: true,
  isOverride: source === "override",
  ...extra,
});
const asset = (variant, source, variantBPath) => ({
  experimentId: ID,
  variant,
  source,
  isPageRoute: false,
  isOverride: source === "override",
  variantBPath,
  setCookie: null,
});

const M = manifest([exp()]);
const cases = [];
const add = (name, m, request, expect) => cases.push({ name, manifest: m, request, expect });

// ── pages: assignment, stickiness, bots, override ──
add("first visit lands in B by hash and mints a Secure cookie", M, req(), page("b", "hash", { variantBPath: B_HOME, setCookie: SET_B }));
add("first visit lands in A by hash", M, req({ ip: A_IP, ua: SAFARI, lang: EN }), page("a", "hash", { variantBPath: null, setCookie: SET_A }));
add("a plain-http request mints the cookie without Secure", M, req({ secure: false }), page("b", "hash", { setCookie: "ol_ab_9f3c2a1b=b; Path=/; Max-Age=2592000; SameSite=Lax" }));
add("sticky cookie b wins over the hash", M, req({ ip: A_IP, ua: SAFARI, lang: EN, cookie: "foo=1; " + COOKIE_B }), page("b", "cookie", { variantBPath: B_HOME, setCookie: null }));
add("sticky cookie a wins over the hash", M, req({ cookie: "ol_ab_9f3c2a1b=a" }), page("a", "cookie", { variantBPath: null, setCookie: null }));
add("the cookie value is case-insensitive", M, req({ ip: A_IP, ua: SAFARI, lang: EN, cookie: "ol_ab_9f3c2a1b=B" }), page("b", "cookie"));
add("a cookie with another value is ignored", M, req({ cookie: "ol_ab_9f3c2a1b=zzz" }), page("b", "hash"));
add("the first cookie of that name wins", M, req({ cookie: "ol_ab_9f3c2a1b=a; ol_ab_9f3c2a1b=b" }), page("a", "cookie"));
add("a bot gets control and no cookie", M, req({ ua: "Googlebot/2.1" }), page("a", "bot", { variantBPath: null, setCookie: null }));
add("an empty user agent is a bot", M, req({ ua: "" }), page("a", "bot"));
add("override b beats the bot and the cookie, mints nothing", M, req({ query: "_ol_ab=b", cookie: "ol_ab_9f3c2a1b=a", ua: "Googlebot/2.1" }), page("b", "override", { variantBPath: B_HOME, setCookie: null }));
add("override is case-insensitive", M, req({ query: "_ol_ab=A", ip: B_IP }), page("a", "override", { variantBPath: null }));
add("an unknown override value is ignored", M, req({ query: "_ol_ab=x", cookie: "ol_ab_9f3c2a1b=a" }), page("a", "cookie"));
add("the override key is percent-decoded", M, req({ query: "_ol_%61b=b" }), page("b", "override"));
add("the override value is percent-decoded", M, req({ query: "x=1&_ol_ab=%62" }), page("b", "override"));
add("a plus in the value is a space, so not an override", M, req({ query: "_ol_ab=+b", cookie: "ol_ab_9f3c2a1b=a" }), page("a", "cookie"));
add("the first occurrence of the parameter wins (a bare key is an empty value)", M, req({ query: "_ol_ab&_ol_ab=b", cookie: "ol_ab_9f3c2a1b=a" }), page("a", "cookie"));
add("a custom override parameter name", manifest([exp({ overrideParam: "preview_ab" })]), req({ query: "preview_ab=b&_ol_ab=a" }), page("b", "override"));
add("an invalid override parameter name falls back to the default", manifest([exp({ overrideParam: "x" })]), req({ query: "_ol_ab=b" }), page("b", "override"));

// ── which pages an experiment covers ──
add("a locale of the target is covered", M, req({ path: "/es" }), page("b", "hash", { variantBPath: "/openlen/ab/ab_9f3c2a1b/b/es" }));
add("a trailing slash is the same page", M, req({ path: "/es/" }), page("b", "hash", { variantBPath: "/openlen/ab/ab_9f3c2a1b/b/es" }));
add("index.html is the home", M, req({ path: "/index.html" }), page("b", "hash", { variantBPath: B_HOME }));
add("a percent-encoded path is judged decoded", M, req({ path: "/%65s" }), page("b", "hash", { variantBPath: "/openlen/ab/ab_9f3c2a1b/b/es" }));
add("dot segments are removed before judging", M, req({ path: "/x/../es" }), page("b", "hash", { variantBPath: "/openlen/ab/ab_9f3c2a1b/b/es" }));
add("a locale that is not listed is outside", M, req({ path: "/de" }), null);
add("another page is outside", M, req({ path: "/about" }), null);
add("a nested page is outside when only the home is the target", M, req({ path: "/es/about" }), null);
add("a non-home target", manifest([exp({ targetPath: "/pricing/", includeLocales: false })]), req({ path: "/pricing/index.html" }), page("b", "hash", { variantBPath: "/openlen/ab/ab_9f3c2a1b/b/pricing" }));
add("the home is outside a non-home target", manifest([exp({ targetPath: "/pricing", includeLocales: false })]), req(), null);
add("locales are lower-cased and filtered in the manifest", manifest([exp({ locales: ["ES", "bad_locale", 7, "fr-CA"] })]), req({ path: "/fr-ca" }), page("b", "hash", { variantBPath: "/openlen/ab/ab_9f3c2a1b/b/fr-ca" }));
add("includeLocales that is not literally true counts as false", manifest([exp({ includeLocales: "yes" })]), req({ path: "/es" }), null);

// ── files: only the manifest's `overrides` are decided, for every visitor ──
add("an overridden file goes to B for a B cookie", M, req({ path: "/css/site.css", cookie: COOKIE_B }), asset("b", "cookie", "/openlen/ab/ab_9f3c2a1b/b/css/site.css"));
add("an overridden file is control (decided, so no-store) for everyone else", M, req({ path: "/css/site.css" }), asset("a", "cookie", null));
add("the override parameter sends a file to B", M, req({ path: "/css/site.css", query: "_ol_ab=b" }), asset("b", "override", "/openlen/ab/ab_9f3c2a1b/b/css/site.css"));
add("override a beats a B cookie on a file", M, req({ path: "/css/site.css", cookie: COOKIE_B, query: "_ol_ab=a" }), asset("a", "override", null));
add("an unknown override value on a file falls back to the cookie", M, req({ path: "/css/site.css", cookie: COOKIE_B, query: "_ol_ab=x" }), asset("b", "cookie", "/openlen/ab/ab_9f3c2a1b/b/css/site.css"));
add("an entry without a leading slash is normalized", M, req({ path: "/js/app.js", cookie: COOKIE_B }), asset("b", "cookie", "/openlen/ab/ab_9f3c2a1b/b/js/app.js"));
add("a file that B does not override is not decided", M, req({ path: "/css/other.css", cookie: COOKIE_B }), null);
add("a file with a space in its name", M, req({ path: "/fonts/a%20b.woff2", cookie: COOKIE_B }), asset("b", "cookie", "/openlen/ab/ab_9f3c2a1b/b/fonts/a b.woff2"));
add("file paths are case-sensitive", M, req({ path: "/CSS/site.css", cookie: COOKIE_B }), null);
add("a file under a dot directory is a file", M, req({ path: "/.well-known/security.txt", cookie: COOKIE_B }), null);
add("a dotfile named as the target is a file, never a page", manifest([exp({ targetPath: "/.hidden", includeLocales: false })]), req({ path: "/.hidden" }), null);
add("a dot directory with a clean last segment is a page", manifest([exp({ targetPath: "/.well-known/x", includeLocales: false })]), req({ path: "/.well-known/x" }), page("b", "hash", { variantBPath: "/openlen/ab/ab_9f3c2a1b/b/.well-known/x" }));
add("a bare dotfile is a file, never a page", M, req({ path: "/.hidden" }), null);
add("a path ending in a dot is a file", M, req({ path: "/foo." }), null);
add("an unknown extension is a file", M, req({ path: "/data.v2" }), null);
add("a dotted directory with a clean last segment is a page (outside the target)", M, req({ path: "/v1.2/pricing" }), null);
add("an overridden file of an expired experiment is not decided", manifest([exp({ expiresAt: "2026-01-01T00:00:00Z" })]), req({ path: "/css/site.css", cookie: COOKIE_B }), null);
add("a manifest with no overrides decides no file", manifest([exp()], { overrides: undefined }), req({ path: "/css/site.css", cookie: COOKIE_B }), null);
add("junk overrides are dropped, the rest kept", manifest([exp()], { overrides: [7, null, "/../etc/passwd", "/a/./b.css", "/css/site.css", { x: 1 }] }), req({ path: "/css/site.css", cookie: COOKIE_B }), asset("b", "cookie", "/openlen/ab/ab_9f3c2a1b/b/css/site.css"));

// ── expiresAt: only a full RFC 3339 timestamp counts ──
const withExpiry = (v) => manifest([exp({ expiresAt: v })]);
add("expiresAt in the past ends the experiment", withExpiry("2026-01-01T00:00:00Z"), req(), null);
add("expiresAt in the future keeps it", withExpiry("2026-12-31T23:59:59Z"), req(), page("b", "hash"));
add("expiresAt with a positive offset is shifted (still in the future)", withExpiry("2026-06-01T01:00:00+02:00"), req({ nowMs: Date.parse("2026-05-31T22:30:00Z") }), page("b", "hash"));
add("expiresAt with a positive offset is shifted (just passed)", withExpiry("2026-06-01T01:00:00+02:00"), req({ nowMs: Date.parse("2026-05-31T23:00:00Z") }), null);
add("expiresAt with a negative offset", withExpiry("2026-05-31T20:00:00-04:00"), req({ nowMs: Date.parse("2026-05-31T23:59:59Z") }), page("b", "hash"));
add("expiresAt is a boundary: now >= expiresAt ends it", withExpiry("2026-06-01T00:00:00Z"), req(), null);
add("expiresAt with fractional seconds", withExpiry("2026-06-01T00:00:00.500Z"), req(), page("b", "hash"));
add("a bare date is invalid: the experiment is ignored", withExpiry("2027-01-01"), req(), null);
add("lower-case t/z is invalid: the experiment is ignored", withExpiry("2027-01-01t00:00:00z"), req(), null);
add("a space instead of T is invalid", withExpiry("2027-01-01 00:00:00Z"), req(), null);
add("a missing zone is invalid", withExpiry("2027-01-01T00:00:00"), req(), null);
add("February 30 is invalid", withExpiry("2027-02-30T00:00:00Z"), req(), null);
add("hour 24 is invalid", withExpiry("2027-01-01T24:00:00Z"), req(), null);
add("second 60 is invalid", withExpiry("2027-01-01T00:00:60Z"), req(), null);
add("an empty string is invalid", withExpiry(""), req(), null);
add("a number is invalid", withExpiry(1893456000000), req(), null);
add("February 29 of a leap year is valid", withExpiry("2028-02-29T00:00:00Z"), req(), page("b", "hash"));
add("February 29 of a common year is invalid", withExpiry("2027-02-29T00:00:00Z"), req(), null);
add("the first experiment expired, the second still runs", manifest([exp({ expiresAt: "2026-01-01T00:00:00Z" }), exp({ id: "ab_22222222", cookieName: "ol_ab_22222222", prefixB: "openlen/ab/ab_22222222/b" })]), req(), {
  experimentId: "ab_22222222",
  variant: bucket(B_IP, CHROME, LANG, SALT, "ab_22222222") < 5000 ? "b" : "a",
  source: "hash",
});

// ── a malformed experiment is skipped, the others are kept ──
const bad = (over) => exp(over);
add("a splitBps that is not a number skips that experiment only", manifest([bad({ splitBps: "50" }), exp()]), req(), page("b", "hash"));
add("a fractional splitBps skips that experiment", manifest([bad({ splitBps: 5000.5 }), exp()]), req(), page("b", "hash"));
add("a splitBps over 10000 skips that experiment", manifest([bad({ splitBps: 10001 }), exp()]), req(), page("b", "hash"));
add("a negative splitBps skips that experiment", manifest([bad({ splitBps: -1 }), exp()]), req(), page("b", "hash"));
add("a missing salt skips that experiment", manifest([{ ...exp(), salt: undefined }, exp()]), req(), page("b", "hash"));
add("an oversized salt skips that experiment", manifest([bad({ salt: "x".repeat(129) }), exp()]), req(), page("b", "hash"));
add("a bad id skips that experiment", manifest([bad({ id: "AB" }), exp()]), req(), page("b", "hash"));
add("a bad cookie name skips that experiment", manifest([bad({ cookieName: "no" }), exp()]), req(), page("b", "hash"));
add("a prefix outside openlen/ab/ skips that experiment", manifest([bad({ prefixB: "_ab/ab_9f3c2a1b/b" }), exp()]), req(), page("b", "hash"));
add("a prefix with a dot segment skips that experiment", manifest([bad({ prefixB: "openlen/ab/../b" }), exp()]), req(), page("b", "hash"));
add("an experiment that is not an object is skipped", manifest([7, null, "x", exp()]), req(), page("b", "hash"));
add("a manifest whose only experiment is malformed is no manifest", manifest([bad({ splitBps: "x" })]), req(), null);
add("splitBps 0 sends everyone to A", manifest([exp({ splitBps: 0 })]), req(), page("a", "hash", { setCookie: SET_A }));
add("splitBps 10000 sends everyone to B", manifest([exp({ splitBps: 10000 })]), req({ ip: A_IP, ua: SAFARI, lang: EN }), page("b", "hash", { setCookie: SET_B }));
add("splitBps given as 5000.0 is an integer", { raw: '{"version":1,"experiments":[{"id":"ab_9f3c2a1b","cookieName":"ol_ab_9f3c2a1b","targetPath":"/","splitBps":5000.0,"salt":"3f9a1c8e7b2d4012","prefixB":"openlen/ab/ab_9f3c2a1b/b"}]}' }, req(), page("b", "hash"));
add("a version other than 1 is no manifest", { raw: '{"version":2,"experiments":[]}' }, req(), null);
add("version 1.0 is version 1", { raw: '{"version":1.0,"experiments":[{"id":"ab_9f3c2a1b","cookieName":"ol_ab_9f3c2a1b","targetPath":"/","splitBps":5000,"salt":"3f9a1c8e7b2d4012","prefixB":"openlen/ab/ab_9f3c2a1b/b"}]}' }, req(), page("b", "hash"));
add("not JSON is no manifest", { raw: "not-json" }, req(), null);
add("a JSON array is no manifest", { raw: "[]" }, req(), null);
add("experiments that is not an array is no manifest", { raw: '{"version":1,"experiments":{}}' }, req(), null);

// ── headers that are present but unreadable (non-ASCII) ──
add("a non-ASCII user agent is unreadable, so it is treated as a bot", M, req({ ua: "Mozilla/5.0 (ñandú) Chrome/131" }), page("a", "bot", { setCookie: null }));
add("a non-ASCII cookie is unreadable, so it is ignored", M, req({ cookie: "ol_ab_9f3c2a1b=a; other=ñ" }), page("b", "hash"));
add("a non-ASCII accept-language is hashed as empty", M, req({ lang: "ñ" }), page(variantOf(B_IP, CHROME, ""), "hash"));

fs.writeFileSync(
  "crates/edge/tests/fixtures/ab/evaluate.json",
  JSON.stringify(
    {
      _doc:
        "Shared by crates/edge (assign.rs/manifest.rs tests) and lib/ab/serve.test.ts. manifest is an object (stringified), or {raw}. " +
        "request.path is an already-resolved URL path; query has no leading '?'; ua/lang/cookie are header values (non-ASCII = present but unreadable); nowMs is Unix ms. " +
        "expect is null (no experiment decision, incl. no manifest) or a subset of the decision. Regenerate with gen-evaluate.cjs (node, from the repo root) if the contract changes.",
      cases,
    },
    null,
    2,
  ) + "\n",
);
console.log(cases.length, "cases");
