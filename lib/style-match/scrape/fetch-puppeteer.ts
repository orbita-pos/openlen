import puppeteer, { type Browser, type CDPSession, type Page } from "puppeteer";
import {
  DEFAULT_VIEWPORT,
  MAX_BODY_BYTES,
  type ComputedStylesSweep,
  type ResolvedFont,
  type ScrapeError,
  type ScrapeResult,
  type ScrapeTarget,
} from "../types";
import { findChromeExecutable } from "./find-browser";
import { validateUrl } from "./validate-url";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PAGE_LOAD_TIMEOUT_MS = 20_000;
const POST_LOAD_PADDING_MS = 1500;
const MAX_ELEMENTS_RETURNED = 1500;

export async function fetchPuppeteer(
  target: ScrapeTarget,
): Promise<{ ok: true; value: ScrapeResult } | { ok: false; error: ScrapeError }> {
  const validation = await validateUrl(target.url);
  if (!validation.ok) return validation;

  const { url, hostname } = validation.value;
  const viewport = target.viewport ?? DEFAULT_VIEWPORT;
  const t0 = Date.now();

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    const executablePath = findChromeExecutable();
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    page = await browser.newPage();
    await page.setUserAgent(CHROME_UA);
    await page.setExtraHTTPHeaders({
      "X-OpenLen-Bot": "1",
      "From": "bot@openlen.com",
    });
    await page.setViewport(viewport);

    const navResp = await page.goto(url.toString(), {
      waitUntil: "networkidle2",
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    if (!navResp) {
      return { ok: false, error: { kind: "network", message: "No navigation response" } };
    }

    const status = navResp.status();
    if (status === 403 || status === 503 || status === 429) {
      return { ok: false, error: { kind: "blocked", status } };
    }
    if (status >= 400) {
      return {
        ok: false,
        error: { kind: "network", message: `HTTP ${status} ${navResp.statusText()}` },
      };
    }

    await new Promise((resolve) => setTimeout(resolve, POST_LOAD_PADDING_MS));

    const html = await page.content();
    const htmlBytes = Buffer.byteLength(html, "utf8");
    if (htmlBytes > MAX_BODY_BYTES) {
      return { ok: false, error: { kind: "too-large", sizeBytes: htmlBytes } };
    }

    const screenshot = Buffer.from(
      await page.screenshot({
        type: "jpeg",
        quality: 80,
        fullPage: false,
      }),
    );

    const computedStyles: ComputedStylesSweep = await page.evaluate((cap) => {
      const SKIP_TAGS = new Set([
        "html","head","meta","link","script","style","noscript","title","br","hr",
      ]);
      const LANDMARK_TAGS = new Set([
        "h1","h2","h3","h4","h5","h6","button","a","nav","header","footer","main",
        "section","article","aside","form","input","textarea","select","label",
      ]);
      const elements: Array<{
        tag: string;
        role: string | null;
        rect: { width: number; height: number; top: number; left: number };
        zIndex: number;
        styles: {
          color: string;
          backgroundColor: string;
          borderColor: string;
          fontFamily: string;
          fontSize: string;
          fontWeight: string;
          lineHeight: string;
          letterSpacing: string;
          borderRadius: string;
          boxShadow: string;
          padding: string;
          margin: string;
          gap: string;
        };
      }> = [];
      const all = document.querySelectorAll("*");
      for (let i = 0; i < all.length; i++) {
        const el = all[i] as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag)) continue;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const cs = window.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const opacity = parseFloat(cs.opacity);
        if (!Number.isNaN(opacity) && opacity === 0) continue;

        const text = (el.textContent ?? "").trim();
        const hasOwnText = text.length > 0 && el.children.length === 0;
        const hasBg =
          cs.backgroundColor !== "rgba(0, 0, 0, 0)" &&
          cs.backgroundColor !== "transparent";
        const hasBorder =
          cs.borderTopWidth !== "0px" ||
          cs.borderRightWidth !== "0px" ||
          cs.borderBottomWidth !== "0px" ||
          cs.borderLeftWidth !== "0px";
        const hasShadow = cs.boxShadow !== "none";
        const hasRadius = cs.borderRadius !== "0px";
        const isLandmark = LANDMARK_TAGS.has(tag);

        if (
          !hasOwnText && !hasBg && !hasBorder && !hasShadow && !hasRadius && !isLandmark
        ) {
          continue;
        }

        const zIdx = parseInt(cs.zIndex, 10);
        elements.push({
          tag,
          role: el.getAttribute("role"),
          rect: {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            left: Math.round(rect.left),
          },
          zIndex: Number.isNaN(zIdx) ? 0 : zIdx,
          styles: {
            color: cs.color,
            backgroundColor: cs.backgroundColor,
            borderColor: cs.borderTopColor,
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            letterSpacing: cs.letterSpacing,
            borderRadius: cs.borderRadius,
            boxShadow: cs.boxShadow,
            padding: cs.padding,
            margin: cs.margin,
            gap: cs.gap,
          },
        });
      }
      elements.sort(
        (a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height,
      );
      const trimmed = elements.length > cap ? elements.slice(0, cap) : elements;
      return {
        elements: trimmed,
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
      };
    }, MAX_ELEMENTS_RETURNED);

    const resolvedFonts = await getResolvedFonts(page);

    return {
      ok: true,
      value: {
        url: target.url,
        hostname,
        finalUrl: navResp.url() || url.toString(),
        html,
        rendered: true,
        screenshot,
        computedStyles,
        resolvedFonts,
        fetchedAt: new Date(),
        tier: 2,
        durationMs: Date.now() - t0,
        sizeBytes: htmlBytes,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Navigation timeout") || message.includes("TimeoutError")) {
      return { ok: false, error: { kind: "timeout", afterMs: Date.now() - t0 } };
    }
    return { ok: false, error: { kind: "network", message } };
  } finally {
    try { await page?.close({ runBeforeUnload: false }); } catch { /* ignore */ }
    try { await browser?.close(); } catch { /* ignore */ }
  }
}

async function getResolvedFonts(page: Page): Promise<ResolvedFont[]> {
  let cdp: CDPSession | null = null;
  try {
    cdp = await page.createCDPSession();
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const doc = await cdp.send("DOM.getDocument");
    const body = await cdp.send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: "body",
    });
    if (!body.nodeId) return [];
    const fontsResp = await cdp.send("CSS.getPlatformFontsForNode", {
      nodeId: body.nodeId,
    });
    return fontsResp.fonts.map((f) => ({
      familyName: f.familyName,
      glyphCount: f.glyphCount,
      isCustomFont: f.isCustomFont ?? false,
    }));
  } catch {
    return [];
  } finally {
    try { await cdp?.detach(); } catch { /* ignore */ }
  }
}
