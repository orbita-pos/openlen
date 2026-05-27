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
 *  bake per-form config (from ProjectData.settings.forms, keyed by document-
 *  order index), and inject the inline-submit script. No-op when the page
 *  has no forms. */
export function wirePublishedForms(
  html: string,
  subdomain: string,
  formConfigs?: Record<string, FormConfig>,
): string {
  const action = `${submitBase()}/api/f/${subdomain}`;
  const configs: WireFormConfig[] = formConfigs
    ? Object.entries(formConfigs).map(([k, v]) => ({
        index: Number(k),
        successMessage: v.successMessage,
        redirectUrl: v.redirectUrl,
      }))
    : [];
  return rustWirePublishedForms(html, action, configs);
}
