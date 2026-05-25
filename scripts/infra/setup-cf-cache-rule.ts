// Idempotently provision the Cloudflare Cache Rule that makes the marketing
// homepage cacheable at the CF edge. Without this rule CF returns
// `cf-cache-status: DYNAMIC` for HTML responses regardless of the
// Cache-Control header the origin sends — CF doesn't cache HTML by default
// even with explicit s-maxage. The rule below tells CF to honour the
// origin's caching intent for the apex landing page.
//
// Required env (from infra/.env.production):
//   CLOUDFLARE_API_TOKEN  — Zone API token with `Cache Rules → Edit`
//   CLOUDFLARE_ZONE_ID    — the zone id for openlen.com
//
// Run: npx tsx --env-file=infra/.env.production scripts/infra/setup-cf-cache-rule.ts
//
// Re-runs are safe: the script writes the WHOLE cache_settings ruleset, so
// the rule list converges to whatever this script defines (no duplicates,
// no orphan rules left over from manual edits).

const TOKEN = process.env.CLOUDFLARE_API_TOKEN?.trim();
const ZONE_ID = process.env.CLOUDFLARE_ZONE_ID?.trim();

if (!TOKEN || !ZONE_ID) {
  // eslint-disable-next-line no-console
  console.error(
    "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID. Run with --env-file=infra/.env.production.",
  );
  process.exit(2);
}

const API = "https://api.cloudflare.com/client/v4";

interface CfResponse<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
  result: T;
}

async function cf<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as CfResponse<T>;
  if (!res.ok || !json.success) {
    const msg = (json.errors ?? [])
      .map((e) => `${e.code}: ${e.message}`)
      .join("; ");
    throw new Error(
      `CF API ${method} ${path} failed (${res.status}): ${msg || "(no detail)"}`,
    );
  }
  return json.result;
}

// The rule we want enforced. Lives at the http_request_cache_settings
// phase entrypoint ruleset for the zone. Targets the apex `/` and `/www`
// homepage — every other path falls through to default CF behaviour
// (cache static by extension, no-cache for HTML).
const HOMEPAGE_RULE = {
  name: "Cache marketing homepage HTML at edge",
  description:
    "Origin returns s-maxage=60 (Next ISR). This rule tells CF to actually honour it for the marketing landing — without it CF emits cf-cache-status: DYNAMIC for HTML.",
  expression:
    '(http.host in {"openlen.com" "www.openlen.com"} and http.request.uri.path eq "/")',
  action: "set_cache_settings",
  action_parameters: {
    cache: true,
    edge_ttl: {
      mode: "respect_origin",
    },
    browser_ttl: {
      mode: "respect_origin",
    },
    serve_stale: {
      disable_stale_while_updating: false,
    },
  },
  enabled: true,
};

async function main(): Promise<void> {
  const phase = "http_request_cache_settings";
  // eslint-disable-next-line no-console
  console.log(
    `Provisioning Cache Rule on zone ${ZONE_ID}, phase ${phase}…\n`,
  );

  // PUT replaces the entrypoint ruleset rules list. Idempotent.
  const result = await cf<{
    id: string;
    rules: Array<{ id: string; name: string; expression: string; enabled: boolean }>;
  }>("PUT", `/zones/${ZONE_ID}/rulesets/phases/${phase}/entrypoint`, {
    rules: [HOMEPAGE_RULE],
  });

  // eslint-disable-next-line no-console
  console.log(`✓ Ruleset ${result.id} updated`);
  // eslint-disable-next-line no-console
  console.log(`  Rules now active:`);
  for (const r of result.rules ?? []) {
    // eslint-disable-next-line no-console
    console.log(
      `    [${r.enabled ? "on " : "off"}] ${r.name}\n      expr: ${r.expression}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    `\nTest with: curl -sI https://openlen.com/ | grep cf-cache-status\nFirst hit may be MISS; the second should be HIT.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`FAILED: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
