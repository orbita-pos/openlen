// Read-only smoke for the Explore seed. Verifies (a) buildShowcaseProjectData's
// real behaviour with the native sanitizer, and (b) that every manifest entry
// resolves to publishable ProjectData — WITHOUT writing anything. The dev DB is
// the same Neon as prod, so the destructive publish path (idempotency, the
// subdomain-cap bypass, feed presence) is proven at the real prod trigger
// instead (run it twice + load /explore), never here.
//
//   npm run explore:seed-smoke
import { buildShowcaseProjectData } from "../lib/community/seed";
import { getTemplate, getTemplateHtml } from "../lib/templates/store";
import { SEED_ENTRIES } from "../lib/community/explore-seed.config";

let failures = 0;
function check(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label}`);
    failures++;
  }
}

async function main() {
  console.log("Part 1 — buildShowcaseProjectData (real sanitize)");
  const normal = buildShowcaseProjectData("Demo", "<h1>Hola</h1>", []);
  check(normal !== null && normal.html.includes("Hola"), "normal HTML → non-null, content preserved");
  check(
    buildShowcaseProjectData("Demo", '<div data-slot-path="a">x</div>', []) === null,
    "data-slot-path editor marker → null (never publishable)",
  );
  const multi = buildShowcaseProjectData("Demo", "<h1>Home</h1>", [
    { slug: "tienda", html: "<h2>Shop</h2>" },
  ]);
  check(Boolean(multi?.pages?.tienda?.html.includes("Shop")), "extra page cloned into pages.<slug>");

  console.log(`\nPart 2 — ${SEED_ENTRIES.length} manifest entries → publishable ProjectData (read-only)`);
  for (const e of SEED_ENTRIES) {
    const tpl = await getTemplate(e.templateId);
    if (!tpl || tpl.status !== "published") {
      check(false, `${e.templateId}: published template exists`);
      continue;
    }
    const html = await getTemplateHtml(e.templateId);
    if (!html) {
      check(false, `${e.templateId}: template HTML fetched`);
      continue;
    }
    const data = buildShowcaseProjectData(tpl.name, html, tpl.pages ?? []);
    check(
      Boolean(data && data.html.length > 0 && data.html.toLowerCase().includes("<meta")),
      `${e.templateId}: builds valid ProjectData with <meta>`,
    );
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
