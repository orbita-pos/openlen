# Task 2 Report: Fireworks Tool Transport and Transactional Creative Sandbox

## Scope completed

- Added a separate OpenAI-compatible Fireworks tool client for the approved
  DeepSeek V4 reasoner. It sends the four creative tool definitions with
  `tool_choice: "auto"`, high/interleaved reasoning, temperature `0.2`, one
  reservation, one fetch, one settlement, and no retry or `response_format`.
- Added strict tool-turn envelope, finish-reason, usage, call-ID, tool-name,
  and tool-specific argument validation. Invalid calls return only typed,
  redacted failures and never retain arguments or provider bodies.
- Added interleaved assistant/tool message contracts so DeepSeek
  `reasoning_content` and prior tool calls are preserved on subsequent turns.
- Added the exact bounded creative patch schema. Unknown top-level explanation
  fields survive parsing; unknown operation kinds and missing load-bearing
  fields fail closed.
- Added an in-memory transactional canvas. It clones and deterministically
  tags the current document, applies bounded operations, then sanitizes, seals,
  and renders before replacing the last-known-good `SafeCreativeCandidate`.
- Added pure URL and PostCSS-based CSS policy. Ordinary anchor, relative,
  HTTP(S), mailto, and tel links survive; credentialed/executable URLs,
  imports, expressions, bindings, executable data URLs, and unvalidated
  external CSS assets are rejected.
- Added SSRF validation only for newly introduced absolute image/srcset URLs.
  Validated image URLs can be reused by CSS within the same transaction.
- Added explicit redacted warnings for removed script, event-handler, and
  iframe/object/embed categories. These failures roll back the full patch.
- Added the new AI test file to the repository's explicit Vitest allowlist.

## Strict-JSON parser experiment

The parent-checkout `jsonCandidates` experiment was reconstructed in this
worktree and retained. Focused tests prove harmless fence/think wrappers are
accepted only when exactly one candidate satisfies the caller's strict schema;
two schema-valid candidates are rejected as ambiguous. The helper retains no
provider bytes. The tool transport decodes tool envelopes directly and never
passes tool-call content through `jsonCandidates`.

## TDD evidence

Initial RED command:

```powershell
npm.cmd test -- lib/ai/fireworks-tool-client.test.ts lib/curate/creative-sandbox-contracts.test.ts lib/curate/creative-sandbox.test.ts lib/ai/fireworks-client.test.ts lib/agent/tools.test.ts lib/html-engine.test.ts
```

Result: failed because the two new sandbox modules did not exist and the old
strict-JSON parser rejected harmless wrapped JSON. The 47 existing Fireworks
tests remained green.

Additional RED/GREEN cycles covered the Vitest allowlist, tool-specific
argument schemas, obfuscated CSS execution, raster data URLs, combined removal
warnings, absolute srcset SSRF checks, text-only link labels, and
same-transaction validated-asset reuse.

## Final verification evidence

Prescribed Vitest command: 4 files passed, 114 tests passed. The repository
intentionally excludes `lib/agent/tools.test.ts` and `lib/html-engine.test.ts`
from Vitest because they use `node:test`; they were also run directly with the
project's tsx/node shim and passed 136/136.

```powershell
npx.cmd --no-install tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/agent/tools.test.ts lib/html-engine.test.ts
npm.cmd run typecheck
git diff --check
```

All three exited 0. No live provider, network fetch, database, storage,
publication, rollout, deploy, or browser-external call was used.

## Non-blocking runner note

The prescribed `npm test -- ...` line cannot collect the two `node:test` files
under this repository's explicit Vitest configuration. Their independent
136-test run is the authoritative regression evidence for those files.
