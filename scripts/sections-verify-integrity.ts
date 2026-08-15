import { pathToFileURL } from "node:url";

import { listSections } from "@/lib/sections/store";
import { verifySectionIntegrity } from "@/lib/sections/verify-integrity";

/**
 * Read-only catalog integrity check. Every published section must still serve
 * the exact bytes its row claims, because the composition path fails closed
 * when it does not — opaquely, as `section_inventory_unavailable`.
 *
 *   npm run sections:verify-integrity
 *   npm run sections:verify-integrity -- --json
 */
async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const sections = await listSections({ status: "published" });
  const report = await verifySectionIntegrity(sections.map((row) => ({
    id: row.id,
    type: row.type,
    contentHash: row.contentHash,
    storageUrl: row.storageUrl,
  })));

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`checked ${report.checked} — ok ${report.ok} · cdn_transformed ${report.cdnTransformed} · corrupt ${report.corrupt} · unreachable ${report.unreachable}`);
    for (const row of report.rows.filter((entry) => entry.status !== "ok").slice(0, 40)) {
      console.log(`  ${row.status.padEnd(16)} ${row.type.padEnd(10)} ${row.id} expected=${row.expectedHash} served=${row.servedHash ?? "-"}`);
    }
    if (report.cdnTransformed > 0) {
      console.log("\ncdn_transformed means the CDN rewrote the fragment in flight (Cloudflare");
      console.log("Email Obfuscation is the known cause). The stored object is fine — fix the");
      console.log("CDN configuration for the sections host; do NOT re-stamp contentHash.");
    }
  }

  if (report.checked === 0 || report.ok !== report.checked) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: Error) => {
    console.error(JSON.stringify({ event: "sections_verify_integrity", ok: false, message: error.message }));
    process.exitCode = 1;
  });
}
