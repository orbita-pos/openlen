FROM node:22-bookworm-slim
ENV PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium OPENLEN_RENDER_CONTAINER=1 HOME=/tmp
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /renderer
COPY tools/artifact-renderer/package.json tools/artifact-renderer/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY tools/artifact-renderer/browser.mjs tools/artifact-renderer/render.mjs ./
USER 10001:10001
ENTRYPOINT ["node", "render.mjs"]
