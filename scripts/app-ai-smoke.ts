// One REAL call to Fireworks through the AI gateway, with no database (spec
// local 2026-10-15, 5): the taquería order, once whole and once streamed.
// Prints what came back and what it would have cost. ~$0.001.
//
// Run with ONLY the Fireworks key (never --env-file=.env.local: its
// DATABASE_URL is production):
//   FIREWORKS_API_KEY=… node ../../../node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.eval.json scripts/app-ai-smoke.ts

import { createFireworksStreamClient } from "../lib/ai/fireworks-stream-client";
import { hashSecretKey } from "../lib/backend/keys";
import { ConcurrencyLimiter } from "../lib/functions/concurrency";
import { WindowLimiter } from "../lib/functions/window-limiter";
import { creditRateForRole, roleForOperation } from "../lib/generation/model-policy";
import { CapReservations } from "../lib/app-ai/cap";
import { FreeDailyPool } from "../lib/app-ai/free-pool";
import { handleAppAiRequest, type AppAiDeps } from "../lib/app-ai/gateway";
import { memoryAppAiStore } from "../lib/app-ai/store";

const SECRET = "sb_secret_smoketestsmoketestsmoke";
const fireworks = createFireworksStreamClient();
let balance = 100_000;
const store = memoryAppAiStore();

const deps: AppAiDeps = {
  enabled: () => true,
  resolve: async () => ({ projectId: "smoke", environment: "draft", secretKeyHash: hashSecretKey(SECRET) }),
  blocked: async () => false,
  ownerOf: async () => "smoke-owner",
  wallet: {
    state: async () => ({ plan: "pro", allotment: 30_000 }),
    debitIfEnough: async (_u, n) => (balance >= n ? ((balance -= n), true) : false),
    debit: async (_u, n) => void (balance = Math.max(0, balance - n)),
    refund: async (_u, n) => void (balance += n),
  },
  store,
  reservations: new CapReservations(),
  concurrency: new ConcurrencyLimiter(),
  rate: new WindowLimiter(),
  freePool: new FreeDailyPool(20_000),
  upstream: ({ request, requestId, signal }) =>
    fireworks.stream(
      { messages: request.messages, maxOutputTokens: request.maxTokens, temperature: request.temperature, requestId, operation: request.model.operation, jsonObject: request.jsonObject },
      { signal },
    ),
  rateFor: (m) => creditRateForRole(roleForOperation(m.operation)),
  alerts: { cap: (a) => console.log("cap alert", a), freePool: (a) => console.log("pool alert", a) },
  now: () => new Date(),
};

const ORDER = {
  model: "openlen-fast",
  messages: [
    { role: "system", content: 'Turn the order into JSON: {"items":[{"product":string,"quantity":number,"notes":string}]}' },
    { role: "user", content: "dos de pastor sin cebolla y una horchata grande, paso en 20 min" },
  ],
  response_format: { type: "json_object" },
  max_tokens: 300,
};

const call = (body: unknown) =>
  handleAppAiRequest(
    new Request("https://smoke.openlen.app/ai/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
    deps,
  );

async function main() {
  const whole = await call(ORDER);
  console.log("whole:", whole.status, JSON.stringify(await whole.json(), null, 2));
  const streamed = await call({ ...ORDER, stream: true, stream_options: { include_usage: true } });
  console.log("stream:", streamed.status, await streamed.text());
  const spent = await store.monthSpent("smoke-owner", new Date().toISOString().slice(0, 7));
  console.log(`charged: ${spent} centicredits = $${(spent / 10_000).toFixed(4)}; balance back: ${balance === 100_000 - spent}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
