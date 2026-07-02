import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SceneSpec } from "../three3d/scene-spec";
import { backgroundCss } from "../three3d/background";

const RUNTIME_PATH = join(process.cwd(), "lib/three3d/runtime/dist/openlen-3d.js");
const RUNTIME_LITE_PATH = join(process.cwd(), "lib/three3d/runtime/dist/openlen-3d-lite.js");

export function readRuntimeJs(): string {
  return readFileSync(RUNTIME_PATH, "utf8");
}

// Shader-only pages bake this raw-WebGL bundle instead of the full three.js
// runtime (~10KB vs ~155KB-gz). Same window.OpenLen3D.mount contract.
export function readRuntimeLiteJs(): string {
  return readFileSync(RUNTIME_LITE_PATH, "utf8");
}

export function buildSceneHostHtml(
  spec: SceneSpec,
  runtimeJs: string,
  size = { w: 1600, h: 900 },
): string {
  const json = JSON.stringify(spec);
  const bg = backgroundCss(spec) ?? "transparent";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:transparent}
    #stage{position:relative;width:${size.w}px;height:${size.h}px;background:${bg}}
    canvas{position:absolute;inset:0;width:100%;height:100%}
  </style></head><body>
    <div id="stage"><canvas id="c"></canvas></div>
    <script>${runtimeJs}</script>
    <script>
      window.__ol3dReady=false;
      window.addEventListener('three-ready',function(){window.__ol3dReady=true});
      window.OpenLen3D.mount(document.getElementById('c'), ${json});
    </script>
  </body></html>`;
}
