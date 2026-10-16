// lib/security-review/client-files.ts — what reaches the visitor's browser, as
// text:
//   · the pages;
//   · the folder's web files (an app's bundle is built from them);
//   · /.env;
//   · the production environment variables, which are compiled into the
//     JavaScript.
// /supabase stays out (it runs on the server), and so do test files (they are
// never bundled or published).

import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";

import type { ReviewInputs } from "./types";

export interface ShippedText {
  /** A project path, or `env:NAME` for an environment variable. */
  readonly path: string;
  readonly text: string;
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

export function clientShippedTexts(i: ReviewInputs): ShippedText[] {
  const out: ShippedText[] = [{ path: "/index.html", text: i.homeHtml }];
  for (const slug of Object.keys(i.pages).sort()) out.push({ path: `/${slug}/index.html`, text: i.pages[slug]! });
  for (const path of Object.keys(i.files).sort()) {
    if (path === "/.env" || (isPublishableFolderPath(path) && !isTestFile(path))) out.push({ path, text: i.files[path]! });
  }
  for (const name of Object.keys(i.productionEnv).sort()) out.push({ path: `env:${name}`, text: i.productionEnv[name]! });
  return out;
}
