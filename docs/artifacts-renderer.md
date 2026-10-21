# Artifact renderer operation (Len 3.0 branch, feature disabled by default)

The Next app only saves sources and queues jobs. The standalone worker builds a sealed input with the existing app compiler/bundler, then runs the trusted browser renderer in a separate offline container. Generated source is never evaluated in Node.

Build the image on the Linux host from a minimal context: only the renderer sources and its Dockerfile, never the repository root (which would hand `.env.local` and `node_modules` to Docker):

```sh
tar -c --exclude=node_modules tools/artifact-renderer infra/artifact-renderer/Dockerfile | docker build -f infra/artifact-renderer/Dockerfile -t openlen/artifact-renderer:1 -
```

The worker requires an explicit local image (`OPENLEN_ARTIFACT_RENDERER_IMAGE`); it never pulls images during a job. The per-job runner sets 2 CPUs, 2 GiB RAM/no swap, 512 tasks (processes and threads: Chromium plus x264 peaked at 157 for a 6 s video, and 128 failed every video), a read-only filesystem, no network/capabilities, and a bounded temporary filesystem. It mounts only a fresh output directory, passes the source envelope through stdin, and force-removes its generated container name on cancellation/timeout before removing that directory. No DB URL, provider key, Docker socket or host project directory enters the renderer.

Do not activate `OPENLEN_ARTIFACTS=1` until all format acceptance, pricing, isolated-preview access, recovery and operational checks have passed. This document does not authorize deployment or installation.

Current evidence (2026-10-20): the Linux acceptance below passed on WSL 2 (Ubuntu 24.04, Docker 29.1.3, cgroup v2) with the image built from this branch: every format, the 120 s worst case within the limits, the negative cases with their own codes, and a real cancellation, with no container or temporary directory left behind. It found and fixed four renderer defects that the Windows runs could not show: the 128-task limit broke every video and intermittently Chromium; offscreen slide iframes never painted, so every HTML deck with two or more slides hung until the watchdog; a CSP-blocked or intercepted resource surfaced as an image decode error instead of `artifact_resource_missing`; and an unreadable audio upload surfaced as a generic failure instead of `audio_media_invalid`. It runs on a laptop, not the production host, and makes no provider call.

## Linux acceptance

`scripts/artifact-linux-acceptance.ts` runs the REAL adapters (compile, validation, the PPTX built from the layout Chromium measured, every post-check) with the repository toolchain, and sends each container call through `scripts/artifact-renderer-bridge.ts` — bundled into one `.mjs` and run with plain `node` next to Docker — to the REAL `containerArtifactRenderer`. In production one worker process holds both halves; the bridge (protocol in `lib/artifacts/acceptance/bridge-protocol.ts`) is the only test glue. Inputs are synthetic; the narration case uses a fixture voice (a tone), not OpenAI. Every case must match its expected outcome and leave no container or temporary directory; produced files are checked again with ffprobe/pdfinfo in a separate offline container of the same image.

```sh
npx tsx --require ./scripts/test-node-server-only-shim.cjs scripts/artifact-linux-acceptance.ts --evidence /new/empty/directory
```

Options: `--distro` (default `Ubuntu-24.04`), `--image`, `--node` (a Linux Node 22; by default `node` on the PATH or `~/.local/bin/node`, which can be copied out of the local `node:22-bookworm-slim` image without downloading anything), `--only id,id` and `--skip-long` (skips the 120 s video and the cancellation). It writes `REPORT.md`, `report.json`, every packet sent (`packets/`), every produced file (`outputs/`) and the bundled bridge with its hash (`package/`).

Generate the synthetic fixture (no provider calls or customer data):

```sh
npx tsx --require ./scripts/test-node-server-only-shim.cjs scripts/artifact-dashboard-fixture.ts /explicit/private/test-directory
```

Its packet.json can be passed on stdin to the renderer container. The HTML and CSV are independent local fixtures for browser review. They are not a generation template or proof of the model's tool selection; use Len-Bench/the real brain and recorder for that later acceptance stage.

Current downloads are attachments. No authored HTML is served inline on the authenticated product origin. A separately authorized preview origin remains required before enabling interactive artifact previews.

The preview host must be a separate hostname within the **same site** as the app (for example `app.example.com` and `preview.example.com`). Its HttpOnly viewer cookie uses `SameSite=Strict`; a preview on a different registrable domain is unsupported, even though the current origin parser accepts it. The UI preserves the opaque `sandbox="allow-scripts"` and asks the parent for a fresh single-use grant on preview reload. Do not weaken the sandbox/cookie to enable cross-site previews.

The workspace deliverables bell lists the newest 200 authorized items, groups them by request, and tracks each image independently. It opens the pinned last ready revision during corrections, uses private HTML for dashboards/slides, MP4 for motion, and native audio/image previews. The per-project `/[locale]/projects/[id]/artifacts` page provides server-side title/type/status/date filters and keyset pagination beyond 200 results, using encrypted context-bound cursors and the same private pinned-revision viewer. The bell links to this history. The development-only `/es/dev/artifacts` and `/es/dev/artifacts/history` pages use synthetic metadata/files, creates no jobs and makes no provider calls; it is unavailable in production. UI fixtures do not validate Linux exports or provider quality. The bell mounts only when `GET /api/projects/[id]` reports `artifacts: true` (the server's `OPENLEN_ARTIFACTS`), so a server with the feature off receives no artifact requests; it stops polling while the tab is hidden and catches up when it is visible again. The list, history and event endpoints check access for a whole page at once (`readableArtifacts`, same answers as `requireArtifactAccess`), in a handful of queries rather than three or more per deliverable. A member's paid attempt counts against the project's monthly member limit (`projects.topeMensualMiembros`): it is refused with `member_limit_reached` when the month's member spend plus unsettled member attempts leaves less than its price, and its settled charge is added to `projectMemberSpend` in the same transaction. `scripts/build-migrations.mjs` runs `artifacts-migrate` on deploy; its tables stay unused while the feature is off.

Slides use one `deck.json` descriptor with stable slide/element ids. The worker creates native editable text, shapes and charts in PPTX using pinned PptxGenJS, then the offline renderer opens that PPTX in LibreOffice and rasterizes its PDF with Poppler. It refuses completion without actual PDF/page-count and native-open evidence. HTML text overflow is checked in Chromium before conversion. The initial font set is Arial (substituted by Liberation Sans on Linux), Liberation Sans and DejaVu Sans; native export fidelity and font substitution still require Linux review.

The synthetic slides fixture exports HTML/PPTX without provider calls:

```sh
npx tsx --require ./scripts/test-node-server-only-shim.cjs scripts/artifact-slides-fixture.ts /explicit/private/test-directory
```

Evidence so far: actual PPTX ZIP/native-object tests and both HTML slides reviewed in the available browser, including induced text overflow detection. LibreOffice/PDF/container execution is pending; a ZIP check does not establish native rendering fidelity.

Image generation runs in the worker through the direct OpenAI Images API, with the explicitly configured model or `gpt-image-2`. The existing editor image-edit path is unchanged. Each image is one identity and one paid attempt. A saved dependency exposes `artifactId@revision/outputIndex`; the worker rechecks access, pinned revision, size and SHA-256 before passing bytes to a renderer. It never fetches an authored/provider-returned image URL.

Both `OPENLEN_ARTIFACT_IMAGE_CENTICREDITS` and `OPENLEN_ARTIFACT_RENDER_CENTICREDITS` must be explicit nonnegative integers before wiring the paid image transport. Missing policy means no provider call. These names are configuration contracts, not an approved commercial price; leave them unset until pricing is decided. This implementation checks sufficient balance before admitting a paid attempt and settles after validated private outputs are stored, in the same transaction that publishes the result. It adds no credit reservation to agent turns. If another operation consumes the balance first, settlement cannot overdraw it: the staged result requires attention and is retained for reconciliation.

Attempts/receipts and settlements survive project deletion. Repeated successful completion charges once; known failures record actual usage/cost with zero user charge. Unknown outcomes stay `needs_attention` without automatic paid replay. Unknown or incomplete usage cost stays NULL. Direct Images Standard cost rates are separate from the legacy flat image-edit accounting; see [official pricing](https://developers.openai.com/api/docs/pricing) and [cached-input applicability](https://developers.openai.com/api/docs/guides/image-generation). No paid acceptance call, production migration, activation or deployment has been performed by these tests.

Motion uses a pinned GSAP 3.15.0 paused timeline, the same source compiler and the offline browser renderer, followed by a fixed FFmpeg image-pipe invocation. It never runs authored code in Node. `motion.json` binds 1280x720, 30fps, 1..120 seconds in whole frames and the runtime version. The browser checks direct/reversed beginning/middle/end seeks with exact PNG equality, captures all frames and applies backpressure to the encoder. FFprobe and a full FFmpeg decode verify H.264/yuv420p, exact frame count and bounded duration. The default remains silent; optional uploaded/pinned tracks add one stereo48kHz AAC stream under the separate audio gate. A failed export leaves the editable source intact.

The motion adapter remains behind `OPENLEN_ARTIFACT_MOTION_VERIFIED=1` as well as the feature/image gates until Linux resource/isolation acceptance. Do not set this gate from the Windows spike alone. That spike produced an actual six-second/180-frame/30fps MP4 using a synthetic dashboard capture and the committed compiler/capture/encoding code. Six manual direct/reverse timestamps matched exactly; the shared renderer's three samples passed and an intentionally changing seek failed as `motion_nondeterministic`. Browser-connector capture took 26s including duplicate file screenshots for this Windows test workaround; this is not a measurement in the required 2CPU/2GiB Linux container. Real app screenshot freezing, 120s worst-case resource checks and operational acceptance remain pending.

GSAP's proprietary notice is retained in exported HTML. Its [standard license and FAQ](https://gsap.com/community/standard-license/) expressly discuss AI-generated code; this implementation authors animation code through chat and does not introduce a visual animation builder.

Generate a synthetic fixture with an explicit previously captured test dashboard:

```sh
npx tsx --require ./scripts/test-node-server-only-shim.cjs scripts/artifact-motion-fixture.ts /explicit/private/test-directory /path/to/synthetic-dashboard.png
```


## OpenAI-only audio (not enabled by Windows tests)

Audio is a fifth saved artifact kind: one OpenAI PCM request per narration job, followed by an isolated local mix/export. Default speech model: `gpt-4o-mini-tts-2025-12-15`; optional `OPENLEN_ARTIFACT_AUDIO_MODEL` also accepts `gpt-4o-mini-tts`. Native output:24kHz signed16mono PCM, wrapped as WAV. Mixed downloads: MP3/WAV stereo48kHz, with optional unmixed narration and AI-voice metadata. Binary speech responses provide no metered usage here; cost stays null. No generated music/effects or voice cloning is integrated.

Set `OPENLEN_ARTIFACT_AUDIO_CENTICREDITS` to the explicitly reviewed per-job speech charge alongside existing image/render policy. Require `OPENAI_API_KEY`, `OPENLEN_ARTIFACT_RENDERER_IMAGE`, and `OPENLEN_ARTIFACT_AUDIO_VERIFIED=1` before advertising Audio. Do not set the verification gate from the local FFmpeg test. Narration charges use `artifact_audio`; outcomes/unknown calls use the existing persisted admission and settlement rules. Speech scripts and private audio are never placed in billing receipts.

`list_artifact_audio` reads only this project's upload metadata. Uploaded hash filenames are verified against bounded reads; dependency tracks use exact revision/output IDs. Max8inputs including generated narration,20MiB each/64MiB total,120seconds output; built-in voices and4096character script bound. Narration is untrimmed and must fit. Uploaded music/effects support trim/start/gain/fades and automatic ducking under narration. Decoding allows local file protocols and wav/mp3/mov/ogg demuxers only. Rebuild the renderer image to include audio.mjs. Existing silent motion is unchanged; sound-enabled motion additionally requires the audio gate.

Acceptance still required on the actual2CPU/2GiB Linux renderer: offline codecs, longest mix, MP4 mux, malformed files, cancellation/container cleanup. Then run budget-authorized OpenAI speech/Spanish pronunciation and end-to-end model selection checks. No provider calls are made by local fixtures.
