import "server-only";

// `react-dom/server` is loaded via Node's `createRequire` so that webpack's
// static analyzer doesn't see the import and trip Next.js 15's RSC graph
// check (which forbids any module reachable from a Client Component chain
// from importing `react-dom/server`). Every caller here is server-side, so
// runtime resolution is the right escape hatch.
import { createRequire } from "node:module";
const nodeRequire = createRequire(import.meta.url);
const reactDomServer = nodeRequire("react-dom/server") as typeof import("react-dom/server");

export function renderElementToHtml(element: unknown): string {
  // `element` is typed as unknown to keep this file React-component-graph free
  // for the same RSC reason as above. The single caller in `assemble.ts`
  // passes a `React.createElement(...)` result, which is the only valid input.
  return reactDomServer.renderToStaticMarkup(element as never);
}
