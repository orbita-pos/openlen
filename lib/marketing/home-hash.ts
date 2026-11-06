// What the home does with the hash it arrives with (spec local 2026-11-06-portada-solo-input).
//
// Until 06/11 «Funciones» and «Precios» were sections of the home (`/#features`, `/#pricing`); now they are pages, and
// a hash never reaches the server, so old links (emails, other sites, bookmarks) are re-routed here, in the browser.
// `#ask` is how a page without the box (the companion on /features) sends you to the home's box.

export type HomeHashAction = { kind: "go"; path: "/pricing" | "/features" } | { kind: "focus"; id: "hero-prompt" };

export function homeHashAction(hash: string): HomeHashAction | null {
  switch (hash) {
    case "#pricing":
      return { kind: "go", path: "/pricing" };
    case "#features":
      return { kind: "go", path: "/features" };
    case "#ask":
      return { kind: "focus", id: "hero-prompt" };
    default:
      return null;
  }
}
