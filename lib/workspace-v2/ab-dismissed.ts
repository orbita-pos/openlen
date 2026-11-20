// «Close» on the card of a test the harm brake stopped (review item 29): it stays on the chat and the Insights panel for 14
// days, and a person who has read it must be able to put it away. Per person and browser (a convenience, not state anyone
// else needs), remembered by experiment id. Storage can be blocked or empty: every access is guarded and the card simply
// comes back.
const KEY = "openlen.ab.dismissed";
/** The ids are only worth keeping as long as the card could still show; the list never grows without bound. */
const MAX_KEPT = 50;

export function readDismissedAb(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Remembers `id` as put away and returns the new set (also when storage refuses: the card goes for this session). */
export function dismissAb(id: string, current: ReadonlySet<string> = readDismissedAb()): ReadonlySet<string> {
  const next = new Set(current);
  next.add(id);
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...next].slice(-MAX_KEPT)));
  } catch {
    // blocked storage: it is dismissed until the page reloads
  }
  return next;
}
