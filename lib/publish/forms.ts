// Publish-time <form> wiring — turns the decorative forms in a generated /
// pasted / templated page into working lead-capture forms. The actual DOM
// mutation lives in Rust (`@openlen/html-engine`'s `wirePublishedForms` via
// crates/html-engine/src/publish/forms.rs); this module just resolves the
// per-subdomain submit URL from the env and reshapes the per-form config
// from the project's Record<index, FormConfig> shape into the Vec the Rust
// function expects.

import {
  wirePublishedForms as rustWirePublishedForms,
  type WireFormConfig,
} from "@/lib/html-engine";
import type { FormConfig } from "@/lib/projects/types";

function submitBase(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://openlen.com";
}

/** Wire every <form> in the published HTML to OpenLen's submit endpoint,
 *  bake per-form config (from ProjectData.settings.forms), and inject the
 *  inline-submit script. No-op when the page has no forms.
 *
 *  Multi-page: `page` is the site-page slug this document publishes as
 *  (null/absent = home). It rides the action's query string — the Rust pass
 *  writes the action verbatim and both the inline-submit fetch and a native
 *  POST preserve it — so the submit endpoint can resolve page-scoped config
 *  and attribute the lead. Config keys: home forms use the legacy document-
 *  order index ("0"); site-page forms use "<slug>:<index>", falling back to
 *  the shared legacy key when no scoped entry exists. */
export function wirePublishedForms(
  html: string,
  subdomain: string,
  formConfigs?: Record<string, FormConfig>,
  page?: string | null,
): string {
  const action =
    `${submitBase()}/api/f/${subdomain}` +
    (page ? `?page=${encodeURIComponent(page)}` : "");
  const byIndex = new Map<number, FormConfig>();
  for (const [k, v] of Object.entries(formConfigs ?? {})) {
    if (/^\d+$/.test(k)) byIndex.set(Number(k), v);
  }
  if (page) {
    const prefix = `${page}:`;
    for (const [k, v] of Object.entries(formConfigs ?? {})) {
      if (!k.startsWith(prefix)) continue;
      const idx = Number(k.slice(prefix.length));
      if (Number.isInteger(idx) && idx >= 0) byIndex.set(idx, v);
    }
  }
  const configs: WireFormConfig[] = [...byIndex.entries()].map(
    ([index, v]) => ({
      index,
      successMessage: v.successMessage,
      redirectUrl: v.redirectUrl,
    }),
  );
  return rustWirePublishedForms(html, action, configs);
}
