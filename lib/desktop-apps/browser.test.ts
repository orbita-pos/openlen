// @vitest-environment node
//
// WHICH BROWSER THE WINDOW IS IN (spec local 2026-11-26-apps-en-el-escritorio, §4.3), to say exactly where the install is.
// Claude writes the shortcuts itself and tells the person where the app went; a browser draws its own, so the steps are the
// browser's. What can't be told apart (Opera, Samsung, a phone, an empty user agent) gets the generic text.
import { describe, expect, it } from "vitest";

import { installBrowser } from "./browser";

const UA = {
  chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.56",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
  opera: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0",
  samsung: "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1",
} as const;

describe("installBrowser", () => {
  it.each([
    ["Chrome on Windows", UA.chromeWindows, "chrome"],
    ["Chrome on a Mac", UA.chromeMac, "chrome"],
    ["Edge (its user agent says Chrome too: Edge goes first)", UA.edge, "edge"],
    ["Safari on a Mac", UA.safariMac, "safari"],
    ["Firefox on Windows", UA.firefoxWindows, "firefox"],
    ["Firefox on a Mac", UA.firefoxMac, "firefox"],
  ] as const)("%s", (_name, ua, expected) => {
    expect(installBrowser(ua)).toBe(expected);
  });

  it.each([
    ["Opera", UA.opera],
    ["Samsung Internet", UA.samsung],
    ["Chrome on Android (its install is the phone's)", UA.chromeAndroid],
    ["Safari on an iPhone", UA.safariIphone],
    ["Chrome on an iPhone", UA.chromeIphone],
    ["an empty user agent", ""],
    ["a user agent nobody knows", "Lynx/2.9.0"],
  ])("%s has no steps of its own: the generic text", (_name, ua) => {
    expect(installBrowser(ua)).toBe("other");
  });
});
