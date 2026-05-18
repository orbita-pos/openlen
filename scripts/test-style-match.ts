import { orchestrate } from "../lib/style-match";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: tsx scripts/test-style-match.ts <url>");
    process.exit(1);
  }

  console.log(`\n[style-match] Scraping: ${url}\n`);
  const t0 = Date.now();
  const out = await orchestrate({ url });
  const totalMs = Date.now() - t0;

  console.log(`Total wall time: ${totalMs}ms\n`);
  console.log("Attempts:");
  for (const a of out.attempts) {
    if (a.error) {
      console.log(
        `  Tier ${a.tier} (${a.durationMs}ms) — FAIL: ${a.error.kind}${
          "reason" in a.error ? ` (${a.error.reason})` : ""
        }${"message" in a.error ? ` (${a.error.message})` : ""}${
          "status" in a.error ? ` HTTP ${a.error.status}` : ""
        }${"contentType" in a.error ? ` ct=${a.error.contentType}` : ""}`,
      );
    } else {
      console.log(`  Tier ${a.tier} (${a.durationMs}ms) — OK`);
    }
  }

  if (out.result) {
    const r = out.result;
    console.log(`\n=== RESULT ===`);
    console.log(`Tier:        ${r.tier}`);
    console.log(`Hostname:    ${r.hostname}`);
    console.log(`Final URL:   ${r.finalUrl}`);
    console.log(`Size:        ${(r.sizeBytes / 1024).toFixed(1)} KB`);
    console.log(`Rendered:    ${r.rendered}`);
    console.log(`Duration:    ${r.durationMs}ms`);
    const head = r.html.slice(0, 200).replace(/\s+/g, " ");
    console.log(`HTML[0..200]: ${head}${r.html.length > 200 ? "…" : ""}`);
  } else if (out.finalError) {
    console.log(`\n=== FINAL ERROR ===`);
    console.log(JSON.stringify(out.finalError, null, 2));
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
