---
name: game-development
description: Use before building or changing a game in this project — how to build it (a blockout first, then a scene that already plays), which engine (three for 3D, Phaser for 2D), what this platform can't serve, where models and sounds come from, and how to check it by playing.
---

# Building a game

This project is a game: an app (React in /src) whose game runs in a canvas. It is born without an engine: you pick one from what the person asks for, and importing it installs it, as `npm install` would.

## The method

Match how you build to what the brief cares about:

### Gameplay-first games (arcade, action, puzzle, platformer)
Moonshot teaches this way of building a 3D scene or a game with an agent in Kimi Academy's 3D tutorial (kimi.ai/academy/3d-tutorial). It works for 2D too:

1. **A blockout first.** Build the level with plain boxes, cylinders and flat colors before any model, texture or effect.
2. **Look at it from more than one camera** before adding detail: the player's, from the front and from above.
3. **One representative scene that already plays** — the player moves, the main rule works — before more levels, enemies or content.
4. **Finish one piece before the next.** Check that the interaction feels right and that it loads quickly, then add more.
5. **Assets: first list what can be used as it is, then make what is missing.** Every asset brought from outside goes in /ASSETS.md (references/assets.md).

### Art-directed & architectural 3D worlds (interiors, horror, sci-fi, atmospheric exploration)
When the person asks for high visual craft, architectural coherence, realistic mood or an explorable 3D environment, **do not stop at a flat-colored blockout**:

1. **Write a metric spatial contract first (`1 unit = 1.00 m`).** Before writing geometry, put exact bounds, floor elevations, wall thicknesses (`0.18–0.24 m`), doorway openings wider than the player collider, window openings, and per-room focal points in `/src/game/constants.ts`.
2. **Build real architectural depth, never overlapping slabs.** Split walls with doors or windows into non-overlapping left jamb, right jamb, lintel and sill; add door casings, baseboards, moldings, beams and recessed window sills; keep flat overlays offset by `>= 8 mm` (`0.008 m`) with `polygonOffset` for zero z-fighting; scale UVs from world meters so textures never stretch (references/three.md).
3. **Use real PBR materials, staged props and layered lighting.** Generate seamless procedural PBR maps (albedo + 3×3 Sobel normal + roughness) when external textures aren't used, stage rooms with lived-in props and clear doorway focal framing, contrast warm/cold light pools within WebGL's shadow-unit budget, and finish with controlled ACESFilmic + bloom + color-grading post-processing (references/three.md).
4. **Split multi-layer builds across parallel subagents when `subagent` is available.** Write `/src/game/constants.ts` and shared collision/math helpers yourself **first** so every module shares one coordinate system and exact export signatures. Then launch `general-purpose` subagents together in one message with `isolation: "worktree"` on disjoint folders (for example `/src/game/architecture/`, `/src/game/materials/`, `/src/game/props/`, `/src/game/lighting/`) — never let two isolated subagents edit `/src/App.tsx` or `/src/game/Game.tsx`. Wire their modules together yourself once their notices arrive, then run `npx tsc --noEmit` and `npm run build`.

## Pick the engine

- **3D: three**, with `WebGLRenderer`. Read references/three.md before writing it: it covers React cleanup, software-WebGL adaptation for headless checks, metric architecture, procedural PBR maps, shadow budgets, `EffectComposer` post-processing, sliding collisions and inspection cameras.
- **2D: Phaser 4.** Mount it in React the way Phaser's own template does (references/phaser/template-react-ts.md). Before using a part of Phaser (scenes, keyboard and touch input, arcade physics, scaling, audio, loading, sprites, tilemaps, tweens, cameras…), find its own skill in references/phaser-index.md and read it. You probably know Phaser 3 better than 4: references/phaser/v3-to-v4-migration/SKILL.md says what changed. Phaser's files are served in a game project; in a page being converted into a game, they arrive with the next turn.
- **A tiny game** (a few shapes, one screen): a plain 2D canvas is enough, as the skeleton's /src/game/Game.tsx does.

Keep what changes every frame in the engine or in plain variables, never in React state: a setState per frame renders React sixty times a second. React is for the menus and the HUD around the canvas.

## What this platform can't serve

- **WebGPU.** Len's eyes are a headless Chromium with software WebGL, and they can't capture a WebGPU canvas; three's WebGPURenderer falls back without saying so. Use WebGLRenderer: three's own llms.txt calls it the default, with the widest compatibility.
- **A package that loads a separate .wasm file.** Packages are bundled into the app, and a .wasm fetched by URL at runtime has no path here. Use the `-compat` builds that carry it inside (for physics, `@dimforge/rapier3d-compat`).
- **Draco or KTX2 compressed models**, whose decoders are fetched by URL. Compress GLB with meshopt instead: its decoder is a plain module (`three/addons/libs/meshopt_decoder.module.js`).

## Phones

- Touch controls as well as keys: buttons or a virtual joystick over the canvas.
- Start with a screen the player taps («Tap to play»). Sound, pointer lock and fullscreen only start after a user gesture, by the browsers' autoplay rule. Phaser unlocks its audio on that first touch by itself; with three, resume the AudioContext there.
- iPhone has no fullscreen for an element: design for the window.
- The game's canvas has `touch-action: none`, so dragging on it doesn't scroll the page.

## Files

- /src/game/ — the game. /src/App.tsx — the screens and HUD.
- /models, /textures, /sounds — GLB models, textures and sounds; images in /img. Load them by their path ("/models/ship.glb") or import them with ?url.
- The project's files are served at their own path: there is no public/ folder mapped to the root. Where Phaser's template writes `this.load.setPath('assets')`, write the real folder (`this.load.setPath('/img')`).
- /ASSETS.md — every asset brought from outside, with its source, license and attribution (references/assets.md).

## Check it by playing

Load the verify skill and follow it. In a game:

- `use_page` presses keys (`key`) and clicks or drags on the canvas. Look with a `screenshot`, or a `zoom` on the canvas: the page's text doesn't show what a canvas draws.
- In a 3D or multi-room first-person game, pointer lock won't engage without a real browser gesture. Expose camera presets and `teleport` on `window.__GAME_DEBUG__` (references/three.md) so `use_page` (`eval` + `screenshot`) can inspect every room's doorway view, check dark-area readability, catch floating props, z-fighting or stretched UVs, and fix them before finishing.
- What only moves while a key is HELD (most games) is checked in the box with Playwright: the verify skill's "When it moves" (a paused clock, `keyboard.down`, a strip of frames). Without the box, say that you couldn't verify held movement.
- You don't have to win the game: a few seconds of input, inspecting key spaces, and proof that controls move the player are enough. Never say it plays if you didn't see it move.
