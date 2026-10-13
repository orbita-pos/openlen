// The pages' Permissions-Policy: the published one (Caddy, the *.openlen.app
// block), custom domains (/served), the canvas (its two routes) and the copy
// in the `edge` crate. The three TypeScript ones import this; Caddy and Rust
// copy it, and `permissions-policy.test.ts` checks they all say the same.
//
// `self` and not `()`: the page ITSELF can ask for camera, microphone and
// location —scan a barcode, dictate, «near me»— and the browser asks the
// visitor, as on vercel.app or netlify.app. Each page lives on its own .app
// origin, so the permission belongs to that page and no other. A foreign
// iframe inside the page (a video, a map) still can't ask for them.
export const PAGE_PERMISSIONS_POLICY = "camera=(self), microphone=(self), geolocation=(self)";
