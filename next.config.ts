import { withInariWatch } from "@inariwatch/capture/next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// NextConfig is intentionally untyped here. `withInariWatch` accepts a
// loose `NextConfig` shape (`experimental?: Record<string, unknown>`) that
// conflicts with Next's own stricter `NextConfig['experimental']` interface;
// letting TS infer from the literal keeps both happy.
const nextConfig = {
  reactStrictMode: true,
  // Self-host SIN R2: lib/storage/templates.ts cae a servir el HTML crudo de
  // las plantillas desde /template-objects, o sea el MISMO origen que la app —
  // y ese HTML no pasa por sanitizeForPublish (se guarda crudo a propósito,
  // se sanitiza al clonar). En esa configuración un script dentro de una
  // plantilla corría con el origen de la app. La CSP `sandbox` sin
  // allow-same-origin le da origen opaco: sigue pintando (el CDN de Tailwind
  // es externo) pero ya no alcanza cookies, storage ni la API con la sesión.
  //
  // No afecta a producción: con R2 configurado las plantillas se sirven desde
  // templates.openlen.com y esta ruta ni se usa. Medido sobre las 178
  // plantillas del catálogo: ninguna usa Babel, fetch/XHR ni type=module, así
  // que nada depende de conservar el origen.
  async headers() {
    return [
      {
        source: "/template-objects/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "sandbox allow-scripts" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  outputFileTracingRoot: path.resolve(__dirname),
  // Force the standalone tracer to copy tailwindcss's package-relative CSS
  // assets (preflight.css, stubs) into the standalone tree alongside the
  // JS — they're loaded at runtime via `fs.readFileSync` and the tracer
  // doesn't follow that.
  outputFileTracingIncludes: {
    "*": [
      "./node_modules/tailwindcss/lib/css/*.css",
      "./node_modules/tailwindcss/stubs/*",
    ],
  },
  // External Node packages:
  // - tailwindcss, postcss: webpack would inline them into .next/server/
  //   chunks/*.js, breaking package-relative asset paths (preflight.css,
  //   stubs). Required by the publish-time Tailwind pipeline.
  // - @openlen/html-engine, @openlen/rate-limit,
  //   @openlen/images: each ships a native `.node` binding that webpack
  //   can't parse. Externalising hands the require off to Node's loader
  //   at runtime, which knows how to load native modules. html-engine
  //   landed in F1 S9 (commit 1ab1724); ai-gateway landed in F3 S3 when
  //   `lib/ai-stream/generate.ts` became the first app-code consumer;
  //   rate-limit landed in F4 when `lib/rate-limit-rs.ts` consolidated
  //   the four legacy limit modules; images landed in F4 when
  //   `app/api/upload/route.ts` became the first consumer (replacing
  //   the `sharp` Node binding).
  // - puppeteer: a large package with dynamic requires + a bundled-browser
  //   resolver that webpack can't trace. Externalising hands the require to
  //   Node at runtime (the box renders project-card thumbnails on publish /
  //   create via lib/projects/thumbnail.ts, reaching system Chrome through
  //   PUPPETEER_EXECUTABLE_PATH). It's a runtime dependency, so the
  //   standalone tracer copies it into the output tree.
  serverExternalPackages: [
    "tailwindcss",
    "postcss",
    "@openlen/html-engine",
    "@openlen/rate-limit",
    "@openlen/images",
    "puppeteer",
    "lighthouse",
  ],
  // serverExternalPackages alone doesn't always exclude transitively-linked
  // workspace deps from webpack's module graph (the `file:` symlink to
  // crates/<name> gets followed into the napi `index.js` and chokes on the
  // bundled `.node` file). Belt-and-braces: a server-only webpack external
  // that matches each package name AND its workspace symlink path.
  webpack: (config: unknown, ctx: { isServer: boolean }) => {
    const c = config as {
      externals?: unknown[];
      resolve?: { alias?: Record<string, unknown> };
    };
    if (!ctx.isServer) {
      // Client/browser bundle. @huggingface/transformers (client-side
      // background removal) lazily requires Node-only deps that must be
      // stubbed for the browser, or webpack chokes trying to bundle them.
      // ORT-web loads its wasm from CDN at runtime, so nothing else here.
      c.resolve = c.resolve ?? {};
      c.resolve.alias = {
        ...(c.resolve.alias ?? {}),
        sharp$: false,
        "onnxruntime-node$": false,
      };
      return config;
    }
    const externals = c.externals ?? [];
    externals.push(
      (
        { request }: { request?: string },
        callback: (err: null | Error, result?: string) => void,
      ) => {
        if (!request) return callback(null);
        if (
          request === "@openlen/html-engine" ||
          request === "@openlen/rate-limit" ||
          request === "@openlen/images" ||
          request.endsWith("/crates/html-engine/index.js") ||
          request.endsWith("/crates/rate-limit/index.js") ||
          request.endsWith("/crates/images/index.js") ||
          request.endsWith(".node")
        ) {
          return callback(null, "commonjs " + request);
        }
        callback(null);
      },
    );
    c.externals = externals;
    return config;
  },
  // Standalone build emits `.next/standalone/server.js` plus the minimum
  // `node_modules/` tree the runtime actually needs. `.next/static/` and
  // `public/` stay outside `standalone/` and must be copied in by the
  // deploy script before launching the server — see `infra/scripts/deploy.sh`.
  output: "standalone" as const,
};

export default withNextIntl(withInariWatch(nextConfig));
