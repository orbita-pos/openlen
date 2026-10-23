// lib/lienzo/checkout-escape.ts — CHECKOUT OPENS OUTSIDE THE CANVAS. Stripe's
// Checkout, payment links and customer portal (spec local 2026-10-21-stripe-integration,
// §6.5) and Shopify's checkout (spec local 2026-10-22-shopify-storefront, §6.4) refuse to
// be framed, and the canvas's iframe may open windows (`allow-popups`) but not navigate the
// tab above it: the `location.href = session.url` of Stripe's docs would leave the canvas
// blank, and the `<shopify-cart>`'s checkout link (target="_top", inside its shadow DOM) or
// `buyNow()` (`window.open(url, "_top")`) would do nothing. The platform adapts, so Len
// doesn't have to write `target="_blank"`: in the canvas's documents, a navigation to a
// checkout opens a new tab instead. Only when framed: top-level (Len's eyes, a thumbnail)
// nothing changes, and the published site never carries it. If the browser blocks the new
// tab, a button opens it on click.
//
// Shopify's checkout is known by its URL, not by the connected store's hosts (a ruling of
// the plan): `*.myshopify.com`, or a path `/cart/c/…`, `/checkouts/…` or `/cart/<id>:<n>`,
// the shapes measured on 22/10 against the demo store.

export const STRIPE_HOSTS: readonly string[] = ["checkout.stripe.com", "buy.stripe.com", "billing.stripe.com"];

const MARK = "data-openlen-checkout-escape";

/** Whether an absolute URL is Shopify's checkout (or a store's myshopify host). Self-contained
 *  and plain ES5: its source is inlined into the canvas's script. */
export function isShopifyCheckoutUrl(u: string): boolean {
  try {
    var url = new URL(u);
    if (url.protocol !== "https:") return false;
    return /\.myshopify\.com$/.test(url.hostname) || /^\/cart\/c\//.test(url.pathname) || /^\/checkouts\//.test(url.pathname) || /^\/cart\/\d+:\d+/.test(url.pathname);
  } catch (e) {
    return false;
  }
}

function script(shopify: boolean): string {
  return `(function () {
  if (window.top === window.self) return;
  var HOSTS = ${JSON.stringify(STRIPE_HOSTS)};
  var isShopify = ${shopify ? `(${isShopifyCheckoutUrl.toString()})` : "function () { return false; }"};
  function escapable(u) {
    try {
      var url = new URL(u, location.href);
      return HOSTS.indexOf(url.hostname) !== -1 || isShopify(url.href);
    } catch (e) { return false; }
  }
  var nativeOpen = window.open;
  function offer(u) {
    var es = (document.documentElement.lang || "").toLowerCase().indexOf("es") === 0;
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = es ? "Abrir el pago" : "Open checkout";
    b.setAttribute("style", "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;padding:12px 18px;border-radius:999px;border:0;background:#111;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:pointer");
    b.onclick = function () { nativeOpen.call(window, u, "_blank"); b.remove(); };
    (document.body || document.documentElement).appendChild(b);
  }
  function open(u) {
    var w = nativeOpen.call(window, u, "_blank");
    if (w) { try { w.opener = null; } catch (e) {} } else offer(u);
  }
  function blockedTarget(t) {
    t = (t || "").toLowerCase();
    return t === "" || t === "_self" || t === "_top" || t === "_parent";
  }
  window.open = function (u, target) {
    if (u && blockedTarget(target) && target && escapable(String(u))) { open(new URL(String(u), location.href).href); return null; }
    return nativeOpen.apply(window, arguments);
  };
  document.addEventListener("click", function (e) {
    var path = e.composedPath ? e.composedPath() : [e.target];
    var a = null;
    for (var i = 0; i < path.length; i++) {
      var n = path[i];
      if (n && n.tagName === "A" && n.hasAttribute && n.hasAttribute("href")) { a = n; break; }
    }
    if (!a || !blockedTarget(a.getAttribute("target")) || !escapable(a.href)) return;
    e.preventDefault();
    open(a.href);
  }, true);
  if (window.navigation && window.navigation.addEventListener) {
    window.navigation.addEventListener("navigate", function (e) {
      if (!e.destination || !e.cancelable || !escapable(e.destination.url)) return;
      e.preventDefault();
      open(e.destination.url);
    });
  }
})();`;
}

export function withCheckoutEscape(html: string, o: { shopify?: boolean } = {}): string {
  if (html.includes(MARK)) return html;
  const tag = `<script ${MARK}>${script(o.shopify ?? true)}</script>`;
  const head = html.search(/<\/head>/i);
  if (head !== -1) return `${html.slice(0, head)}${tag}${html.slice(head)}`;
  const body = /<body[^>]*>/i.exec(html);
  if (body) return `${html.slice(0, body.index + body[0].length)}${tag}${html.slice(body.index + body[0].length)}`;
  return `${tag}${html}`;
}
