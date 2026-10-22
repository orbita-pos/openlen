// lib/project-email/dns-instructions.ts — WHERE THE THREE LINES GO (spec local
// 2026-10-22-email-integration, 6.2): the owner's DNS provider, guessed from the
// domain's name servers, and its own help page on adding records (each one
// checked to exist on 22/10). Pure.

export type DnsProvider = "godaddy" | "namecheap" | "hostinger" | "cloudflare" | "squarespace" | "other";

const BY_NS: readonly (readonly [RegExp, DnsProvider])[] = [
  [/\.domaincontrol\.com$/, "godaddy"],
  [/\.registrar-servers\.com$/, "namecheap"],
  [/\.(dns-parking\.com|hostinger\.[a-z.]+)$/, "hostinger"],
  [/\.ns\.cloudflare\.com$/, "cloudflare"],
  [/\.(googledomains\.com|squarespacedns\.com)$/, "squarespace"],
];

export function providerFromNs(ns: readonly string[]): DnsProvider {
  for (const raw of ns) {
    const host = raw.trim().toLowerCase().replace(/\.$/, "");
    for (const [re, p] of BY_NS) if (re.test(host)) return p;
  }
  return "other";
}

const HELP: Readonly<Record<Exclude<DnsProvider, "other">, string>> = {
  godaddy: "https://www.godaddy.com/help/add-a-txt-record-19232",
  namecheap: "https://www.namecheap.com/support/knowledgebase/article.aspx/317/2237/how-do-i-add-txtspfdkimdmarc-records-for-my-domain/",
  hostinger: "https://www.hostinger.com/support/1583249-how-to-manage-dns-records",
  cloudflare: "https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/",
  squarespace: "https://support.squarespace.com/hc/en-us/articles/360002101888-Adding-custom-DNS-records-to-your-Squarespace-managed-domain",
};

export function instructionsUrl(p: DnsProvider): string | null {
  return p === "other" ? null : HELP[p];
}
