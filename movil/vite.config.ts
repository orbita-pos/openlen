import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La app importa código del repo (components/llamada, lib/len-bench/sse,
// brand/len-cara/cara.js, messages/) por el alias «@», como Next. React es UNO:
// el del repo raíz (dedupe), porque components/llamada lo importa desde ahí.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "..") },
    dedupe: ["react", "react-dom"],
  },
  server: { fs: { allow: [".."] } },
  // PostCSS vacío: sin esto Vite sube carpetas, encuentra el postcss.config de
  // la web (Tailwind) y lo pasa por el CSS del prototipo, que va tal cual.
  css: { postcss: {} },
  // lib/publish/base-host.ts (la ÚNICA fuente del dominio de las páginas) lee
  // esta variable como en Next; aquí no hay `process`, así que Vite la hornea.
  // Si no viene, la de producción desde el 2026-08-23 (y la de .env.local).
  define: {
    "process.env.NEXT_PUBLIC_PUBLISH_BASE_HOST": JSON.stringify(process.env.NEXT_PUBLIC_PUBLISH_BASE_HOST || "openlen.app"),
  },
});
