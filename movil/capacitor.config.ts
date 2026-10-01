import type { CapacitorConfig } from "@capacitor/cli";

// En dev la app carga de Vite en la PC (`LEN_DEV_URL=http://localhost:5173`),
// que el teléfono ve como `localhost` gracias a `adb reverse`: Android lo trata
// como origen seguro y el micrófono funciona sin flags. Sin la variable, la
// app usa lo empaquetado en `dist/`.
const dev = process.env.LEN_DEV_URL;

const config: CapacitorConfig = {
  appId: "app.openlen.len",
  appName: "Len",
  webDir: "dist",
  ...(dev ? { server: { url: dev, cleartext: true } } : {}),
  android: { allowMixedContent: false },
};

export default config;
