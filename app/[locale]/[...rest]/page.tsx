import { notFound } from "next/navigation";

// Any unmatched path under a locale (e.g. /en/does-not-exist) falls through
// to here and renders the localized not-found page — which is wrapped by the
// [locale] layout, so it gets the proper <html>/<body> shell + translations.
export default function CatchAllPage() {
  notFound();
}
