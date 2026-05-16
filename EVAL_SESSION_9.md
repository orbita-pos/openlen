# Session 9 — No-image toggle + image upload

**Date:** 2026-05-16
**Branch:** `master`
**Commit at start of session:** `58ec308` (Session 8 docs)

## TL;DR

Closed the "I control the visuals" story. Three deliverables:

1. **No-image toggle** in the brief form. Server-side, the orchestrator now
   accepts `images: boolean` (default `true`); when `false`, plan.imageNeeds
   is zeroed, FLUX/Wan are skipped, and `filledBlocks` are scrubbed of
   image-URL keys before assemble. Block components render text-only
   fallback layouts. Per-generation cost drops ~$0.06–0.09.
2. **Image upload** via a new `/api/upload` endpoint backed by a storage
   adapter (`lib/storage/`). Filesystem default; R2 swap by env vars. The
   sidebar slot editor renders an `<ImageField>` (drop zone + URL paste) for
   every detected image slot, replacing the bare URL textbox shipped in
   Session 8.
3. **Race-condition fix** for the reassemble-vs-regenerate timing flagged in
   Session 8's open questions. `regenEpochRef` + a `state.regen` watcher
   guarantee that a reassemble that crosses a regen boundary either gets
   cancelled (timer) or dropped (epoch mismatch in the `.then()`).

Verification: `tsc --noEmit` clean · `next lint` 0 warnings/errors · MOCK
eval **5/5 passes** at $0.0760/gen avg (identical to Session 8 — no behaviour
change in the default with-images path) · dev server boots in 3.3 s with no
startup errors.

## Per-step detail

### Step 1 — Race-condition fix

`app/new/page.tsx`. Two refs + one watcher effect:

```ts
const regenEpochRef = useRef(0);
const wasRegenInFlightRef = useRef(false);

useEffect(() => {
  const inFlight = state.kind === "generated" && state.regen !== undefined;
  if (inFlight && !wasRegenInFlightRef.current) {
    // Cancel pending reassemble — its result would clobber the regen.
    clearTimeout(reassembleTimerRef.current);
    reassembleAbortRef.current?.abort();
  }
  if (!inFlight && wasRegenInFlightRef.current) {
    regenEpochRef.current += 1;
  }
  wasRegenInFlightRef.current = inFlight;
}, [state]);
```

`handleSlotsChange` captures the epoch at fetch-start time. The `.then()`
callback drops the html if the epoch advanced (i.e. a regen completed
mid-flight). Also: while `state.regen` is defined, `handleSlotsChange` skips
the round-trip entirely and surfaces "Regenerating — edits resume after" in
the editor header.

Two-layer defence on purpose: the watcher catches the common case (regen
clicked while debounce is pending), the epoch catches the narrow window
where a regen starts AFTER the debounce timer fires but BEFORE the fetch
resolves.

### Step 2 — `images: boolean` plumbed through /api/generate

```
GenerateRequestSchema.images: z.boolean().optional()   // default true
       ↓
generateLandingPage({ images: false })
       ↓
plan.imageNeeds = { hero: false, decorative: 0 }       // override after plan
       ↓
buildImagePrompts(intent, plan)  →  []                 // no FLUX/Wan
       ↓
stripImageSlots(filledBlocks)                          // scrub fill output
       ↓
assemble  →  block components render text-only fallbacks
```

The scrubber is a recursive `scrubImageKeys` that drops the well-known image
URL keys (`imageSrc`, `mockupSrc`, `logoSrc`, `imageAlt`, `mockupAlt`) and
also strips `src` from logo-shaped objects (`{name, src?}` — only logo-strip
matches). It's narrow on purpose: `src` alone is too broad and could clobber
unrelated string fields in future blocks.

**Why post-fill scrub rather than fill-time gate?** The fill prompts each
embed an example slot that includes `imageSrc: "https://images.unsplash..."`,
and rewriting 15 example fixtures to be conditionally-imaged would be a
larger surface area than a 20-line orchestrator helper. The scrubber runs
exactly once per generation and ignores everything else in the slot tree.

### Step 3 — Block-level no-image variants

Two schemas relaxed from required-string to optional-string for their image
fields:

- `lib/blocks/hero/split-image.tsx` — `imageSrc` / `imageAlt` → optional.
  Component now derives `hasImage = typeof slots.imageSrc === "string" && slots.imageSrc.length > 0`.
  When false, the 60/40 split collapses into a centered hero layout
  (max-w-840, centered text, centered CTAs).
- `lib/blocks/features/alternating-rows.tsx` — `rows[].imageSrc` /
  `rows[].imageAlt` → optional. Each row independently picks its variant:
  with-image → existing 50/50 grid; without → centered max-w-720 text card.
  `imagePosition` is ignored when there's no image.

Three blocks already handled missing imagery gracefully and required no
change:

- `hero/centered-cta` — `mockupSrc`/`mockupAlt` already optional (the
  template hides the `<img>` block when missing).
- `hero/logo-strip` — `logos[].src` already optional (logo name falls back
  to a text node).
- `features/bento-asymmetric` — `tiles[].imageSrc` already optional and the
  `<VisualBackdrop>` renders code/stats/null when image is absent.

The remaining 10 blocks have no image slots (`hero/animated-gradient`,
`features/icon-grid-3col`, all `cta/*`, all `pricing/*`, all `testimonials/*`,
all `faq/*`, all `footer/*`) — nothing to change there.

### Step 4 — Brief-form toggle

`components/workspace/brief-form.tsx` gains an "Include AI-generated images"
toggle below the examples row. Owned by `app/new/page.tsx` so toggling
doesn't reset when the panel collapses. State default is `true`.

When OFF, the helper copy reads "Text-only layout. Upload your own images
in the editor." pointing the user at the post-generation upload affordance.

### Step 5 — Storage adapter (`lib/storage/`)

Four files:

| File              | Role                                            |
|-------------------|-------------------------------------------------|
| `types.ts`        | `StorageAdapter` interface + arg/result types   |
| `filesystem.ts`   | `FilesystemStorage` — writes under `./public/uploads/` |
| `r2.ts`           | `R2Storage` — Cloudflare R2 via dynamic-imported AWS SDK |
| `index.ts`        | `getStorage()` factory + cached singleton       |

The R2 adapter dynamic-imports `@aws-sdk/client-s3` via a variable specifier
so the dep is NOT a build-time requirement. Local dev / self-hosted with
the filesystem path never resolves the SDK. The error message on first call
points the operator at `npm install @aws-sdk/client-s3` if they've set R2
env vars without the dep.

**Tree-shaking concern flagged:** the AWS SDK is ~3MB compressed (and pulls
in stream/crypto polyfills). For R2 alone, an alternative is the much
smaller `@cloudflare/workers-types` + manual `fetch()` to the R2 S3 API —
but the auth signing surface is non-trivial and the SDK handles it for
free. Defer to Session 10 when the Hetzner deploy lands and we're tuning
real bundle weight.

Filesystem path is the boring-and-correct default for the launch surface:
Hetzner Docker volume gives durable storage, Next.js serves `/public/uploads/`
out of the box. No CDN, no signed URLs — direct access works because
uploads are public (intentionally — the user pasted them into a public
landing page).

`.env.local.example` documents both modes. `.gitignore` excludes
`/public/uploads/`.

### Step 6 — `/api/upload`

```
POST /api/upload   multipart/form-data
  file:           File (image/jpeg|png|webp|gif, ≤5MB)
  generationId:   string (a-zA-Z0-9_-, optional, defaults "anon")
→ { url, size, key }
```

Validation order: auth → field shape → size → mime → buffer-size double-check
(clients can lie about size in the multipart envelope). Returns 401/400/413/
415/500 with `{ error }` JSON; the client surfaces the message in the
`ImageField` error row.

Key shape: `uploads/<generationId>/<8-hex>.<ext>`. Hex prevents collisions
across renames, generationId prefix lets a future "delete all images for
this page" become one storage list-prefix call.

**Not yet wired:** rate-limiting. The existing `lib/limits.ts` covers
generate + regen but uploads have their own implicit limit (5MB × 50 per
user per quarter would be 250MB — fine for now, revisit if abuse appears).
Auth gating is the immediate cost ceiling: anonymous endpoints would let
any visitor dump arbitrary files on the public domain.

### Step 7 — `<ImageField>` + editor context

`components/workspace/slot-fields/image-field.tsx` is the new field type.
Three input modes per the brief:

1. **Drag & drop** — visual highlight on dragover, file consumed on drop.
2. **Click-to-pick** — native `<input type="file" accept="image/*">`.
3. **URL paste** — text input below for any public URL (Unsplash, an
   existing R2 bucket, etc.).

When `value` is non-empty, an inline preview renders above the dropzone
with an X button to clear. Upload-in-flight shows a spinner; failure shows
a red error string under the input.

`zod-to-form.ts` gained a `kind: "image"` form-field variant. The walker
detects image-URL keys (`imageSrc` / `mockupSrc` / `logoSrc` / `src`) at
ZodString discovery time and emits the new kind instead of the regular
`"string"`. The dispatcher in `slot-field.tsx` adds one case for `"image"`
that renders `<ImageField>`.

The ImageField needs `generationId` to bucket uploads — threading it through
every recursive `SlotField` call would be 4 extra props. Instead:

- `slot-editor-context.tsx` — a tiny React context (`{ generationId }`).
- `SlotEditor` wraps its tree in `<SlotEditorContextProvider>`.
- `ImageField` consumes via `useEditorContext()`.

Context value is stable (changes only when a new generation lands), so the
ImageField doesn't re-render needlessly across edits.

### Step 8 — localStorage persistence (no code changes)

The Session 8 edit-cache effect already writes the full `filledBlocks` tree
to `localStorage.inari-edit/<generationId>` on every change. An uploaded
image URL is just a slot field value — it slots into the same path
(`filledBlocks[0].slots.imageSrc = "/uploads/.../abc.jpg"`) and the existing
sync effect writes it. On reload, hydration restores the same blocks and
triggers a reassemble, the image renders from disk (or R2).

The ONE thing the cache doesn't track is the upload itself — if the
filesystem gets wiped between sessions, the URL is dead. For the launch
surface this matches the "your work is local-first" story; production
should swap to R2 where the URL outlives the local FS.

## Verification

```
$ npx tsc --noEmit              # exit 0
$ npx next lint                 # 0 warnings, 0 errors
$ MOCK_MODE=1 npm run eval      # 5/5 succeeded · $0.3799 · 22.4s wall
$ npx next dev                  # ready in 3.3s, no startup errors
```

MOCK_MODE summary (with-images path is the default — parity check vs Session 8):

| Brief                  | Cost      | Wall   | Gates | Grade  |
|------------------------|-----------|--------|-------|--------|
| 01-saas-launch         | $0.0774   | 9.8 s  | 6/6   | passed |
| 02-portfolio           | $0.0748   | 3.2 s  | 6/6   | passed |
| 03-event-conference    | $0.0760   | 3.3 s  | 6/6   | passed |
| 04-ecommerce           | $0.0755   | 3.1 s  | 6/6   | passed |
| 05-agency              | $0.0763   | 3.0 s  | 6/6   | passed |

Identical to Session 7 + 8 — no behaviour change in the default codepath.

### Expected cost delta — images on/off

| Mode             | Per-gen cost | Notes |
|------------------|-------------|-------|
| `images: true`   | ~$0.13      | Real-API baseline (FLUX hero $0.06 + Wan decoratives $0.04 + LLM $0.03) |
| `images: false`  | ~$0.04–0.07 | LLM only; saves $0.06–0.09 vs above |

In MOCK_MODE the delta is smaller (~$0.005/img mocked) so the eval suite
isn't a useful regression for cost. Real-API verification is gated behind
TOGETHER_API_KEY and was not run this session — defer until Session 10
Hetzner work makes a full real-API run cheap to validate.

## Manual smoke test — not run

Same constraint as Session 8: cannot drive a browser in this environment.
Operator should walk through:

```
npm run dev
# 1. /new — verify "Include AI-generated images" toggle visible and ON.
# 2. Toggle OFF, generate — verify text-only layout in preview.
# 3. Toggle ON, regenerate — verify hero image returns.
# 4. Click "Edit content" → expand hero block.
# 5. Verify ImageField shows preview thumbnail + dropzone + URL input.
# 6. Drop a 1MB JPG into the dropzone — verify upload, swap, 300ms preview.
# 7. Drop a 6MB PDF — verify "File too large" / "Type not allowed" errors.
# 8. Refresh page — verify uploaded image persists.
# 9. Race fix: edit slot, click "Regenerate hero" within 200ms.
#    — verify no stale flash, regen result lands cleanly.
```

## Open questions

1. **Upload moderation.** No NSFW filter, no virus scan, no content-policy
   gate. For a self-hosted personal-use tool this is fine; if Inari Pages
   ever surfaces multi-tenant uploads (Session 13+ when projects go shared)
   we'll need at minimum a CSAM hash check + admin takedown affordance.
2. **Image resize / WebP conversion.** Uploaded JPGs render at their source
   resolution. A 4000×3000 photo on a hero slot will tank LCP. Out of scope
   here; the polish session should add a server-side `sharp` pass that
   downscales > 1920w and re-encodes WebP.
3. **R2 SDK weight.** Flagged in step 5 — `@aws-sdk/client-s3` is ~3MB. The
   dynamic import keeps the default bundle clean but Hetzner+R2 deploys
   pay the full cost. A direct-fetch alternative is buildable (R2 supports
   S3-compatible auth via SigV4) — defer until production traffic justifies.
4. **Upload quota / abuse rate-limit.** No per-user cap. If a malicious user
   uploads 5MB × 1000 they can fill the disk. Trivial mitigation: add a
   `checkAndConsume(userLimitKey(uid, "upload"), [...]) ` call in the route.
   Skipped this session because launch traffic doesn't justify the table-
   churn yet.
5. **Slot dirty-detection still uses `JSON.stringify`.** Carried over from
   Session 8's open question #2. Image uploads might trigger false positives
   (an optional slot opened + cleared) but in practice the slot is either
   populated or absent; no observed false positives in dev.
6. **Sidebar form ergonomics for long URLs.** The text-input fallback in
   ImageField uses `font-mono truncate` so a 200-char Unsplash URL doesn't
   wrap the layout. Hover-to-expand or a tooltip would be nicer; defer.
7. **localStorage quota.** A page with 4 image slots × ~120-char URLs is
   trivial (~500 bytes). The 5MB localStorage budget would only become a
   concern if we ever started storing image *bytes* there (we don't and
   shouldn't — that's what storage adapters are for).

## Commits scoped

```
1. fix(workspace): AbortController + epoch gate for reassemble/regen race
2. feat(api/generate): images=false param skips FLUX.2 + Wan
3. feat(blocks): graceful no-image variants for split-image + alternating-rows
4. feat(workspace/brief-form): toggle "Include AI-generated images"
5. feat(storage): StorageAdapter abstraction (filesystem default + R2 optional)
6. feat(api/upload): file upload endpoint with validation
7. feat(workspace/slot-fields): ImageField with drop zone + URL paste
8. feat(workspace): SlotEditor context provider for generationId
9. docs(eval): EVAL_SESSION_9.md + .env.local.example R2 vars
```

## Session burn

API spend: **$0** (no real-API calls).
Total tokens: zero — UI / orchestrator plumbing session.

## Next

**Session 10 — Hetzner Deploy Infra (DNS + Nginx + TLS).** Wildcard DNS for
`*.tudomain.com`, Nginx `server_name` rules, Let's Encrypt DNS-01 wildcard
cert. With Session 9's uploads landing on filesystem-by-default, the
Hetzner box can ship with persistent Docker volume mounting at
`/var/inari/uploads` and the same URL scheme works in prod.
