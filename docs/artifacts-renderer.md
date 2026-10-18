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
