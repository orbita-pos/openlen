# Artifact renderer operation (Len 3.0 branch, feature disabled by default)

The Next app only saves sources and queues jobs. The standalone worker builds a sealed input with the existing app compiler/bundler, then runs the trusted browser renderer in a separate offline container. Generated source is never evaluated in Node.

Build the image from the repository root when a Linux test host is selected:

```sh
docker build -f infra/artifact-renderer/Dockerfile -t openlen/artifact-renderer:1 .
```

The worker requires an explicit local image (`OPENLEN_ARTIFACT_RENDERER_IMAGE`); it never pulls images during a job. The per-job runner sets 2 CPUs, 2 GiB RAM/no swap, 128 processes, a read-only filesystem, no network/capabilities, and a bounded temporary filesystem. It mounts only a fresh output directory, passes the source envelope through stdin, and force-removes its generated container name on cancellation/timeout before removing that directory. No DB URL, provider key, Docker socket or host project directory enters the renderer.

Do not activate `OPENLEN_ARTIFACTS=1` until all format acceptance, pricing, isolated-preview access, recovery and operational checks have passed. This document does not authorize deployment or installation.

Current evidence: compiler/SQL/domain regression tests, and a committed synthetic dashboard viewed/filtered in the available Windows browser. The dedicated Puppeteer launch fails on this Windows execution surface before loading authored content. Its opt-in browser test remains pending here; this is not a successful Linux/container isolation test. Docker is not currently installed on this PC or the OpenLen host. The user deferred selecting a test host until the code is ready.

Generate the synthetic fixture (no provider calls or customer data):

```sh
npx tsx --require ./scripts/test-node-server-only-shim.cjs scripts/artifact-dashboard-fixture.ts /explicit/private/test-directory
```

Its packet.json can be passed on stdin to the renderer container. The HTML and CSV are independent local fixtures for browser review. They are not a generation template or proof of the model's tool selection; use Len-Bench/the real brain and recorder for that later acceptance stage.

Current downloads are attachments. No authored HTML is served inline on the authenticated product origin. A separately authorized preview origin remains required before enabling interactive artifact previews.

Slides use one `deck.json` descriptor with stable slide/element ids. The worker creates native editable text, shapes and charts in PPTX using pinned PptxGenJS, then the offline renderer opens that PPTX in LibreOffice and rasterizes its PDF with Poppler. It refuses completion without actual PDF/page-count and native-open evidence. HTML text overflow is checked in Chromium before conversion. The initial font set is Arial (substituted by Liberation Sans on Linux), Liberation Sans and DejaVu Sans; native export fidelity and font substitution still require Linux review.

The synthetic slides fixture exports HTML/PPTX without provider calls:

```sh
npx tsx --require ./scripts/test-node-server-only-shim.cjs scripts/artifact-slides-fixture.ts /explicit/private/test-directory
```

Evidence so far: actual PPTX ZIP/native-object tests and both HTML slides reviewed in the available browser, including induced text overflow detection. LibreOffice/PDF/container execution is pending; a ZIP check does not establish native rendering fidelity.

Image generation runs in the worker through the direct OpenAI Images API, with the explicitly configured model or `gpt-image-2`. The existing editor image-edit path is unchanged. Each image is one identity and one paid attempt. A saved dependency exposes `artifactId@revision/outputIndex`; the worker rechecks access, pinned revision, size and SHA-256 before passing bytes to a renderer. It never fetches an authored/provider-returned image URL.

Both `OPENLEN_ARTIFACT_IMAGE_CENTICREDITS` and `OPENLEN_ARTIFACT_RENDER_CENTICREDITS` must be explicit nonnegative integers before wiring the paid image transport. Missing policy means no provider call. These names are configuration contracts, not an approved commercial price; leave them unset until pricing is decided. This implementation checks sufficient balance before admitting a paid attempt and settles after validated private outputs are stored, in the same transaction that publishes the result. It adds no credit reservation to agent turns. If another operation consumes the balance first, settlement cannot overdraw it: the staged result requires attention and is retained for reconciliation.

Attempts/receipts and settlements survive project deletion. Repeated successful completion charges once; known failures record actual usage/cost with zero user charge. Unknown outcomes stay `needs_attention` without automatic paid replay. Unknown or incomplete usage cost stays NULL. Direct Images Standard cost rates are separate from the legacy flat image-edit accounting; see [official pricing](https://developers.openai.com/api/docs/pricing) and [cached-input applicability](https://developers.openai.com/api/docs/guides/image-generation). No paid acceptance call, production migration, activation or deployment has been performed by these tests.

Motion uses a pinned GSAP 3.15.0 paused timeline, the same source compiler and the offline browser renderer, followed by a fixed FFmpeg image-pipe invocation. It never runs authored code in Node. `motion.json` binds 1280x720, 30fps, 1..120 seconds in whole frames and the runtime version. The browser checks direct/reversed beginning/middle/end seeks with exact PNG equality, captures all frames and applies backpressure to the encoder. FFprobe and a full FFmpeg decode verify one H.264/yuv420p video stream, no audio, exact frame count and bounded duration. A failed export leaves the editable source intact.

The motion adapter remains behind `OPENLEN_ARTIFACT_MOTION_VERIFIED=1` as well as the feature/image gates until Linux resource/isolation acceptance. Do not set this gate from the Windows spike alone. That spike produced an actual six-second/180-frame/30fps MP4 using a synthetic dashboard capture and the committed compiler/capture/encoding code. Six manual direct/reverse timestamps matched exactly; the shared renderer's three samples passed and an intentionally changing seek failed as `motion_nondeterministic`. Browser-connector capture took 26s including duplicate file screenshots for this Windows test workaround; this is not a measurement in the required 2CPU/2GiB Linux container. Real app screenshot freezing, 120s worst-case resource checks and operational acceptance remain pending.

GSAP's proprietary notice is retained in exported HTML. Its [standard license and FAQ](https://gsap.com/community/standard-license/) expressly discuss AI-generated code; this implementation authors animation code through chat and does not introduce a visual animation builder.

Generate a synthetic fixture with an explicit previously captured test dashboard:

```sh
npx tsx --require ./scripts/test-node-server-only-shim.cjs scripts/artifact-motion-fixture.ts /explicit/private/test-directory /path/to/synthetic-dashboard.png
```
