// lib/agent/terminal/curl-targets.ts — ONE `curl` FOR THE TERMINAL, from several
// destinations (spec local 2026-10-22-shopify-storefront, §6.2): the project's Edge
// Functions and the connected Shopify store's Storefront API. Each call goes to the one
// whose prefix the URL starts with; anything else stays without network. Pure.

import type { FunctionsCurl } from "@/lib/functions/curl-types";

export function mergeCurls(curls: readonly (FunctionsCurl | null)[]): FunctionsCurl | null {
  const present = curls.filter((c): c is FunctionsCurl => c !== null);
  if (present.length <= 1) return present[0] ?? null;
  const reaches = present.map((c) => c.reaches).filter((r): r is string => Boolean(r));
  return {
    prefixes: present.flatMap((c) => c.prefixes),
    ...(reaches.length > 0 ? { reaches: reaches.join(" and ") } : {}),
    call(req) {
      const owner = present.find((c) => c.prefixes.some((p) => req.url.startsWith(p)));
      if (!owner) return Promise.reject(new Error(`Network access denied: ${req.url}`));
      return owner.call(req);
    },
  };
}
