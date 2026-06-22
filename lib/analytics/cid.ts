// Session-scoped visitor id ("cid") + first-touch source — the shared bits that
// stamp ONE id across every visitor signal (view / click / form / booking) so
// the Insights funnel can stitch saw → clicked → submitted → booked.
//
// SESSION scope on purpose: the id lives in `sessionStorage`, so it's gone when
// the tab closes. It links the stages WITHIN a single visit (the highest-value
// join) WITHOUT being a persistent cross-session identifier — which keeps the
// privacy-first, no-consent-banner posture of the analytics collector intact.
// A persistent (localStorage) id + a consent surface is a deliberate later step.
//
// This module is the single source of truth for cid/source semantics: the
// client-side runtime fragments (cidExpr/sourceExpr, inlined into the published
// page's sealed scripts) AND the server-side validators (parseCid/parseSource)
// AND the read-time key derivation (sourceKey). Zero node imports — safe to
// import from client components and from the DB schema's type slot.

export const OL_CID_KEY = "ol_cid";
export const OL_SRC_KEY = "ol_src";

/** Max stored cid length — a UUID is 36, the base36 fallback ~16. */
export const CID_MAX = 40;
/** Max stored length for each source field. */
export const SRC_FIELD_MAX = 80;

export interface EventSource {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** First-touch referrer host (cross-origin only). */
  ref?: string;
}

const SRC_KEYS = ["utmSource", "utmMedium", "utmCampaign", "ref"] as const;

// ── Client-side runtime fragments (strings inlined into sealed page scripts) ──

/** JS expression returning the session cid, minting + persisting one in
 *  sessionStorage on first call. Self-contained, swallows every error (returns
 *  null in a storage-blocked context). Inlined into every emitter so whichever
 *  runs first mints and the rest read the same value. */
export function cidExpr(): string {
  return `(function(){try{var k=${JSON.stringify(OL_CID_KEY)},c=sessionStorage.getItem(k);if(!c){c=((self.crypto&&self.crypto.randomUUID)?self.crypto.randomUUID():(Date.now().toString(36)+Math.random().toString(36).slice(2,10)));sessionStorage.setItem(k,c)}return c}catch(e){return null}})()`;
}

/** JS expression returning the session's FIRST-TOUCH source (utm params +
 *  cross-origin referrer host), capturing + freezing it in sessionStorage on
 *  first call so every later in-session view reports the same acquisition
 *  source. Returns null when nothing identifiable + on any error.
 *
 *  MUST run before the tracking-strip cleaner wipes utm_* from the URL — the
 *  publish pipeline injects the analytics snippet (the only user of this
 *  fragment) BEFORE injectTrackingStrip, so the dependency is satisfied. */
export function sourceExpr(): string {
  return `(function(){try{var k=${JSON.stringify(OL_SRC_KEY)},e=sessionStorage.getItem(k);if(e)return JSON.parse(e);var o={},q;try{q=new URLSearchParams(location.search)}catch(_){q=null}if(q){var m={utm_source:"utmSource",utm_medium:"utmMedium",utm_campaign:"utmCampaign"};for(var p in m){var v=q.get(p);if(v)o[m[p]]=String(v).slice(0,${SRC_FIELD_MAX})}}try{var r=document.referrer;if(r){var h=new URL(r).host;if(h&&h!==location.host)o.ref=h.slice(0,${SRC_FIELD_MAX})}}catch(_){}sessionStorage.setItem(k,JSON.stringify(o));return o}catch(e){return null}})()`;
}

// ── Server-side validators (a beacon/body is untrusted input) ────────────────

/** Validate an inbound cid: trimmed, ≤CID_MAX, [A-Za-z0-9-] only. Else null. */
export function parseCid(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > CID_MAX) return null;
  return /^[A-Za-z0-9-]+$/.test(t) ? t : null;
}

/** Validate an inbound source object: keep only the known keys, each a trimmed
 *  string capped to SRC_FIELD_MAX. Returns null when nothing survives. */
export function parseSource(v: unknown): EventSource | null {
  if (!v || typeof v !== "object") return null;
  const rec = v as Record<string, unknown>;
  const out: EventSource = {};
  for (const k of SRC_KEYS) {
    const val = rec[k];
    if (typeof val === "string") {
      // Safe-by-construction charset allowlist — utm/ref values end up in jsonb
      // and (eventually) the dashboard; strip anything outside plain campaign
      // text so a future render can never carry markup, regardless of sink.
      const t = val
        .trim()
        .replace(/[^\w .,_:/+-]/g, "")
        .slice(0, SRC_FIELD_MAX);
      if (t) out[k] = t;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Read-time acquisition key: utm_source, else referrer host, else "direct". */
export function sourceKey(s: EventSource | null | undefined): string {
  if (s) {
    if (s.utmSource) return s.utmSource;
    if (s.ref) return s.ref;
  }
  return "direct";
}
