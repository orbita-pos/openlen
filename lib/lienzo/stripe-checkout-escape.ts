// lib/lienzo/stripe-checkout-escape.ts — STRIPE CHECKOUT OPENS OUTSIDE THE CANVAS
// (spec local 2026-10-21-stripe-integration, §6.5). Stripe's Checkout, payment
// links and customer portal refuse to be framed, and the canvas's iframe may open
// windows (`allow-popups`) but not navigate the tab above it: the
// `location.href = session.url` of Stripe's docs would leave the canvas blank.
// The platform adapts, so Len doesn't have to write `target="_blank"`: in the
// canvas's documents, a navigation to those hosts opens a new tab instead. Only
// when framed: top-level (Len's eyes, a thumbnail) nothing changes, and the
// published site never carries it. If the browser blocks the new tab, a button
// opens it on click.

export const STRIPE_HOSTS: readonly string[] = ["checkout.stripe.com", "buy.stripe.com", "billing.stripe.com"];

const MARK = "data-openlen-stripe-escape";

const SCRIPT = `(function () {
  if (window.top === window.self) return;
  var HOSTS = ${JSON.stringify(STRIPE_HOSTS)};
  function isStripe(u) {
    try { return HOSTS.indexOf(new URL(u, location.href).hostname) !== -1; } catch (e) { return false; }
  }
  function offer(u) {
    var es = (document.documentElement.lang || "").toLowerCase().indexOf("es") === 0;
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = es ? "Abrir el pago de Stripe" : "Open Stripe checkout";
    b.setAttribute("style", "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;padding:12px 18px;border-radius:999px;border:0;background:#635bff;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:pointer");
    b.onclick = function () { window.open(u, "_blank"); b.remove(); };
    (document.body || document.documentElement).appendChild(b);
  }
  function open(u) {
    var w = window.open(u, "_blank");
    if (w) { try { w.opener = null; } catch (e) {} } else offer(u);
  }
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || (a.target && a.target !== "_self") || !isStripe(a.href)) return;
    e.preventDefault();
    open(a.href);
  }, true);
  if (window.navigation && window.navigation.addEventListener) {
    window.navigation.addEventListener("navigate", function (e) {
      if (!e.destination || !e.cancelable || !isStripe(e.destination.url)) return;
      e.preventDefault();
      open(e.destination.url);
    });
  }
})();`;

const TAG = `<script ${MARK}>${SCRIPT}</script>`;

export function withStripeCheckoutEscape(html: string): string {
  if (html.includes(MARK)) return html;
  const head = html.search(/<\/head>/i);
  if (head !== -1) return `${html.slice(0, head)}${TAG}${html.slice(head)}`;
  const body = /<body[^>]*>/i.exec(html);
  if (body) return `${html.slice(0, body.index + body[0].length)}${TAG}${html.slice(body.index + body[0].length)}`;
  return `${TAG}${html}`;
}
