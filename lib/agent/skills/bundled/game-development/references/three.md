# three.js here

Written from three.js's own sources (MIT): its guide for language models (threejs.org/docs/llms.txt) and its manual, for three r186–r187 (installing gives you the newest version published more than 7 days ago). three changes its API often: the types and the lint that check the files you change catch what no longer exists.

## Import

- `import * as THREE from "three"`: importing it installs it.
- Addons come from `three/addons/…`: `import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"`, `import { OrbitControls } from "three/addons/controls/OrbitControls.js"`.
- Not the old global `<script src="…/three.min.js">`: three's llms.txt calls it an outdated pattern.

## The renderer

- `new THREE.WebGLRenderer({ antialias: true })` is the default ("Maximum browser compatibility", says llms.txt). `WebGPURenderer` is for TSL or compute shaders, and here not at all: Len's eyes can't capture WebGPU.
- `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`: a phone at 3× would draw nine times the pixels.
- Colors: the output is sRGB by default; a texture with color gets `texture.colorSpace = THREE.SRGBColorSpace`. (`outputEncoding` is gone.)

## A scene inside a React component

The manual's first scene ("Creating a scene"), sized to its box as in its "Responsive Design", and released when the component goes away:

```tsx
import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function Game() {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = mount.current!;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.z = 3;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x44aa88 }));
    scene.add(cube, new THREE.HemisphereLight(0xffffff, 0x444444, 2));

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let last = 0;
    renderer.setAnimationLoop((time) => {
      // Seconds since the last frame, capped: after a pause nothing jumps across the level.
      const dt = Math.min((time - last) / 1000, 0.25);
      last = time;
      cube.rotation.y += dt;
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const m of [o.material].flat()) m.dispose();
        }
      });
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mount} className="h-full w-full" style={{ touchAction: "none" }} />;
}
```

Skipping the cleanup leaks a WebGL context every time the component mounts again, and browsers only keep a few.

## A model (GLB, compressed with meshopt)

```ts
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.loadAsync("/models/ship.glb");
scene.add(gltf.scene);
```

Not Draco or KTX2: their decoders are fetched by URL, which has no path here.

## Collisions and physics

None by default. Boxes that touch are a bounding-box check (`new THREE.Box3().setFromObject(a).intersectsBox(…)`), and the ground under the player is a `THREE.Raycaster`. When the game needs real physics, use `@dimforge/rapier3d-compat` (the build with its .wasm inside), and call `await RAPIER.init()` before creating the world.
