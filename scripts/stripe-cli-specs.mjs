// Builds lib/stripe/cli/specs.json — the `stripe` command's table of resources —
// from the Stripe CLI's generated sources at ONE pinned commit (spec local
// 2026-10-21-stripe-integration, §6.2). Only the resources Len needs; for each
// operation, its method, path and parameter types. With --fixtures, it also
// copies the `stripe trigger` fixtures OpenLen supports to lib/stripe/cli/fixtures/.
//
// The Stripe CLI is Copyright Stripe, Inc., licensed under the Apache License,
// Version 2.0 (LICENSES/stripe-cli.Apache-2.0.txt). What this writes is derived
// from github.com/stripe/stripe-cli at STRIPE_CLI_COMMIT.
//
// Run: node scripts/stripe-cli-specs.mjs

import { mkdir, writeFile } from "node:fs/promises";

export const STRIPE_CLI_COMMIT = "4501fc5a6e58dacab6a60a089e93317cc7b84861";

const RESOURCES = [
  "products", "prices", "payment_links", "checkout sessions", "customers", "subscriptions", "subscription_items",
  "billing_portal configurations", "billing_portal sessions", "webhook_endpoints", "events", "payment_intents",
  "charges", "invoices", "coupons", "promotion_codes", "shipping_rates", "refunds", "balance", "balance_transactions",
];

export const TRIGGER_EVENTS = [
  "checkout.session.completed", "checkout.session.expired", "payment_intent.succeeded", "payment_intent.payment_failed",
  "charge.refunded", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "invoice.paid", "invoice.payment_failed",
];

const RAW = `https://raw.githubusercontent.com/stripe/stripe-cli/${STRIPE_CLI_COMMIT}`;

async function get(path) {
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.text();
}

function resourceTree(go) {
  const namespaces = new Map();
  for (const m of go.matchAll(/(\w+) := resource\.NewNamespaceCmd\(rootCmd, "([^"]*)"\)/g)) namespaces.set(m[1], m[2]);
  const resources = new Map();
  for (const m of go.matchAll(/(\w+) := resource\.NewResourceCmd\((rootCmd|(\w+)\.Cmd), "([^"]+)"\)/g)) {
    const parent = m[3];
    if (parent && !namespaces.has(parent)) continue; // v2, preview…
    const ns = parent ? namespaces.get(parent) : "";
    resources.set(m[1], ns ? `${ns} ${m[4]}` : m[4]);
  }
  const ops = new Map();
  for (const m of go.matchAll(/resource\.NewOperationCmd\((\w+)\.Cmd, &(\w+), cfg\)/g)) {
    const name = resources.get(m[1]);
    if (!name) continue;
    ops.set(name, [...(ops.get(name) ?? []), m[2]]);
  }
  return ops;
}

function operationSpecs(go) {
  const specs = new Map();
  for (const m of go.matchAll(/var (\w+) = resource\.OperationSpec\{\n([\s\S]*?)\n\}\n/g)) {
    const body = m[2];
    const name = /\tName:\s+"([^"]+)"/.exec(body)?.[1];
    const path = /\tPath:\s+"([^"]+)"/.exec(body)?.[1];
    const method = /\tMethod:\s+"([^"]+)"/.exec(body)?.[1];
    if (!name || !path || !method) continue;
    const params = {};
    for (const p of body.matchAll(/\n\t\t"([^"]+)": \{\n\t\t\tType:\s+"([^"]+)"/g)) params[p[1]] = p[2];
    specs.set(m[1], { name, method, path, params });
  }
  return specs;
}

async function main() {
  const [resourcesGo, specsGo] = await Promise.all([get("pkg/cmd/resources/resources_gen.go"), get("pkg/cmd/resources/specs_gen.go")]);
  const tree = resourceTree(resourcesGo);
  const specs = operationSpecs(specsGo);
  const out = {};
  for (const r of RESOURCES) {
    const vars = tree.get(r);
    if (!vars) throw new Error(`stripe-cli has no resource "${r}" at ${STRIPE_CLI_COMMIT}`);
    out[r] = {};
    for (const v of vars) {
      const s = specs.get(v);
      if (!s) throw new Error(`no spec ${v}`);
      out[r][s.name] = { method: s.method, path: s.path, params: s.params };
    }
  }
  const json = {
    _license: "Derived from github.com/stripe/stripe-cli (Copyright Stripe, Inc., Apache License 2.0, LICENSES/stripe-cli.Apache-2.0.txt) by scripts/stripe-cli-specs.mjs.",
    commit: STRIPE_CLI_COMMIT,
    resources: out,
  };
  await writeFile("lib/stripe/cli/specs.json", `${JSON.stringify(json, null, 1)}\n`);
  console.log(`lib/stripe/cli/specs.json: ${RESOURCES.length} resources from stripe-cli ${STRIPE_CLI_COMMIT.slice(0, 7)}`);

  if (process.argv.includes("--fixtures")) {
    await mkdir("lib/stripe/cli/fixtures", { recursive: true });
    for (const e of TRIGGER_EVENTS) {
      await writeFile(`lib/stripe/cli/fixtures/${e}.json`, await get(`pkg/fixtures/triggers/${e}.json`));
    }
    console.log(`lib/stripe/cli/fixtures/: ${TRIGGER_EVENTS.length} fixtures`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
