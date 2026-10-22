// The domains of the project email (spec local 2026-10-22-email-integration, 6.1).
// Run by openlen-email-domains.timer every 15 min: checks the domains waiting for
// their DNS (the ready ones once a day) and keeps the sending log to 30 days.
// Short-lived: connect → check → exit. Does nothing with the email off.
//
// Run locally: npm run email:domains-check

import { runEmailDomainsCheck } from "@/lib/project-email/check-job";
import { checkDomain } from "@/lib/project-email/domain";
import { emailEnabledIn } from "@/lib/project-email/enabled";
import { realDomainDeps } from "@/lib/project-email/real";

async function main() {
  if (!emailEnabledIn()) {
    console.log("email off (OPENLEN_EMAIL=0 or no RESEND_CLIENTS_API_KEY): nothing to check");
    process.exit(0);
  }
  const deps = realDomainDeps();
  const r = await runEmailDomainsCheck({
    store: deps.store,
    check: (projectId) => checkDomain(projectId, deps),
    now: () => new Date(),
    pause: (ms) => new Promise((done) => setTimeout(done, ms)),
  });
  console.log("email domains:", r);
  process.exit(0);
}

main().catch((e) => {
  console.error("email domains check failed", e);
  process.exit(1);
});
