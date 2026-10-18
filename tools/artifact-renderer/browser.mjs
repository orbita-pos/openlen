import puppeteer from "puppeteer";

/** Trusted renderer code. Authored HTML runs only in Chromium; it is never
 * imported, evaluated, or given a Node binding. Production calls this inside
 * the per-job offline container. Tests use only committed trusted fixtures. */
export async function renderDashboardPacket(packet, options = {}) {
  const browser = await puppeteer.launch({ headless: true, ...(options.executablePath ? { executablePath: options.executablePath } : {}), timeout: 20_000,
    args: ["--disable-dev-shm-usage", "--disable-background-networking", "--disable-sync", "--disable-component-update", ...(process.env.OPENLEN_RENDER_CONTAINER === "1" ? ["--no-sandbox"] : [])],
  });
  const watchdog = setTimeout(() => browser.process()?.kill("SIGKILL"), options.timeoutMs ?? 45_000);
  const errors = [], missing = new Set();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000); page.setDefaultNavigationTimeout(15_000);
    await page.setViewport({ width: packet.width, height: packet.height, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => { if (errors.length < 8) errors.push(String(e.message).slice(0, 1000)); });
    page.on("console", (m) => { if (m.type() === "error" && errors.length < 8) errors.push(m.text().slice(0, 1000)); });
    page.on("requestfailed", (r) => missing.add(r.url().slice(0, 500)));
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      if (r.isInterceptResolutionHandled()) return;
      if (r.url() === "https://artifact.invalid/" && r.isNavigationRequest() && r.frame() === page.mainFrame()) void r.respond({ status: 200, contentType: "text/html", body: packet.html });
      else if (r.url().startsWith("data:") || r.url().startsWith("blob:")) void r.continue();
      else { missing.add(r.url().slice(0, 500)); void r.abort("blockedbyclient"); }
    });
    await page.goto("https://artifact.invalid/", { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      if (window.lenReady && typeof window.lenReady.then === "function") await window.lenReady;
      await Promise.all([...document.images].map((img) => img.decode()));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const provenance = await page.$eval("#len-data-provenance", (e) => e.textContent);
    if (!provenance?.trim()) throw new Error("dataset_provenance_missing");
    const png = new Uint8Array(await page.screenshot({ type: "png" }));
    const checks = ["browser:rendered", "datasets:provenance-visible"];
    for (const [index, probe] of packet.probes.entries()) {
      if (probe.select) await page.select(probe.select.selector, probe.select.value);
      if (probe.click) await page.click(probe.click);
      await page.waitForFunction((selector, text) => document.querySelector(selector)?.textContent?.trim() === text, {}, probe.expect.selector, probe.expect.text);
      checks.push(`interaction:${index}:passed`);
    }
    if (missing.size) throw new Error("artifact_resource_missing");
    if (errors.length) throw new Error("artifact_runtime_error", { cause: errors });
    checks.push("resources:complete", "runtime:no-errors");
    return { png, checks };
  } finally { clearTimeout(watchdog); await browser.close().catch(() => undefined); }
}
