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

The box can download from Poly Haven and ambientCG.

- **Poly Haven:** its API (api.polyhaven.com) lists an asset's files and their links, and the files themselves come from dl.polyhaven.org. Its API terms ask for two things: a User-Agent of your own (`curl -A "OpenLen-game/1.0"`), and telling the person the asset came from Poly Haven. Its /ASSETS.md row is that credit; say it in your answer too.
- **ambientCG:** `https://ambientcg.com/get?file=<name>_1K-JPG.zip` (curl -L follows it to its download host).
- Download into /tmp, unzip, and copy only the files the game uses into /models, /textures, /sounds or /img. One asset at a time, only what the game uses: never bulk downloads.
- Never link to a file on its own site. A file on someone else's server breaks the published game the day it moves.
- Each file can be up to 50 MB. Compress GLB models with meshopt (references/three.md).

**Kenney** doesn't serve its packs to anything that isn't a browser, so the box can't bring them. When a Kenney pack fits, tell the person which one (its page on kenney.nl): they download it and drop its files into the Code lens, and you take them from there.

## Without the box

You can't bring a file from outside into the project yourself; the person can drop files into the Code lens. Build with what code makes:
- **Shapes and materials:** three's geometries, or Phaser's Graphics and the textures it generates. This is how Kimi's method starts anyway: the blockout.
- **Sounds synthesized with Web Audio:** an OscillatorNode with a GainNode envelope makes a jump, a coin or a hit.

Don't say you brought assets you couldn't bring.

## /ASSETS.md

One row per asset brought from outside, even CC0:

| File | Source | License | Attribution |
|---|---|---|---|
| /models/ship.glb | https://polyhaven.com/a/… | CC0 | — |

The list tells the person what they can reuse, and from where.
