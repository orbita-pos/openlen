// Preloaded via `tsx --require` in package.json's test:node AND evals:agent
// scripts (see NB
// below the require line for why this file has to exist at all).
//
// "server-only" (node_modules/server-only) only resolves to its harmless
// empty.js under the `react-server` exports condition — the one Next.js sets
// during its own server build. Plain `tsx --test` (test:node's runner) never
// sets that condition, so a bare `require("server-only")` falls through to
// index.js, which throws unconditionally: "This module cannot be imported
// from a Client Component module." lib/conductas-heredadas/validate.ts is a real
// server-only module (node-html-parser needs an actual DOM tree) that
// lib/agent/tools.ts now imports (Task 16) — the import is correct and
// stays; the test runner just needs to tolerate it, same as it already
// tolerates every other server-only module reachable from tools.ts.
//
// vitest.config.ts solved the identical problem with `resolve.alias`: one
// bare specifier repointed at the same empty.js Next would pick, NOT
// `resolve.conditions: ["react-server"]` (which would repoint conditional
// exports for the ENTIRE dependency tree, React included — a much bigger
// blast radius for one marker package). This is that same scoped fix,
// ported to Node's CJS loader since `tsx --test` has no resolve.alias knob.
const Module = require("node:module");
const path = require("node:path");

const EMPTY_SERVER_ONLY = path.join(__dirname, "..", "node_modules", "server-only", "empty.js");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return EMPTY_SERVER_ONLY;
  return originalResolveFilename.call(this, request, ...rest);
};
