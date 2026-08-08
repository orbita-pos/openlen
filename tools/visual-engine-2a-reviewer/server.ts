import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  appendVisualEngine2ADecision,
  buildBlindReviewDto,
  completeVisualEngine2AReview,
  resolveBlindEvidencePath,
  type BlindDecisionCommand,
  type VisualEngine2AReviewSession,
} from "@/lib/generation/visual-engine-2a-review-session";
import type { PilotComparisonVerdict } from "@/lib/generation/visual-engine-pilot-store";

export interface RunningReviewerServer {
  origin: string;
  close(): Promise<void>;
}

export interface ReviewerServerOptions {
  token: string;
  session: VisualEngine2AReviewSession;
  evidenceRoot?: string;
  persist(session: VisualEngine2AReviewSession): Promise<void>;
  recordComparison(runId: string, value: {
    verdict: PilotComparisonVerdict;
    acceptedForbiddenSignalCount: number;
  }): Promise<void>;
  readEvidence?: (relativePath: string) => Promise<Buffer>;
  now?: () => Date;
}

function json(res: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function text(res: ServerResponse, status: number, contentType: string, value: string) {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  res.end(value);
}

const REVIEW_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OpenLen Visual Review</title><style>body{font:16px system-ui;margin:24px;background:#111;color:#eee}main{max-width:1600px;margin:auto}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pair img{width:100%;background:#fff}button,select,textarea{font:inherit;margin:6px;padding:8px}textarea{display:block;width:min(600px,90%)}fieldset{margin-top:18px}</style></head><body><main id="app">Loading blind review…</main><script src="/app.js" defer></script></body></html>`;
const REVIEW_JS = `(()=>{const app=document.getElementById('app');let token=location.hash.slice(1);history.replaceState(null,'',location.pathname);const api=(path,init={})=>fetch(path,{...init,headers:{...(init.headers||{}),'x-openlen-review-token':token}}).then(async r=>{if(!r.ok)throw Error('request failed');return r.json()});let dto;async function load(){dto=await api('/api/session');draw()}function draw(){if(!dto.current){app.innerHTML='<h1>Review complete</h1><p>'+dto.progress.decided+'/'+dto.progress.total+'</p>';return}app.innerHTML='<h1>Visual Engine 2A blind review</h1><p>'+dto.progress.decided+'/'+dto.progress.total+'</p><p>Gate impact: ties are not wins; an accepted forbidden signal fails the gate.</p><button data-tab="normal">Normal copy</button><button data-tab="neutral">Copy neutralized</button><section class="pair"><figure><figcaption>Left</figcaption><img data-side="left"></figure><figure><figcaption>Right</figcaption><img data-side="right"></figure></section><fieldset><legend>Required visual checks</legend><label>Required signals present <select id="required"><option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option></select></label><label>Forbidden signals present <select id="forbidden"><option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option></select></label><label>Short note<textarea id="note" maxlength="200"></textarea></label><div>'+['left','right','tie','invalid'].map(x=>'<button disabled data-decision="'+x+'">'+x+'</button>').join('')+'</div></fieldset><p id="error"></p>';let tab='normal';const images=()=>{app.querySelector('[data-side=left]').src=dto.current.left[tab+'Url'];app.querySelector('[data-side=right]').src=dto.current.right[tab+'Url']};images();app.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;images()});const required=app.querySelector('#required'),forbidden=app.querySelector('#forbidden'),note=app.querySelector('#note'),error=app.querySelector('#error');const ready=()=>{const ok=required.value&&forbidden.value&&note.value.trim();app.querySelectorAll('[data-decision]').forEach(b=>b.disabled=!ok)};required.onchange=forbidden.onchange=note.oninput=ready;app.querySelectorAll('[data-decision]').forEach(b=>b.onclick=async()=>{try{dto=await api('/api/decision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({comparisonId:dto.current.comparisonId,decision:b.dataset.decision,requiredSignalsPresent:required.value==='yes',forbiddenSignalsPresent:forbidden.value==='yes',note:note.value.trim()})});draw()}catch{error.textContent='The decision could not be saved.'}})}load().catch(()=>app.textContent='Invalid or expired launch token.');})();`;

function authorized(req: IncomingMessage, token: string): boolean {
  const supplied = req.headers["x-openlen-review-token"];
  if (typeof supplied !== "string") return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function body(req: IncomingMessage): Promise<unknown> {
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new Error("media");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const value = Buffer.from(chunk); size += value.length;
    if (size > 16 * 1024) throw new Error("large");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeDefaultReader(root: string) {
  const resolvedRoot = resolve(root);
  return async (path: string) => {
    const target = resolve(resolvedRoot, path);
    const rel = relative(resolvedRoot, target);
    if (isAbsolute(rel) || rel.startsWith("..")) throw new Error("unsafe evidence path");
    return readFile(target);
  };
}

export async function startVisualEngine2AReviewerServer(options: ReviewerServerOptions): Promise<RunningReviewerServer> {
  if (options.token.length < 32) throw new Error("review token is too short");
  let session = structuredClone(options.session);
  const readEvidence = options.readEvidence ?? safeDefaultReader(options.evidenceRoot ?? "scratch/visual-engine-2a");
  const now = options.now ?? (() => new Date());
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname.startsWith("/api/") && !authorized(req, options.token)) {
        json(res, 401, { error: "unauthorized" }); return;
      }
      if (req.method === "GET" && requestUrl.pathname === "/") {
        text(res, 200, "text/html; charset=utf-8", REVIEW_HTML); return;
      }
      if (req.method === "GET" && requestUrl.pathname === "/app.js") {
        text(res, 200, "text/javascript; charset=utf-8", REVIEW_JS); return;
      }
      if (req.method === "GET" && requestUrl.pathname === "/api/session") {
        json(res, 200, buildBlindReviewDto(session)); return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/api/decision") {
        const command = await body(req) as BlindDecisionCommand;
        let next = appendVisualEngine2ADecision(session, command, now().toISOString());
        if (next.decisions.length === next.comparisons.length) next = completeVisualEngine2AReview(next, now().toISOString());
        await options.persist(next);
        const comparison = next.comparisons.find((row) => row.comparisonId === command.comparisonId)!;
        const decision = next.decisions.find((row) => row.comparisonId === command.comparisonId)!;
        await options.recordComparison(comparison.pilotRunId, {
          verdict: decision.verdict,
          acceptedForbiddenSignalCount: decision.acceptedForbiddenSignalCount,
        });
        session = next;
        json(res, 200, buildBlindReviewDto(session)); return;
      }
      const evidence = /^\/evidence\/([^/]+)\/(left|right)\/(normal|neutral)$/.exec(requestUrl.pathname);
      if (req.method === "GET" && evidence) {
        const comparisonId = decodeURIComponent(evidence[1]);
        if (comparisonId === "." || comparisonId === ".." || comparisonId.includes("/")) { json(res, 404, { error: "not_found" }); return; }
        const path = resolveBlindEvidencePath(session, comparisonId, evidence[2] as "left" | "right", evidence[3] as "normal" | "neutral");
        if (!path) { json(res, 404, { error: "not_found" }); return; }
        const image = await readEvidence(path);
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        res.end(image); return;
      }
      json(res, 404, { error: "not_found" });
    } catch (error) {
      const code = error instanceof Error && error.message === "media" ? 415
        : error instanceof Error && error.message === "large" ? 413 : 400;
      json(res, code, { error: "request_rejected" });
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("review server failed to bind");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  };
}
