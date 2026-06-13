import type { ProjectSettings } from "./types";

// The cross-module invariant, in ONE place.
//
// Comments, Broadcast, and Bookings' "require login" all DEPEND on the Members
// module: Comments is members-only by construction, Broadcast emails members,
// and a require-login booking site needs members to log in. If Members is off
// while a dependent flag is still on, two real failures follow:
//   • publish bakes a live Comments widget whose login/post can never work
//     (lib/publish/filesystem.ts gates the bake on comments.enabled alone), and
//   • a require-login booking site is unbookable — guests get 401 and there is
//     no members module to log into (app/api/bk/[sub]/book → 401 dead-end).
//
// reconcileModuleSettings normalizes settings so a disabled Members module can
// never leave a dependent in an enabled-but-broken state. Pure + idempotent;
// call it on every settings write. Returns the SAME reference when nothing
// needs changing (members on, or already consistent) so callers can cheaply
// detect a no-op.
export function reconcileModuleSettings(
  settings: ProjectSettings,
): ProjectSettings {
  if (settings.members?.enabled === true) return settings;

  let next = settings;
  if (next.comments?.enabled === true) {
    next = { ...next, comments: { ...next.comments, enabled: false } };
  }
  if (next.broadcast?.enabled === true) {
    next = { ...next, broadcast: { ...next.broadcast, enabled: false } };
  }
  if (next.bookings?.requireLogin === true) {
    // Keep bookings.enabled — guests can still book; only the members-only
    // gate is dropped, which is what turns the dead-end into a working flow.
    next = { ...next, bookings: { ...next.bookings, requireLogin: false } };
  }
  return next;
}
