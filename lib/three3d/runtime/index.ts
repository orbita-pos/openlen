// lib/three3d/runtime/index.ts
import { mount } from "./mount";

declare global {
  interface Window { OpenLen3D?: { mount: typeof mount } }
}

window.OpenLen3D = { mount };
