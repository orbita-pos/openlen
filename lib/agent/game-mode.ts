// LEN'S GAME POSTURE (spec local 2026-11-05-modo-juego-design, §8.4): a game is an app (`modo-app.ts`), so its
// prompt and manual start from the app's; what is FALSE in a game is swapped, cut by its marks like
// `promptDeLaApp` does with a page's — if a mark disappears it THROWS instead of sending Len half a prompt.
//   · The prompt: where the game and its assets go, no hash-routed screens, no business records, testing by
//     playing (the eyes of spec 1), and a short GAME POSTURE that sends Len to the `game-development` skill.
//   · The manual: no <HashRouter>, no routes, no <Link> between screens, the backend client said as one a game
//     CREATES if it saves data, and a «Game» section like the tool's.
// Nothing is invented: the engine is three or Phaser, written as everyone writes them; the know-how is the skill.
//
// Cache effect: only in game projects; page, app and tool prompts and manuals stay byte-identical (tested).
// All in English: the model reads it.

import { PROBAR_LA_APP } from "./modo-app";

const find =(text: string, mark: string, from = 0): number => {
  const i = text.indexOf(mark, from);
  if (i === -1) {
    throw new Error(
      `game-mode: the mark «${mark.trim().slice(0, 60)}» didn't appear — the app's prompt or manual was reworded. ` +
        "Update lib/agent/game-mode.ts; do NOT ignore it: Len would get in a game what is only true of an app.",
    );
  }
  return i;
};

function swap(text: string, from: string, to: string): string {
  const i = find(text, from);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

/** Swaps the block that starts at `start` and ends right before `end`. */
function swapBlock(text: string, start: string, end: string, by: string): string {
  const i = find(text, start);
  const j = find(text, end, i + start.length);
  return text.slice(0, i) + by + text.slice(j);
}

/** Swaps the whole line that contains `mark` (without its newline). */
function swapLine(text: string, mark: string, by: string): string {
  const i = find(text, mark);
  const start = text.lastIndexOf("\n", i) + 1;
  const end = find(text, "\n", i);
  return text.slice(0, start) + by + text.slice(end);
}

/** Removes the whole line that contains `mark`, with its newline. */
function dropLine(text: string, mark: string): string {
  const i = find(text, mark);
  const start = text.lastIndexOf("\n", i);
  const end = find(text, "\n", i);
  return text.slice(0, start) + text.slice(end);
}

// ─── The prompt ─────────────────────────────────────────────────────────────

const WHERE_THE_GAME_LIVES =
  "The game lives in /src: its entry mounts it, /src/App.tsx holds its screens and HUD in React, the game itself goes under /src/game (its scenes, entities and loop, in the engine's own code), and its 3D models, textures and sounds go in /models, /textures and /sounds (images in /img), each one brought from outside listed in /ASSETS.md with its source and license. ";

const TEST_THE_GAME =
  'If you change the game, play it before you call it done. With use_page, press the keys it uses (key) and look at what they did (a screenshot, or zoom on the canvas): the page\'s text doesn\'t show what a canvas draws. What only moves while a key is HELD, look at it in the box with Playwright (the verify skill, "When it moves"); without the box, say in your verdict that you couldn\'t verify it, and don\'t "fix" code that may work. Never say the game plays if you didn\'t see it move. You don\'t have to win it: a few seconds of input and the proof that it moved are enough.';

const THEIR_DATA_IN_A_GAME = `THEIR DATA AND THEIR LINKS:
What the game shows about THEM —their name, their brand, their links, real people's names in a score table— is never invented or guessed, because it looks true: they give it to you (ask_user_question). A link goes into the code verbatim and absolute, and only if they gave it to you.`;

const GAME_POSTURE = `GAME POSTURE
This project is a GAME: a browser game built as an app (React for its screens and HUD, the game in a canvas). It is born without an engine: pick one by what the person asks for —three for 3D, Phaser for 2D, a plain canvas for a tiny game— and importing it installs it. Before building or changing the game, load the game-development skill: it says how to build it (Kimi's method: first a blockout of plain boxes and a scene that already plays, then the detail), what this platform can't serve, where models and sounds come from, and how to check it by playing.`;

export function promptOfGame(appPrompt: string): string {
  let p = swapBlock(appPrompt, "The app itself lives in /src: ", "Read to read, Edit to change", WHERE_THE_GAME_LIVES);
  p = dropLine(p, "- Screens are hash routes (/#/sales):");
  p = swap(p, PROBAR_LA_APP, TEST_THE_GAME);
  p = swapBlock(p, "THEIR DATA AND THEIR LINKS:\n", "\n\nMEMORY — ", THEIR_DATA_IN_A_GAME);
  return `${p}\n\n${GAME_POSTURE}`;
}

// ─── The manual (/AGENTS.md) ────────────────────────────────────────────────

const ENTRY_IN_A_GAME =
  '- The entry mounts the game (createRoot(document.getElementById("root")).render(<App />)), with no router; /src/App.tsx holds its screens and HUD, and the game itself goes under /src/game, in the engine\'s own code.';

const SCREENS_IN_A_GAME =
  "- SCREENS of a game (the menu, the game itself, game over, settings) are React state in /src/App.tsx, or the engine's own scenes: a game has no router. Never write a /<slug>/index.html in a game: it would be a static page outside it.";

const BACKEND_IN_A_GAME =
  '- A game that saves data (scores, progress) creates its client once, in /src/lib/supabase.ts, with createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY), and every file takes it from there: import { supabase } from "@/lib/supabase". The publishable key is meant to be in the code; a secret key, never.';

const GAME_MANUAL = `## Game

This project is a game (an app with Len's game posture). Before building or changing it, load the game-development skill.

- /src/game/ — the game itself: its scenes, entities and loop, in the engine's own code (three or Phaser).
- /src/App.tsx — the screens and HUD around the canvas, in React.
- /models, /textures, /sounds — its 3D models (GLB), textures and sounds; images in /img. Load them by their path ("/models/ship.glb") or with ?url.
- /ASSETS.md — every asset brought from outside, with its source, license and attribution.`;

export function manualOfGame(appManual: string): string {
  let m = swapLine(appManual, ' mounts the app (createRoot(document.getElementById("root")).render(…)) inside <HashRouter>;', ENTRY_IN_A_GAME);
  m = swapLine(m, "- SCREENS are hash routes:", SCREENS_IN_A_GAME);
  m = dropLine(m, "- Between screens, <Link to=");
  m = swapLine(m, "- In the app, the client is created once in ", BACKEND_IN_A_GAME);
  return `${m}\n\n${GAME_MANUAL}`;
}
