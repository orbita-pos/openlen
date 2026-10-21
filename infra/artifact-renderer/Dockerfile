# The base is pinned by digest (the image index on Docker Hub, 2026-10-20): a rebuild starts from the same bytes.
# Debian packages are NOT pinned on purpose: this Chromium renders untrusted HTML and must take Debian's security
# updates, and dated snapshots of the security archive are not reliably served. Reproducibility lives in the image
# instead: production runs a verified local image (`--pull never`, OPENLEN_ARTIFACT_RENDERER_IMAGE), and a rebuild
# is used only after it passes the Linux acceptance (scripts/artifact-linux-acceptance.ts). The verified image
# openlen/artifact-renderer:2 (sha256:af974bbb102a…) carries: chromium 155.0.8059.79-1~deb12u1,
# libreoffice-impress 4:7.4.7-1+deb12u14, ffmpeg 7:5.1.9-0+deb12u1, poppler-utils 22.12.0-2+deb12u3,
# ca-certificates 20250419~deb12u2, fonts-liberation 1:1.07.4-11, fonts-crosextra-carlito 20220224-1,
# fonts-crosextra-caladea 20200211-1, fonts-dejavu-core 2.37-6, fonts-inter 4.0~beta7+ds-1, fonts-roboto
# 2:0~20170802-3, fonts-open-sans 1.11-2, fonts-lato 2.0-2.1, fonts-ebgaramond 0.016+git20210310.42d4f9f2-1,
# fonts-jetbrains-mono 2.242+ds-3.
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
ENV PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium OPENLEN_RENDER_CONTAINER=1 HOME=/tmp
RUN apt-get update && apt-get install -y --no-install-recommends chromium libreoffice-impress poppler-utils ffmpeg fonts-dejavu-core fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-inter fonts-roboto fonts-open-sans fonts-lato fonts-ebgaramond fonts-jetbrains-mono ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /renderer
COPY tools/artifact-renderer/package.json tools/artifact-renderer/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY tools/artifact-renderer/browser.mjs tools/artifact-renderer/render.mjs tools/artifact-renderer/office.mjs tools/artifact-renderer/video.mjs tools/artifact-renderer/slide-layout.mjs tools/artifact-renderer/audio.mjs ./
USER 10001:10001
ENTRYPOINT ["node", "render.mjs"]
