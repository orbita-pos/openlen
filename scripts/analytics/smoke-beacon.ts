// One-shot smoke test: fire a beacon to /c/<projectId> for the 'inari'
// subdomain, then read back the most-recent row from pageEvents to prove
// the route + collector + DB write are all live.

import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const BOX = "178.156.175.171";

async function main(): Promise<void> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.subdomain, "inari"))
    .limit(1);

  const id = rows[0]?.id;
  if (!id) throw new Error("inari project not found");

  // eslint-disable-next-line no-console
  console.log(`projectId = ${id}`);

  // Fire the beacon via direct host resolution so the request lands on
  // the wildcard subdomain (which is where the snippet would call from).
  const res = await fetch(`https://openlen.com/c/${id}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Spoof CF + a real-looking UA for assertion variety
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "cf-ipcountry": "PE",
    },
    body: JSON.stringify({ t: "v", r: "smoke-test" }),
  });
  // eslint-disable-next-line no-console
  console.log(`POST /c/${id} → ${res.status}`);
  void BOX;

  // Let the insert settle.
  await new Promise((r) => setTimeout(r, 1500));

  const latest = await db
    .select()
    .from(schema.pageEvents)
    .where(eq(schema.pageEvents.projectId, id))
    .orderBy(desc(schema.pageEvents.ts))
    .limit(3);

  // eslint-disable-next-line no-console
  console.log(`\nLatest pageEvents (most-recent 3):`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(latest, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
