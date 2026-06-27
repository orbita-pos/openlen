// Notification queue drainer. Run by openlen-notifications-drain.timer every 1 min.
// Picks up pending notification jobs whose runAfter≤now and delivers them.
// Short-lived: connect → drain → exit. No persistent connection.
//
// Run locally: npm run notifications:drain

import { drainPending } from "@/lib/notifications/dispatch";

async function main() {
  const n = await drainPending(50);
  console.log("notifications drained:", n);
  process.exit(0);
}

main().catch((e) => {
  console.error("drain failed", e);
  process.exit(1);
});
