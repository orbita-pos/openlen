// Conservative price parsing for the Pedidos por WhatsApp cart. priceDisplay
// on a collection item is FREE TEXT ("$90", "Desde $200", "$90–$120") — the
// cart only does arithmetic on prices it can parse unambiguously; anything
// uncertain returns null and the order message says "Total: a confirmar"
// instead of inventing numbers.

const UNCERTAIN_RE = /\bdesde\b|\bfrom\b|\baprox\b|a partir/i;
const RANGE_RE = /\d\s*[–—-]\s*[$\s]*\d/;
const NUMBER_RE = /\d[\d.,]*/g;

/** Parse a display price into integer cents, or null when there is no single
 *  unambiguous price. "1,250" / "1.250" read as thousands; "90,50" / "90.50"
 *  as decimals (exactly 2 trailing digits). Zero and >$1,000,000 are null. */
export function parsePriceCents(display: string | null | undefined): number | null {
  if (!display) return null;
  const s = display.trim();
  if (!s || UNCERTAIN_RE.test(s) || RANGE_RE.test(s)) return null;
  // Reject any dash not part of a valid range (already caught above).
  // Leading/trailing/adjacent dashes are suspicious and unparseable.
  if (/[-–—]/.test(s)) return null;
  const tokens = s.match(NUMBER_RE);
  if (!tokens || tokens.length !== 1) return null;
  const raw = tokens[0].replace(/[.,]$/, "");

  let intPart = raw;
  let decPart = "";
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  const sep = Math.max(lastDot, lastComma);
  if (sep !== -1) {
    const after = raw.slice(sep + 1);
    if (after.length === 2) {
      // Exactly two trailing digits → decimal separator ("90.50", "1.250,50").
      intPart = raw.slice(0, sep);
      decPart = after;
    } else if (after.length !== 3) {
      // Neither decimals nor a clean thousands group ("1.2500") — ambiguous.
      return null;
    }
  }
  const digits = intPart.replace(/[.,]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const cents = parseInt(digits, 10) * 100 + (decPart ? parseInt(decPart, 10) : 0);
  if (cents <= 0 || cents > 100_000_000) return null;
  return cents;
}

/** "$1,250.50" style — trailing ".00" dropped. The cart runtime embeds an
 *  equivalent one-liner (template string, can't import); keep both in sync. */
export function formatCents(cents: number): string {
  const s = (cents / 100).toFixed(2).replace(/\.00$/, "");
  const [i, d] = s.split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "$" + (d ? `${grouped}.${d}` : grouped);
}
