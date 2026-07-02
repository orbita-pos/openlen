// lib/three3d/runtime/lite-index.ts
import { mountLite } from "./lite";

declare global {
  interface Window { OpenLen3D?: { mount: typeof mountLite } }
}

window.OpenLen3D = { mount: mountLite };
