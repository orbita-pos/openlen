// lib/stripe/twins/fake-stripe.ts — A STRIPE IN MEMORY for the twins' tests: two
// modes (by the key's `sk_test_`/`sk_live_`), the endpoints the copy uses, ids
// like Stripe's, idempotency keys, `lookup_keys[]` and `transfer_lookup_key`,
// and a way to fail the Nth write. Not a test file: the tests import it.

type Obj = Record<string, unknown> & { id: string; object: string };

interface Mode {
  readonly objects: Map<string, Obj>;
  readonly idempotent: Map<string, { status: number; body: unknown }>;
}

export interface FakeStripe {
  readonly fetch: typeof fetch;
  /** Every request: "<mode> <METHOD> <path>". */
  readonly calls: string[];
  /** Writes (POST/DELETE) in live mode. */
  liveWrites(): number;
  get(mode: "test" | "live", id: string): Obj | undefined;
  all(mode: "test" | "live", object: string): Obj[];
  /** Puts an object in a mode, as if made in the dashboard. */
  seed(mode: "test" | "live", obj: Obj): Obj;
  /** The next writes answer 429 starting at write number `n` (1-based, both modes), `count` times. */
  failWrite(n: number, count?: number): void;
  account: { test: Record<string, unknown>; live: Record<string, unknown> };
}

const PREFIX: Readonly<Record<string, string>> = {
  product: "prod_",
  price: "price_",
  payment_link: "plink_",
  shipping_rate: "shr_",
  "billing_portal.configuration": "bpc_",
  webhook_endpoint: "we_",
};
const COLLECTION: Readonly<Record<string, string>> = {
  products: "product",
  prices: "price",
  payment_links: "payment_link",
  shipping_rates: "shipping_rate",
  "billing_portal/configurations": "billing_portal.configuration",
  webhook_endpoints: "webhook_endpoint",
};

/** Form body → nested object (`a[b][0][c]=v`). Numbers stay strings, like Stripe's own parsing would see them. */
export function parseForm(body: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of body.split("&").filter(Boolean)) {
    const [rawK, rawV = ""] = pair.split("=");
    const k = decodeURIComponent(rawK!.replace(/\+/g, " "));
    const v = decodeURIComponent(rawV.replace(/\+/g, " "));
    const path = k.replace(/\]/g, "").split("[");
    let node: Record<string, unknown> | unknown[] = out;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i]!;
      const last = i === path.length - 1;
      const nextIsIndex = !last && /^\d*$/.test(path[i + 1]!);
      if (Array.isArray(node)) {
        const idx = seg === "" ? node.length : Number(seg);
        if (last) node[idx] = v;
        else node = (node[idx] ??= nextIsIndex ? [] : {}) as Record<string, unknown> | unknown[];
      } else {
        if (last) node[seg] = v;
        else node = (node[seg] ??= nextIsIndex ? [] : {}) as Record<string, unknown> | unknown[];
      }
    }
  }
  return out;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "request-id": "req_fake" } });
const notFound = (id: string) => json(404, { error: { type: "invalid_request_error", code: "resource_missing", message: `No such object: '${id}'` } });
const num = (v: unknown) => (typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : v);

export function fakeStripe(): FakeStripe {
  const modes: Record<"test" | "live", Mode> = {
    test: { objects: new Map(), idempotent: new Map() },
    live: { objects: new Map(), idempotent: new Map() },
  };
  let counter = 0;
  let writes = 0;
  let failFrom = 0;
  let failCount = 0;
  const calls: string[] = [];
  const account = { test: { id: "acct_fake", charges_enabled: true }, live: { id: "acct_fake", charges_enabled: true } };
  const newId = (object: string, mode: "test" | "live") => `${PREFIX[object] ?? "obj_"}${mode === "test" ? "T" : "L"}${String(++counter).padStart(14, "0")}`;

  function create(mode: "test" | "live", object: string, params: Record<string, unknown>): Response {
    const m = modes[mode];
    const id = typeof params.id === "string" && object === "product" ? params.id : newId(object, mode);
    if (m.objects.has(id)) return json(400, { error: { type: "invalid_request_error", code: "resource_already_exists", message: `Product already exists.` } });
    const { id: _ignored, transfer_lookup_key, ...rest } = params;
    const obj: Obj = { id, object, livemode: mode === "live", active: true, metadata: {}, ...rest };
    if (object === "price") {
      obj.unit_amount = num(obj.unit_amount);
      if (obj.recurring && typeof obj.recurring === "object") {
        const r = obj.recurring as Record<string, unknown>;
        obj.recurring = { interval: r.interval, interval_count: num(r.interval_count ?? "1") };
      } else obj.recurring = null;
      if (typeof obj.lookup_key === "string") {
        const holder = [...m.objects.values()].find((o) => o.object === "price" && o.lookup_key === obj.lookup_key);
        if (holder) {
          if (transfer_lookup_key !== "true") return json(400, { error: { type: "invalid_request_error", message: "lookup_key already in use" } });
          holder.lookup_key = null;
        }
      }
    }
    if (object === "payment_link") {
      obj.url = `https://buy.stripe.com/${mode === "test" ? "test_" : ""}${id.slice(-8)}`;
      obj.line_items_data = obj.line_items;
      delete obj.line_items;
    }
    if (object === "webhook_endpoint") {
      obj.secret = `whsec_${mode}${id}`;
      obj.status = "enabled";
    }
    m.objects.set(id, obj);
    return json(200, obj);
  }

  async function handle(mode: "test" | "live", method: string, path: string, query: URLSearchParams, body: Record<string, unknown>): Promise<Response> {
    const m = modes[mode];
    const parts = path.replace(/^\/v1\//, "").split("/");
    if (path === "/v1/account") return json(200, account[mode]);
    const two = `${parts[0]}/${parts[1]}`;
    const collectionKey = COLLECTION[two] ? two : parts[0]!;
    const object = COLLECTION[collectionKey];
    const rest = collectionKey === two ? parts.slice(2) : parts.slice(1);
    if (!object) return json(404, { error: { message: `Unrecognized request URL (${method}: ${path})` } });
    if (rest.length === 0 && method === "POST") return create(mode, object, body);
    if (rest.length === 0 && method === "GET") {
      let data = [...m.objects.values()].filter((o) => o.object === object);
      const keys = query.getAll("lookup_keys[]");
      if (keys.length) data = data.filter((o) => keys.includes(String(o.lookup_key)));
      if (query.get("active") === "true") data = data.filter((o) => o.active === true);
      return json(200, { object: "list", data, has_more: false });
    }
    const id = rest[0]!;
    const obj = m.objects.get(id);
    if (!obj) return notFound(id);
    if (rest[1] === "line_items" && object === "payment_link") {
      const items = (obj.line_items_data as { price: string; quantity: string }[] | undefined) ?? [];
      return json(200, { object: "list", data: items.map((li) => ({ object: "item", price: m.objects.get(li.price) ?? { id: li.price }, quantity: num(li.quantity) })), has_more: false });
    }
    if (method === "GET") return json(200, obj);
    if (method === "DELETE") {
      m.objects.delete(id);
      return json(200, { id, deleted: true });
    }
    if (method === "POST") {
      Object.assign(obj, body);
      return json(200, obj);
    }
    return json(405, {});
  }

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const mode: "test" | "live" = /_live_/.test(auth) ? "live" : "test";
    calls.push(`${mode} ${method} ${url.pathname}`);
    const write = method !== "GET";
    if (write) {
      writes++;
      if (failFrom && writes >= failFrom && failCount > 0) {
        failCount--;
        return json(429, { error: { type: "rate_limit_error", message: "Too many requests" } });
      }
    }
    const idem = new Headers(init?.headers).get("idempotency-key");
    if (write && idem && modes[mode].idempotent.has(idem)) {
      const prev = modes[mode].idempotent.get(idem)!;
      return json(prev.status, prev.body);
    }
    const body = typeof init?.body === "string" ? parseForm(init.body) : {};
    const res = await handle(mode, method, url.pathname, url.searchParams, body);
    if (write && idem && res.status < 500 && res.status !== 429) {
      modes[mode].idempotent.set(idem, { status: res.status, body: await res.clone().json() });
    }
    return res;
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    calls,
    liveWrites: () => calls.filter((c) => c.startsWith("live ") && !c.startsWith("live GET")).length,
    get: (mode, id) => modes[mode].objects.get(id),
    all: (mode, object) => [...modes[mode].objects.values()].filter((o) => o.object === object),
    seed(mode, obj) {
      const full: Obj = { livemode: mode === "live", active: true, metadata: {}, ...obj };
      modes[mode].objects.set(obj.id, full);
      return full;
    },
    failWrite(n, count = 1) {
      failFrom = n;
      failCount = count;
    },
    account,
  };
}
