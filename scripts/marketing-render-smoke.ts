// Puppeteer render smoke test — no DB/network needed. Fills the sample
// fixture with sample data, renders it to a PNG via real headless Chrome,
// asserts PNG magic bytes, and writes scratch/marketing-smoke.png so a human
// can eyeball the result. Run: npm run marketing:render-smoke

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fillPostTemplate } from "../lib/marketing/fill";
import { renderPostPng } from "../lib/marketing/render";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

async function main() {
  const fixturePath = join(
    process.cwd(),
    "lib/marketing/post-templates/__fixtures__/sample-square.html",
  );
  const html = readFileSync(fixturePath, "utf8");
  const filled = fillPostTemplate(html, {
    businessName: "Taquería El Fogón",
    offer: "2x1 en tacos al pastor",
    phone: "55 1234 5678",
    url: "elfogon.openlen.com",
    accent: "#FF5A36",
    photoUrl: "https://images.openlen.com/160-plated-fine-dining-1920.webp",
  });

  const png = await renderPostPng(filled, "square");
  assert(png, "renderPostPng returned null — Chrome launch/render failed");
  assert(png!.subarray(0, 8).equals(PNG_MAGIC), "output is not a valid PNG (bad magic bytes)");

  const scratchDir = join(process.cwd(), "scratch");
  mkdirSync(scratchDir, { recursive: true });
  const outPath = join(scratchDir, "marketing-smoke.png");
  writeFileSync(outPath, png!);

  console.log(`ok 1080x1080 ${png!.byteLength} bytes -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
