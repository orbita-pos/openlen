// ─────────────────────────────────────────────────────────────────────────────
// Visual-QA companion script for the block library.
//
// This script doesn't render anything by itself — it prints a manifest of the
// registry so you can confirm every block is wired up + reachable. For the
// live visual preview, start the Next.js dev server and visit
// /preview-blocks (palette toggle via ?palette=…).
//
// Run:
//   npx tsx scripts/preview-blocks.tsx
//
// The .tsx extension is intentional: keeps it adjacent to the React preview
// route conceptually, and tsx happily executes .tsx files in script mode.
// ─────────────────────────────────────────────────────────────────────────────

import { BLOCK_IDS, BLOCK_REGISTRY } from "../lib/blocks/_registry";

function pad(s: string, n: number) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

const COL_ID = Math.max(8, ...BLOCK_IDS.map((id) => id.length)) + 2;
const COL_NAME =
  Math.max(12, ...BLOCK_IDS.map((id) => BLOCK_REGISTRY[id].meta.displayName.length)) +
  2;

console.log("OpenLen block library — manifest\n");
console.log(pad("ID", COL_ID) + pad("Display name", COL_NAME) + "Aesthetics");
console.log("─".repeat(COL_ID + COL_NAME + 80));

for (const id of BLOCK_IDS) {
  const { meta } = BLOCK_REGISTRY[id];
  console.log(
    pad(id, COL_ID) +
      pad(meta.displayName, COL_NAME) +
      meta.aesthetics.join(", ")
  );
}

console.log(
  `\n${BLOCK_IDS.length} blocks registered. ` +
    `Run \`npm run dev\` and visit http://localhost:3000/preview-blocks for the visual preview.`
);
