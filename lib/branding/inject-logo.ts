// Inject the per-project logo into a publish-ready HTML document. The DOM
// mutation lives in crates/html-engine/src/publish/logo.rs (inject_logo);
// this module is a thin TS surface so callers (lib/publish/filesystem.ts)
// keep their existing import shape.

import { injectLogo as rustInjectLogo } from "@/lib/html-engine";

export interface InjectLogoParams {
  html: string;
  logoUrl: string;
}

export function injectLogoIntoHtml({ html, logoUrl }: InjectLogoParams): string {
  return rustInjectLogo(html, logoUrl);
}
