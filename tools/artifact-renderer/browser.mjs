import puppeteer from "puppeteer";
import {captureSlideLayout} from "./slide-layout.mjs";

/** Trusted renderer code. Authored HTML runs only in Chromium; it is never
 * imported, evaluated, or given a Node binding. Production calls this inside
 * the per-job offline container. Tests use only committed trusted fixtures. */
async function withArtifactPage(packet, options, run) {
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
    for(const frame of page.frames())await frame.evaluate(async () => {
      await document.fonts.ready;
      if (window.lenReady && typeof window.lenReady.then === "function") await window.lenReady;
      await Promise.all([...document.images].map((img) => img.decode()));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const result = await run(page);
    if (missing.size) throw new Error("artifact_resource_missing");
    if (errors.length) throw new Error("artifact_runtime_error", { cause: errors });
    result.checks.push("resources:complete", "runtime:no-errors");
    return result;
  } finally { clearTimeout(watchdog); await browser.close().catch(() => undefined); }
}
export async function renderDashboardPacket(packet, options = {}) {
  return withArtifactPage(packet, options, async (page) => {
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
    return { png, checks };
  });
}
export async function renderProjectCapturePacket(packet,options={}){
  return withArtifactPage(packet,options,captureProjectPage);
}
export async function captureProjectPage(page){
  return {png:new Uint8Array(await page.screenshot({type:"png"})),checks:["browser:rendered","source-capture:offline"]};
}
export async function renderSlidesPacket(packet, options = {}) {
  return withArtifactPage(packet, options, async (page) => {
    const overflow = await page.$$eval(".slide-text", (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.dataset.elementId));
    if (overflow.length) throw new Error("slide_text_overflow", { cause: overflow.slice(0, 8) });
    const slides = await page.$$(".slide");
    if (slides.length !== packet.pageCount) throw new Error("slide_count_mismatch");
    const pages = [];
    for (const slide of slides) pages.push(new Uint8Array(await slide.screenshot({ type: "png" })));
    return { png: pages[0], pages, checks: ["browser:rendered", "text:no-overflow"] };
  });
}
export async function renderSlideLayoutPacket(packet,options={}){
  return withArtifactPage(packet,options,page=>captureSlideLayout(page,packet));
}

export async function renderMotionPacket(packet, onFrame, options = {}) {
  return withArtifactPage(packet,{...options,timeoutMs:options.timeoutMs??900_000},page=>captureMotionPage(page,packet,onFrame));
}
export async function captureMotionPage(page,packet,onFrame){
    await page.evaluate(async expected=>{
      const motion=window.lenMotion;
      if(!motion||typeof motion.ready!=="function"||typeof motion.seek!=="function"||motion.durationSeconds!==expected)throw new Error("motion_contract_missing");
      await motion.ready();
    },packet.durationSeconds);
    const seek=async t=>page.evaluate(async time=>{
      await window.lenMotion.seek(time);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    },t);
    const times=[0,Math.floor(packet.frameCount/2)/packet.fps,(packet.frameCount-1)/packet.fps];
    const samples=[];
    for(const time of times){await seek(time);samples.push(await page.screenshot({type:"png"}));}
    for(const index of [2,0,1]){
      await seek(times[index]);const actual=await page.screenshot({type:"png"});
      if(!Buffer.from(actual).equals(Buffer.from(samples[index])))throw new Error("motion_nondeterministic");
    }
    for(let frame=0;frame<packet.frameCount;frame++){
      await seek(frame/packet.fps);
      await onFrame(new Uint8Array(await page.screenshot({type:"png"})),frame);
    }
    return {png:new Uint8Array(samples[0]),checks:["browser:rendered","motion:seek-deterministic","motion:seek-samples:3:tolerance:0"]};
}
