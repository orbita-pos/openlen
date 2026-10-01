import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La app importa código del repo (components/llamada, lib/len-bench/sse,
// brand/len-cara/cara.js, messages/) por el alias «@», como Next. React es UNO:
// el del repo raíz (dedupe), porque components/llamada lo importa desde ahí.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "..") },
    dedupe: ["react", "react-dom"],
  },
  server: { fs: { allow: [".."] } },
});
