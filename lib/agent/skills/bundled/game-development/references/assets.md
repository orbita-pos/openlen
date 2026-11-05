# Assets

Kimi Academy's 3D tutorial (kimi.ai/academy/3d-tutorial), said for this platform.

## First, what can be used as it is

List the assets that can be used as they are, then make what is missing. Pick packs of one consistent style: a game mixing three styles looks broken.

## Where they come from

All three sources are CC0: free to use, with nothing required. Each asset still goes in /ASSETS.md.

- **Kenney** (kenney.nl): game packs with 2D sprites, 3D models, interface pieces and sounds.
- **Poly Haven** (polyhaven.com): 3D models, textures and HDRIs.
- **ambientCG** (ambientcg.com): textures and materials.

Careful with **Quaternius**. Its license forbids redistributing the assets on their own, also inside templates, and anyone can remix a public project here from Explore. Don't use it in a public game.

## With the box

The box can download from those three sites.

- Download into /tmp, unzip, and copy only the files the game uses into /models, /textures, /sounds or /img.
- Never link to a file on its own site (Poly Haven forbids scraping). A file on someone else's server breaks the published game the day it moves.
- Each file can be up to 50 MB. Compress GLB models with meshopt (references/three.md).

## Without the box

There is no way to bring a file from outside into the project. Build with what code makes:
- **Shapes and materials:** three's geometries, or Phaser's Graphics and the textures it generates. This is how Kimi's method starts anyway: the blockout.
- **Sounds synthesized with Web Audio:** an OscillatorNode with a GainNode envelope makes a jump, a coin or a hit.

Don't say you brought assets you couldn't bring.

## /ASSETS.md

One row per asset brought from outside, even CC0:

| File | Source | License | Attribution |
|---|---|---|---|
| /models/ship.glb | https://polyhaven.com/a/… | CC0 | — |

The list tells the person what they can reuse, and from where.
