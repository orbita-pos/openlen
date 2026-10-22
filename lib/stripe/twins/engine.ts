// lib/stripe/twins/engine.ts — PUBLISHING COPIES THE PROJECT'S STRIPE TO LIVE MODE
// (spec local 2026-10-21-stripe-integration, §6.4). What the project uses in test
// mode —what Len made with the `stripe` command, plus the ids and test payment
// links the published files name— gets a live-mode twin:
//   · a product, with the SAME id (or a new one if live mode refuses it);
//   · a price, found in live by its lookup key with the same terms, or created
//     (moving the lookup key to it);
//   · a payment link, a shipping rate or a portal configuration, created with
//     its references translated; if the test one changed, a new one and the old
//     one deactivated;
//   · a webhook endpoint of a draft function, at that function's live URL, with
//     its signing secret saved for the published site.
// What is copied is remembered (a twin, with the fingerprint of the test object),
// so publishing again creates nothing; every write carries an idempotency key
// made of the test id and that fingerprint, so a retry after a failure doesn't
// duplicate. `planTwins` walks the same way reading only, to say beforehand what
// will happen; `applyTwins` writes.

import { createHash } from "node:crypto";

import { encodeStripeParams, StripeApiError, stripeRequest, type StripeFetch } from "../api";
import type { StripeObjectKind, StripeObjectRow, StripeStore } from "../store";
import { findStripeRefs, kindOfId } from "./discover";
import type { TwinMap } from "./swap";

export interface TwinsPlanCounts {
  readonly products: number;
  readonly prices: number;
  readonly paymentLinks: number;
  readonly shippingRates: number;
  readonly portalConfigurations: number;
  readonly webhookEndpoints: number;
}

export interface TwinsPlan {
  /** What will be created or updated in live mode. */
  readonly create: TwinsPlanCounts;
  /** Test refs in the published texts that will be replaced by their live twin. */
  readonly swaps: number;
  /** Refs the files name that exist neither in test nor in live mode. */
  readonly unknownRefs: readonly string[];
  readonly chargesEnabled: boolean | null;
  readonly needsWrites: boolean;
  /** Product images only reachable from the canvas, left out of the live copy. */
  readonly droppedImages: number;
}

export interface TwinsDeps {
  readonly store: StripeStore;
  readonly testKey: string;
  readonly liveKey: string;
  /** "https://<ref>.<host>/functions/v1/" of the draft and of the published site. */
  readonly functionUrls: { readonly draft: string; readonly live: string };
  /** The functions in the live bundle: an endpoint of any other one is not copied. */
  readonly liveFunctions: readonly string[];
  /** The canvas's host (lib/lienzo/host.ts): images there aren't public. */
  readonly canvasHost: string | null;
  readonly f?: StripeFetch;
}

type Obj = Record<string, unknown>;
type Mode = "test" | "live";

const COLLECTION: Readonly<Record<StripeObjectKind, string>> = {
  product: "/v1/products",
  price: "/v1/prices",
  payment_link: "/v1/payment_links",
  shipping_rate: "/v1/shipping_rates",
  portal_configuration: "/v1/billing_portal/configurations",
  webhook_endpoint: "/v1/webhook_endpoints",
};

const ORDER: readonly StripeObjectKind[] = ["product", "price", "shipping_rate", "payment_link", "portal_configuration", "webhook_endpoint"];

const COUNT_KEY: Readonly<Record<StripeObjectKind, keyof TwinsPlanCounts>> = {
  product: "products",
  price: "prices",
  payment_link: "paymentLinks",
  shipping_rate: "shippingRates",
  portal_configuration: "portalConfigurations",
  webhook_endpoint: "webhookEndpoints",
};

const PENDING = "pending:";
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const idOf = (v: unknown): string | null => (typeof v === "string" ? v : isObj(v) && typeof v.id === "string" ? v.id : null);

/** Only the fields that are set (null, undefined and empty objects are left out). */
function defined(o: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue;
    if (isObj(v)) {
      const inner = defined(v);
      if (Object.keys(inner).length > 0) out[k] = inner;
      continue;
    }
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

function pick(o: Obj, keys: readonly string[]): Obj {
  return Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const fingerprintOf = (v: unknown) => createHash("sha256").update(stable(v)).digest("hex").slice(0, 32);

class Walk {
  readonly counts: Record<keyof TwinsPlanCounts, number> = { products: 0, prices: 0, paymentLinks: 0, shippingRates: 0, portalConfigurations: 0, webhookEndpoints: 0 };
  readonly unknown: string[] = [];
  dropped = 0;
  private readonly memo = new Map<string, Promise<string | null>>();
  private readonly testCache = new Map<string, Promise<Obj | null>>();
  readonly rows = new Map<string, StripeObjectRow>();

  constructor(
    readonly projectId: string,
    readonly d: TwinsDeps,
    readonly write: boolean,
    readonly saveLiveSecret: ((name: string, value: string) => Promise<void>) | null,
  ) {}

  private key(mode: Mode) {
    return mode === "test" ? this.d.testKey : this.d.liveKey;
  }

  async call(mode: Mode, method: "GET" | "POST", path: string, params?: Obj, idempotencyKey?: string): Promise<Obj | null> {
    const form = params ? encodeStripeParams(params) : undefined;
    const r = await stripeRequest(this.key(mode), { method, path, ...(form ? { form } : {}), ...(idempotencyKey ? { idempotencyKey: idempotencyKey.slice(0, 255) } : {}) }, this.d.f);
    if (r.status === 404 && method === "GET") return null;
    if (r.status < 200 || r.status >= 300) throw new StripeApiError(r.status, r.json, r.requestId);
    return isObj(r.json) ? r.json : {};
  }

  getTest(kind: StripeObjectKind, id: string): Promise<Obj | null> {
    const k = `${kind}:${id}`;
    let p = this.testCache.get(k);
    if (!p) this.testCache.set(k, (p = this.call("test", "GET", `${COLLECTION[kind]}/${encodeURIComponent(id)}`)));
    return p;
  }

  async record(kind: StripeObjectKind, testId: string, extra: { testUrl?: string; lookupKey?: string } = {}): Promise<void> {
    if (this.rows.has(testId)) return;
    if (this.write) {
      await this.d.store.recordTestObject({ projectId: this.projectId, kind, testId, source: "files", ...extra });
      const row = (await this.d.store.listObjects(this.projectId)).find((r) => r.testId === testId);
      if (row) this.rows.set(testId, row);
    } else {
      this.rows.set(testId, { projectId: this.projectId, kind, testId, testUrl: extra.testUrl ?? null, lookupKey: extra.lookupKey ?? null, functionName: null, secretName: null, source: "files", liveId: null, liveUrl: null, fingerprint: null, createdAt: new Date(), syncedAt: null });
    }
  }

  private async twin(row: StripeObjectRow, liveId: string, fingerprint: string, liveUrl?: string | null): Promise<void> {
    const next = { ...row, liveId, liveUrl: liveUrl ?? null, fingerprint };
    this.rows.set(row.testId, next);
    if (this.write) await this.d.store.setTwin(this.projectId, row.testId, { liveId, liveUrl: liveUrl ?? null, fingerprint });
  }

  private idem(testId: string, fp: string, step = "") {
    return `openlen-${this.projectId}-${testId}-${fp}${step}`;
  }

  /** The live id of a test object, copying it (and what it needs) first. null = nothing to copy. */
  ensure(kind: StripeObjectKind, testId: string): Promise<string | null> {
    let p = this.memo.get(testId);
    if (!p) this.memo.set(testId, (p = this.copy(kind, testId)));
    return p;
  }

  private async copy(kind: StripeObjectKind, testId: string): Promise<string | null> {
    const test = await this.getTest(kind, testId);
    const known = this.rows.get(testId);
    if (!test) return known?.liveId ?? null;
    if (!known) await this.record(kind, testId, kind === "payment_link" && typeof test.url === "string" ? { testUrl: test.url } : {});
    const row = this.rows.get(testId)!;
    switch (kind) {
      case "product":
        return this.product(row, test);
      case "price":
        return this.price(row, test);
      case "shipping_rate":
        return this.recreatable(row, kind, this.shippingRateFields(test), async (f) => f);
      case "payment_link":
        return this.paymentLink(row, test);
      case "portal_configuration":
        return this.portalConfiguration(row, test);
      case "webhook_endpoint":
        return this.webhookEndpoint(row, test);
    }
  }

  private count(kind: StripeObjectKind) {
    this.counts[COUNT_KEY[kind]]++;
  }

  private publicImages(images: unknown): string[] {
    const list = Array.isArray(images) ? images.filter((i): i is string => typeof i === "string") : [];
    const ok = list.filter((u) => {
      try {
        const h = new URL(u).hostname;
        return u.startsWith("https://") && !(this.d.canvasHost && (h === this.d.canvasHost || h.endsWith(`.${this.d.canvasHost}`))) && h !== "localhost";
      } catch {
        return false;
      }
    });
    this.dropped += list.length - ok.length;
    return ok;
  }

  private async product(row: StripeObjectRow, test: Obj): Promise<string | null> {
    const fields = defined({ ...pick(test, ["name", "description", "active", "metadata", "unit_label", "url", "tax_code", "shippable", "statement_descriptor"]), images: test.images });
    const fp = fingerprintOf(fields);
    if (row.liveId && row.fingerprint === fp) return row.liveId;
    const images = this.publicImages(test.images);
    const live = defined({ ...fields, images });
    this.count("product");
    if (!this.write) return row.liveId ?? row.testId;
    if (row.liveId) {
      await this.call("live", "POST", `/v1/products/${encodeURIComponent(row.liveId)}`, live, this.idem(row.testId, fp, "-update"));
      await this.twin(row, row.liveId, fp);
      return row.liveId;
    }
    try {
      const made = await this.call("live", "POST", "/v1/products", { id: row.testId, ...live }, this.idem(row.testId, fp));
      const id = idOf(made) ?? row.testId;
      await this.twin(row, id, fp);
      return id;
    } catch (e) {
      if (e instanceof StripeApiError && e.code === "resource_already_exists") {
        await this.call("live", "POST", `/v1/products/${encodeURIComponent(row.testId)}`, live, this.idem(row.testId, fp, "-update"));
        await this.twin(row, row.testId, fp);
        return row.testId;
      }
      if (e instanceof StripeApiError && e.status === 400 && /\bid\b/i.test(e.message)) {
        const made = await this.call("live", "POST", "/v1/products", live, this.idem(row.testId, fp, "-newid"));
        const id = idOf(made)!;
        await this.twin(row, id, fp);
        return id;
      }
      throw e;
    }
  }

  private async price(row: StripeObjectRow, test: Obj): Promise<string | null> {
    const productTest = idOf(test.product);
    const liveProduct = productTest ? await this.ensure("product", productTest) : null;
    const recurring = isObj(test.recurring) ? defined(pick(test.recurring, ["interval", "interval_count"])) : null;
    const terms = defined({ currency: test.currency, unit_amount: test.unit_amount, custom_unit_amount: isObj(test.custom_unit_amount) ? pick(test.custom_unit_amount, ["enabled", "maximum", "minimum", "preset"]) : null, recurring, tax_behavior: test.tax_behavior });
    const mutable = defined(pick(test, ["active", "nickname", "metadata", "lookup_key"]));
    const fp = fingerprintOf({ product: productTest, terms, mutable });
    if (row.liveId && row.fingerprint === fp) return row.liveId;
    const lookupKey = typeof test.lookup_key === "string" ? test.lookup_key : null;
    if (row.liveId) {
      this.count("price");
      if (!this.write) return row.liveId;
      await this.call("live", "POST", `/v1/prices/${encodeURIComponent(row.liveId)}`, { ...mutable, ...(lookupKey ? { transfer_lookup_key: true } : {}) }, this.idem(row.testId, fp, "-update"));
      await this.twin(row, row.liveId, fp);
      return row.liveId;
    }
    if (lookupKey && liveProduct && !liveProduct.startsWith(PENDING)) {
      const list = await this.call("live", "GET", "/v1/prices", { "lookup_keys[]": lookupKey, active: true, limit: 1 });
      const found = Array.isArray(list?.data) ? (list.data as Obj[])[0] : undefined;
      if (found && idOf(found.product) === liveProduct && sameTerms(found, terms)) {
        if (this.write) await this.twin(row, String(found.id), fp);
        return String(found.id);
      }
    }
    this.count("price");
    if (!this.write) return `${PENDING}${row.testId}`;
    const made = await this.call("live", "POST", "/v1/prices", { product: liveProduct, ...terms, ...mutable, ...(lookupKey ? { transfer_lookup_key: true } : {}) }, this.idem(row.testId, fp));
    const id = idOf(made)!;
    await this.twin(row, id, fp);
    return id;
  }

  private shippingRateFields(test: Obj): Obj {
    return defined({
      ...pick(test, ["display_name", "type", "tax_behavior", "tax_code", "metadata", "active"]),
      fixed_amount: isObj(test.fixed_amount) ? pick(test.fixed_amount, ["amount", "currency"]) : null,
      delivery_estimate: test.delivery_estimate,
    });
  }

  /** Objects whose copy is replaced when the test one changes: a new live one, the old one deactivated. */
  private async recreatable(row: StripeObjectRow, kind: StripeObjectKind, testFields: Obj, toLive: (f: Obj) => Promise<Obj>): Promise<string | null> {
    const fp = fingerprintOf(testFields);
    if (row.liveId && row.fingerprint === fp) return row.liveId;
    this.count(kind);
    const live = await toLive(testFields);
    if (!this.write) return row.liveId ?? `${PENDING}${row.testId}`;
    const made = await this.call("live", "POST", COLLECTION[kind], live, this.idem(row.testId, fp));
    const id = idOf(made)!;
    const url = typeof made?.url === "string" ? made.url : null;
    if (row.liveId && row.liveId !== id) {
      await this.call("live", "POST", `${COLLECTION[kind]}/${encodeURIComponent(row.liveId)}`, { active: false }, this.idem(row.testId, fp, "-off"));
    }
    await this.twin(row, id, fp, url);
    return id;
  }

  private async paymentLink(row: StripeObjectRow, test: Obj): Promise<string | null> {
    const items = await this.call("test", "GET", `/v1/payment_links/${encodeURIComponent(row.testId)}/line_items`, { limit: 100 });
    const lineItems = (Array.isArray(items?.data) ? (items.data as Obj[]) : []).map((li) => ({ price: idOf(li.price), quantity: li.quantity }));
    const shippingOptions = Array.isArray(test.shipping_options) ? (test.shipping_options as Obj[]).map((s) => ({ shipping_rate: idOf(s.shipping_rate) })) : [];
    const fields = defined({
      line_items: lineItems,
      shipping_options: shippingOptions,
      after_completion: test.after_completion,
      allow_promotion_codes: test.allow_promotion_codes,
      automatic_tax: isObj(test.automatic_tax) ? { enabled: test.automatic_tax.enabled } : null,
      billing_address_collection: test.billing_address_collection,
      customer_creation: test.customer_creation,
      metadata: test.metadata,
      phone_number_collection: isObj(test.phone_number_collection) ? { enabled: test.phone_number_collection.enabled } : null,
      shipping_address_collection: isObj(test.shipping_address_collection) ? { allowed_countries: test.shipping_address_collection.allowed_countries } : null,
      submit_type: test.submit_type,
      subscription_data: isObj(test.subscription_data) && test.subscription_data.trial_period_days ? { trial_period_days: test.subscription_data.trial_period_days } : null,
      tax_id_collection: isObj(test.tax_id_collection) ? { enabled: test.tax_id_collection.enabled } : null,
      payment_method_collection: test.payment_method_collection,
      custom_fields: test.custom_fields,
    });
    return this.recreatable(row, "payment_link", fields, async (f) => ({
      ...f,
      line_items: await Promise.all(lineItems.map(async (li) => ({ price: li.price ? await this.ensure("price", li.price) : null, quantity: li.quantity }))),
      ...(shippingOptions.length > 0
        ? { shipping_options: await Promise.all(shippingOptions.map(async (s) => ({ shipping_rate: s.shipping_rate ? await this.ensure("shipping_rate", s.shipping_rate) : null }))) }
        : {}),
    }));
  }

  private async portalConfiguration(row: StripeObjectRow, test: Obj): Promise<string | null> {
    const features = isObj(test.features) ? test.features : {};
    const update = isObj(features.subscription_update) ? features.subscription_update : null;
    const fields = defined({
      business_profile: isObj(test.business_profile) ? pick(test.business_profile, ["headline", "privacy_policy_url", "terms_of_service_url"]) : null,
      default_return_url: test.default_return_url,
      login_page: isObj(test.login_page) ? { enabled: test.login_page.enabled } : null,
      metadata: test.metadata,
      features: {
        customer_update: isObj(features.customer_update) ? pick(features.customer_update, ["enabled", "allowed_updates"]) : null,
        invoice_history: isObj(features.invoice_history) ? pick(features.invoice_history, ["enabled"]) : null,
        payment_method_update: isObj(features.payment_method_update) ? pick(features.payment_method_update, ["enabled"]) : null,
        subscription_cancel: isObj(features.subscription_cancel) ? pick(features.subscription_cancel, ["enabled", "mode", "proration_behavior"]) : null,
        subscription_update: update
          ? {
              ...pick(update, ["enabled", "default_allowed_updates", "proration_behavior"]),
              products: Array.isArray(update.products) ? (update.products as Obj[]).map((p) => ({ product: idOf(p.product), prices: Array.isArray(p.prices) ? p.prices.map(idOf) : [] })) : null,
            }
          : null,
      },
    });
    return this.recreatable(row, "portal_configuration", fields, async (f) => {
      const feats = isObj(f.features) ? f.features : {};
      const up = isObj(feats.subscription_update) ? feats.subscription_update : null;
      if (!up || !Array.isArray(up.products)) return f;
      const products = await Promise.all(
        (up.products as Obj[]).map(async (p) => ({
          product: await this.ensure("product", String(p.product)),
          prices: await Promise.all((Array.isArray(p.prices) ? p.prices : []).map((pr) => this.ensure("price", String(pr)))),
        })),
      );
      return { ...f, features: { ...feats, subscription_update: { ...up, products } } };
    });
  }

  private async webhookEndpoint(row: StripeObjectRow, test: Obj): Promise<string | null> {
    const url = typeof test.url === "string" ? test.url : row.testUrl ?? "";
    if (!url.startsWith(this.d.functionUrls.draft)) return null;
    const fn = url.slice(this.d.functionUrls.draft.length).split(/[/?#]/)[0] ?? "";
    if (!fn || !this.d.liveFunctions.includes(fn)) return null;
    const events = Array.isArray(test.enabled_events) ? [...(test.enabled_events as string[])].sort() : [];
    const disabled = test.status === "disabled";
    const fp = fingerprintOf({ fn, events, disabled, api_version: test.api_version ?? null });
    if (row.liveId && row.fingerprint === fp) return row.liveId;
    this.count("webhook_endpoint");
    if (!this.write) return row.liveId ?? `${PENDING}${row.testId}`;
    const liveUrl = `${this.d.functionUrls.live}${fn}`;
    if (row.liveId) {
      await this.call("live", "POST", `/v1/webhook_endpoints/${encodeURIComponent(row.liveId)}`, { url: liveUrl, enabled_events: events, disabled }, this.idem(row.testId, fp, "-update"));
      await this.twin(row, row.liveId, fp);
      return row.liveId;
    }
    const made = await this.call(
      "live",
      "POST",
      "/v1/webhook_endpoints",
      defined({ url: liveUrl, enabled_events: events, api_version: test.api_version, description: test.description }),
      this.idem(row.testId, fp),
    );
    const id = idOf(made)!;
    if (typeof made?.secret === "string" && this.saveLiveSecret) await this.saveLiveSecret(row.secretName ?? "STRIPE_WEBHOOK_SECRET", made.secret);
    if (disabled) await this.call("live", "POST", `/v1/webhook_endpoints/${encodeURIComponent(id)}`, { disabled: true }, this.idem(row.testId, fp, "-off"));
    await this.twin(row, id, fp);
    return id;
  }

  /** The test payment link behind a URL in the files. */
  async linkByUrl(url: string): Promise<Obj | null> {
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const list = await this.call("test", "GET", "/v1/payment_links", { limit: 100, ...(after ? { starting_after: after } : {}) });
      const data = Array.isArray(list?.data) ? (list.data as Obj[]) : [];
      const hit = data.find((l) => l.url === url);
      if (hit) return hit;
      if (!list?.has_more || data.length === 0) return null;
      after = String(data[data.length - 1]!.id);
    }
    return null;
  }
}

function sameTerms(live: Obj, terms: Obj): boolean {
  const r = isObj(live.recurring) ? defined(pick(live.recurring, ["interval", "interval_count"])) : null;
  return live.currency === terms.currency && (live.unit_amount ?? null) === (terms.unit_amount ?? null) && stable(r) === stable(terms.recurring ?? null);
}

async function walk(projectId: string, texts: readonly string[], d: TwinsDeps, write: boolean, saveLiveSecret: ((name: string, value: string) => Promise<void>) | null): Promise<{ w: Walk; refs: { ids: ReadonlySet<string>; links: ReadonlySet<string> } }> {
  const w = new Walk(projectId, d, write, saveLiveSecret);
  for (const r of await d.store.listObjects(projectId)) w.rows.set(r.testId, r);
  const refs = findStripeRefs(texts);
  const byUrl = new Map([...w.rows.values()].filter((r) => r.testUrl).map((r) => [r.testUrl!, r]));
  const todo: [StripeObjectKind, string][] = [];
  for (const link of refs.links) {
    const known = byUrl.get(link);
    if (known) continue;
    const found = await w.linkByUrl(link);
    if (!found) {
      w.unknown.push(link);
      continue;
    }
    await w.record("payment_link", String(found.id), { testUrl: link });
    todo.push(["payment_link", String(found.id)]);
  }
  for (const id of refs.ids) {
    if (w.rows.has(id)) continue;
    const kind = kindOfId(id);
    if (!kind) continue;
    if (await w.getTest(kind, id)) {
      await w.record(kind, id);
      todo.push([kind, id]);
      continue;
    }
    if (!(await w.call("live", "GET", `${COLLECTION[kind]}/${encodeURIComponent(id)}`))) w.unknown.push(id);
  }
  const all: [StripeObjectKind, string][] = [...[...w.rows.values()].map((r) => [r.kind, r.testId] as [StripeObjectKind, string]), ...todo];
  for (const kind of ORDER) {
    for (const [k, id] of all) if (k === kind) await w.ensure(k, id);
  }
  return { w, refs };
}

async function chargesEnabled(projectId: string, d: TwinsDeps): Promise<boolean | null> {
  const row = await d.store.getAccount(projectId, "live");
  if (row && row.chargesEnabled !== null) return row.chargesEnabled;
  try {
    const r = await stripeRequest(d.liveKey, { method: "GET", path: "/v1/account" }, d.f);
    const v = isObj(r.json) ? r.json.charges_enabled : undefined;
    return typeof v === "boolean" ? v : null;
  } catch {
    return null;
  }
}

export async function planTwins(projectId: string, texts: readonly string[], d: TwinsDeps): Promise<TwinsPlan> {
  const { w, refs } = await walk(projectId, texts, d, false, null);
  let swaps = 0;
  const byUrl = new Map([...w.rows.values()].filter((r) => r.testUrl).map((r) => [r.testUrl!, r]));
  for (const id of refs.ids) {
    const r = w.rows.get(id);
    if (r && r.kind !== "product") swaps++;
    else if (r && r.liveId && r.liveId !== id) swaps++;
  }
  for (const link of refs.links) if (byUrl.has(link)) swaps++;
  const needsWrites = Object.values(w.counts).some((n) => n > 0);
  return { create: { ...w.counts }, swaps, unknownRefs: w.unknown, chargesEnabled: await chargesEnabled(projectId, d), needsWrites, droppedImages: w.dropped };
}

export async function applyTwins(projectId: string, texts: readonly string[], d: TwinsDeps, saveLiveSecret: (name: string, value: string) => Promise<void>): Promise<TwinMap> {
  const { w } = await walk(projectId, texts, d, true, saveLiveSecret);
  const map = new Map<string, string>();
  for (const r of w.rows.values()) {
    if (!r.liveId) continue;
    if (r.liveId !== r.testId) map.set(r.testId, r.liveId);
    if (r.kind === "payment_link" && r.testUrl && r.liveUrl) map.set(r.testUrl, r.liveUrl);
  }
  return map;
}
