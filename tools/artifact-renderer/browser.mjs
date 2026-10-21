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
      if (r.url().split("#")[0] === "https://artifact.invalid/" && r.isNavigationRequest() && r.frame() === page.mainFrame()) void r.respond({ status: 200, contentType: "text/html", body: packet.html });
      else if (r.url().startsWith("data:") || r.url().startsWith("blob:")) void r.continue();
      // Chromium asks for a page without an icon declared; the author did not, so it is not a missing resource.
      else if (r.url() === "https://artifact.invalid/favicon.ico") void r.respond({ status: 204, body: "" });
      else { missing.add(r.url().slice(0, 500)); void r.abort("blockedbyclient"); }
    });
    // A Content-Security-Policy refusal never reaches request interception:
    // Chromium blocks it before the network (Linux acceptance: an image built at
    // runtime with a remote URL came back as "cannot be decoded"). Record those
    // in every document and frame; only real URLs, not inline/eval refusals.
    await page.evaluateOnNewDocument(() => {
      const blocked = [];
      Object.defineProperty(window, "__lenBlocked", { value: blocked });
      document.addEventListener("securitypolicyviolation", (event) => {
        const uri = String(event.blockedURI);
        if (blocked.length < 50 && /^[a-z][a-z0-9+.-]*:/i.test(uri) && !/^(data|blob):/i.test(uri)) blocked.push(uri.slice(0, 500));
      });
    });
    const blockedError = () => new Error("artifact_resource_missing", { cause: [...missing].slice(0, 8).map((url) => `${url}: blocked — a deliverable renders without network; use a local file, a catalog import or a saved asset`) });
    const collectBlocked = async () => {
      for (const frame of page.frames()) for (const uri of await frame.evaluate(() => window.__lenBlocked ?? []).catch(() => [])) missing.add(uri);
    };
    let result;
    try {
      // A screen of an app is a hash route ("#/reservar"): the request is the same, the app reads the hash.
      await page.goto(`https://artifact.invalid/${packet.route ?? ""}`, { waitUntil: "load" });
      // Chromium does not paint a cross-origin iframe outside the viewport, so
      // its requestAnimationFrame never fires: every slide below the first one
      // hung here until the watchdog (Linux acceptance, Chromium 155). Bring
      // each frame into view before waiting on it, then go back to the top.
      for (const frame of page.frames()) {
        const element = frame === page.mainFrame() ? null : await frame.frameElement();
        await element?.evaluate((el) => el.scrollIntoView({ block: "start" }));
        await frame.evaluate(async () => {
          await document.fonts.ready;
          if (window.lenReady && typeof window.lenReady.then === "function") await window.lenReady;
          await Promise.all([...document.images].map((img) => img.decode()));
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      result = await run(page);
    } catch (error) {
      // A blocked request is the cause, whatever it broke on the way (an image
      // that cannot decode, a script that never ran): name it, not the symptom.
      await collectBlocked();
      if (missing.size) throw blockedError();
      throw error;
    }
    await collectBlocked();
    if (missing.size) throw blockedError();
    if (errors.length) throw new Error("artifact_runtime_error", { cause: errors });
    result.checks.push("resources:complete", "runtime:no-errors");
    return result;
  } finally { clearTimeout(watchdog); await browser.close().catch(() => undefined); }
}
/**
 * What the drawn dashboard shows, checked as Claude's dashboards check themselves after a write: a NaN on the
 * page stops the export; an empty chart, labels over each other or cut off, and a marked figure that is not its
 * data's value are reported in the evidence for Len to fix. Closure-free: evaluated in the page.
 */
export function checkDashboardOutput() {
  const findings = [];
  const where = (el) => el.id ? `#${el.id}` : `${el.closest("[id]") ? `#${el.closest("[id]").id} ` : ""}${el.tagName.toLowerCase()}`;
  const shown = (el) => { const s = getComputedStyle(el); return s.visibility === "visible" && s.display !== "none" && el.getClientRects().length > 0; };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script,style,#len-data-provenance") || !shown(parent)) continue;
    const m = /(?:^|[^\w])(NaN|undefined|Infinity|\[object Object\])(?![\w])/.exec(node.textContent);
    if (m) findings.push({ kind: "not_a_number", where: where(parent), text: node.textContent.trim().slice(0, 60) });
  }
  for (const svg of document.querySelectorAll("svg")) {
    const r = svg.getBoundingClientRect();
    if (r.width < 80 || r.height < 60 || !shown(svg)) continue;
    const marks = [...svg.querySelectorAll("path,rect,circle,line,polyline,polygon,ellipse")].filter((m) => { const b = m.getBoundingClientRect(); return b.width > 0.5 || b.height > 0.5; });
    if (!marks.length) findings.push({ kind: "empty_chart", where: where(svg) });
    const labels = [...svg.querySelectorAll("text")].map((t) => [t, t.getBoundingClientRect()]).filter(([t, b]) => b.width > 0 && b.height > 0 && t.textContent.trim());
    const cut = labels.find(([, b]) => b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1);
    if (cut) findings.push({ kind: "labels_cut", where: where(svg), text: cut[0].textContent.trim().slice(0, 40) });
    outer: for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i][1], b = labels[j][1];
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) { findings.push({ kind: "labels_overlap", where: where(svg), text: `${labels[i][0].textContent.trim()} / ${labels[j][0].textContent.trim()}`.slice(0, 60) }); break outer; }
    }
  }
  for (const canvas of document.querySelectorAll("canvas")) {
    if (canvas.width < 80 || canvas.height < 60 || !shown(canvas)) continue;
    try { const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data; if (data && !data.some((v, i) => i % 4 === 3 && v > 0)) findings.push({ kind: "empty_chart", where: where(canvas) }); } catch { /* a WebGL canvas has no 2d context to read */ }
  }
  // A marked figure: data-source (+ data-field and data-where="col=value&…" or data-row) is that cell of that dataset.
  const datasets = window.lenData?.datasets ?? [];
  const numbers = (text) => {
    const out = [];
    for (const m of text.replace(/ | /g, " ").matchAll(/(-|−)?\d[\d.,\s]*(?:\d)?\s*(k|K|M|mil|millones)?\s*(%)?/g)) {
      const raw = m[0].replace(/[\s%]|k|K|M|mil|millones/g, ""), sign = m[1] ? -1 : 1, unit = m[2] === "k" || m[2] === "K" || m[2] === "mil" ? 1e3 : m[2] === "M" || m[2] === "millones" ? 1e6 : 1;
      const digits = raw.replace(/^[-−]/, "");
      for (const decimal of [".", ","]) {
        const other = decimal === "." ? "," : ".", parts = digits.split(decimal);
        if (parts.length > 2) continue;
        const whole = parts[0].split(other).join(""), frac = parts[1] ?? "";
        if (!/^\d+$/.test(whole) || (frac && !/^\d+$/.test(frac))) continue;
        out.push({ value: sign * Number(`${whole}.${frac || 0}`) * unit, step: 10 ** -frac.length * unit / 2, percent: !!m[3] });
      }
    }
    return out;
  };
  let marked = 0;
  for (const el of document.querySelectorAll("[data-source][data-field]")) {
    if (!shown(el)) continue;
    marked++;
    const d = datasets.find((x) => x.id === el.dataset.source), col = d ? d.columns.indexOf(el.dataset.field) : -1;
    let rows = d ? d.rows : [];
    if (el.dataset.row !== undefined) rows = rows.slice(Number(el.dataset.row), Number(el.dataset.row) + 1);
    if (el.dataset.where) for (const pair of el.dataset.where.split("&")) {
      const [k, v] = pair.split("=").map((s) => decodeURIComponent(s ?? "")), c = d ? d.columns.indexOf(k) : -1;
      rows = c < 0 ? [] : rows.filter((r) => String(r[c]) === v);
    }
    const label = `${where(el)} [${el.dataset.source}.${el.dataset.field}]`;
    if (!d || col < 0 || rows.length !== 1) { findings.push({ kind: "mark_unmatched", where: label }); continue; }
    const value = rows[0][col], text = el.textContent.trim();
    const ok = typeof value === "number" ? numbers(text).some((n) => [value, n.percent ? value * 100 : null].some((v) => v !== null && Math.abs(n.value - v) <= Math.max(n.step, 1e-9 * Math.abs(v))))
      : String(value ?? "").trim() !== "" && text.toLowerCase().includes(String(value).trim().toLowerCase());
    if (!ok) findings.push({ kind: "mark_mismatch", where: label, text: `shows "${text.slice(0, 30)}", data has ${JSON.stringify(value)}` });
  }
  return { findings: findings.slice(0, 20), marked };
}
export async function renderDashboardPacket(packet, options = {}) {
  return withArtifactPage(packet, options, async (page) => {
    const provenance = await page.$eval("#len-data-provenance", (e) => e.textContent);
    if (!provenance?.trim()) throw new Error("dataset_provenance_missing");
    const png = new Uint8Array(await page.screenshot({ type: "png" }));
    const checks = ["browser:rendered", "datasets:provenance-visible"];
    const output = await page.evaluate(checkDashboardOutput);
    const broken = output.findings.filter((f) => f.kind === "not_a_number");
    if (broken.length) throw new Error("dashboard_output_invalid", { cause: broken.map((f) => `not_a_number: ${f.where} shows "${f.text}" — a value did not load or was computed from missing data`) });
    checks.push(`marks:checked:${output.marked}`, ...output.findings.map((f) => `output:${f.kind}:${f.where}${f.text ? ` ${JSON.stringify(f.text)}` : ""}`.slice(0, 200)));
    // A probe that fails is reported, not fatal, as Claude's dashboards report a check: what was done, what the
    // page shows and what was expected, so it can be fixed without looking.
    for (const [index, probe] of packet.probes.entries()) {
      const failed = (what) => checks.push(`output:probe_failed:${index} ${what}`.slice(0, 200));
      const did = probe.select ? `after choosing "${probe.select.value}" in ${probe.select.selector}` : probe.click ? `after clicking ${probe.click}` : "on load";
      if (probe.select) {
        const options = await page.$$eval(probe.select.selector, (els) => els[0] ? [...els[0].querySelectorAll("option")].map((o) => o.value) : null);
        if (!options) { failed(`${probe.select.selector} is not on the page`); continue; }
        if (!(await page.select(probe.select.selector, probe.select.value)).length) { failed(`${probe.select.selector} has no option with value "${probe.select.value}" (values: ${options.slice(0, 8).map((o) => JSON.stringify(o)).join(", ")})`); continue; }
      }
      if (probe.click) {
        if (!(await page.$(probe.click))) { failed(`${probe.click} is not on the page`); continue; }
        await page.click(probe.click);
      }
      const ok = await page.waitForFunction((selector, text) => document.querySelector(selector)?.textContent?.trim() === text, { timeout: 5_000 }, probe.expect.selector, probe.expect.text).then(() => true, () => false);
      if (ok) { checks.push(`interaction:${index}:passed`); continue; }
      const shown = await page.$eval(probe.expect.selector, (el) => el.textContent.trim().slice(0, 60)).catch(() => null);
      failed(shown === null ? `${did}, ${probe.expect.selector} is not on the page` : `${did}, ${probe.expect.selector} shows ${JSON.stringify(shown)}; expected ${JSON.stringify(probe.expect.text)}`);
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
