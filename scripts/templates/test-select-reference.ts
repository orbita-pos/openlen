// Smoke test for the brief → reference-template selector (Quality S2).
//
// Prints, for ~10 hand-crafted briefs across distinct verticals, the family
// the classifier landed on (always — pure, no DB) and the template id that
// selectReferenceTemplate resolved to (best-effort — needs DB + captured
// screenshots). Eyeball that each brief lands on a plausible family; tweak
// the keyword lists in lib/templates/select-reference.ts if one is wrong.
//
//   npm run templates:test-select-reference

import {
  classifyBriefFamily,
  selectReferenceTemplate,
} from "@/lib/templates/select-reference";

const BRIEFS: { label: string; brief: string }[] = [
  { label: "SaaS", brief: "Pulsegrid — a B2B analytics dashboard that turns product telemetry into churn-risk metrics for SaaS teams." },
  { label: "portfolio", brief: "Portafolio de Mariana Vásquez, fotógrafa de bodas y retrato editorial en Lima. Galería de su trabajo y proceso." },
  { label: "restaurant", brief: "Trattoria Niccolò — auténtica cocina italiana de Bolonia, pasta fresca y carta de vinos. Reserva tu mesa." },
  { label: "agency", brief: "Halcyon is a creative branding and design agency building identity systems for ambitious startups." },
  { label: "ecommerce", brief: "Loomwell — direct-to-consumer online store selling handwoven merino blankets. Shop the collection, free shipping." },
  { label: "fitness", brief: "IronTide gym and personal training studio — strength workouts, nutrition coaching, and a wellness membership." },
  { label: "fintech", brief: "Vaulta is a neobank for freelancers: instant payments, automated tax set-aside, and a virtual wallet." },
  { label: "podcast", brief: "Signal & Static — a weekly podcast about indie music. Listen to episodes, meet the hosts, subscribe." },
  { label: "conference", brief: "ShipConf 2026 — a two-day developer conference with keynote speakers, workshops, and a hackathon. Get tickets." },
  { label: "real estate", brief: "Cobalt Realty — boutique real estate brokerage. Browse property listings, book a viewing with an agent." },
];

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("Brief → family classification (pure):\n");
  for (const { label, brief } of BRIEFS) {
    const c = classifyBriefFamily(brief);
    const top = c.ranking
      .map((r) => `${r.family}:${r.score}`)
      .join("  ");
    // eslint-disable-next-line no-console
    console.log(
      `  ${label.padEnd(13)} → ${(c.family ?? "(none)").padEnd(16)} [${top}]`,
    );
  }

  // eslint-disable-next-line no-console
  console.log("\nResolved reference template (DB + screenshots):\n");
  for (const { label, brief } of BRIEFS) {
    try {
      const ref = await selectReferenceTemplate(brief);
      // eslint-disable-next-line no-console
      console.log(
        `  ${label.padEnd(13)} → ${
          ref ? `${ref.id} (${ref.family})` : "(null — no screenshot available)"
        }`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.log(`  ${label.padEnd(13)} → DB error: ${msg}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
