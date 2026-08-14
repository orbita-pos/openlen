import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import {
  appendBlindDecisionToSessionFile,
  completeBlindReviewSessionFile,
  createBlindReviewSession,
  ensureBlindReviewSessionFile,
  loadVerifiedBlindReviewSource,
  resolveVerifiedBlindArtifact,
} from "@/lib/generation/fable-parity-review-session";
import type { BlindDecision } from "@/lib/generation/fable-parity-scorecard";

type Environment = Readonly<Record<string, string | undefined>>;

export function validateFableParityReviewServerEnvironment(env: Environment): {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
} {
  if (env.OPENLEN_FABLE_REVIEW_HOST !== "127.0.0.1") throw new Error("review server must bind to localhost loopback 127.0.0.1");
  const token = env.OPENLEN_FABLE_REVIEW_TOKEN?.trim() ?? "";
  if (token.length < 32 || !/^[\x21-\x7e]+$/.test(token)) throw new Error("review token must contain at least 32 visible ASCII characters");
  const port = Number(env.OPENLEN_FABLE_REVIEW_PORT ?? "4319");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("invalid review port");
  return { host: "127.0.0.1", port, token };
}

function authorized(request: IncomingMessage, token: string): boolean {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(value.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(token, "utf8");
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > 64 * 1024) throw new Error("request body too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const REVIEW_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Blind parity review</title><style>
body{font-family:system-ui,sans-serif;margin:24px;background:#111;color:#eee}button,input,select{font:inherit}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.shot{width:100%;background:#fff}.controls{position:sticky;bottom:0;background:#111;padding:16px 0}label{display:block;margin:8px 0}
</style></head><body><h1>Blind A/B review</h1><label>Review token <input id="token" type="password" autocomplete="off"></label><button id="load">Load verified comparison</button><main id="app"></main><script>
const app=document.querySelector('#app');let source,index=0;const auth=()=>({authorization:'Bearer '+document.querySelector('#token').value});
document.querySelector('#load').onclick=async()=>{const r=await fetch('/api/review',{headers:auth()});if(!r.ok){app.textContent='Access denied or integrity failure';return}source=await r.json();render()};
async function blob(url){const r=await fetch(url,{headers:auth()});if(!r.ok)throw new Error();return URL.createObjectURL(await r.blob())}
async function render(){const c=source.comparisons[index];if(!c){app.textContent='All comparisons displayed. Lock the session through the completion endpoint.';return}app.innerHTML='<p>'+(index+1)+' / '+source.comparisons.length+'</p><pre id="prompt"></pre><div class="grid"><section><h2>A</h2><img class="shot" id="ad"><img class="shot" id="am"></section><section><h2>B</h2><img class="shot" id="bd"><img class="shot" id="bm"></section></div><div class="controls"><label>Desktop <select id="desktop"><option>A</option><option>tie</option><option>B</option></select></label><label>Mobile <select id="mobile"><option>A</option><option>tie</option><option>B</option></select></label><label>Overall <select id="overall"><option>A</option><option>tie</option><option>B</option></select></label><label>Wrong niche <select id="wrong"><option>none</option><option>A</option><option>B</option><option>both</option></select></label><label>Niche <input id="niche" type="number" min="1" max="10" value="7"></label><label>Fidelity <input id="fidelity" type="number" min="1" max="10" value="7"></label><label>Polish <input id="polish" type="number" min="1" max="10" value="7"></label><label>Coherence <input id="coherence" type="number" min="1" max="10" value="7"></label><label>Usability <input id="usability" type="number" min="1" max="10" value="7"></label><button id="save">Lock decision</button></div>';
document.querySelector('#prompt').textContent=JSON.stringify(await (await fetch(c.promptManifestUrl,{headers:auth()})).json(),null,2);for(const [id,url] of [['ad',c.A.desktopUrl],['am',c.A.mobileUrl],['bd',c.B.desktopUrl],['bm',c.B.mobileUrl]])document.querySelector('#'+id).src=await blob(url);
document.querySelector('#save').onclick=async()=>{const scores={niche:Number(niche.value),fidelity:Number(fidelity.value),polish:Number(polish.value),coherence:Number(coherence.value),usability:Number(usability.value)};const r=await fetch('/api/decision',{method:'POST',headers:{...auth(),'content-type':'application/json'},body:JSON.stringify({comparisonId:c.comparisonId,desktopPreference:desktop.value,mobilePreference:mobile.value,overallPreference:overall.value,wrongNicheSide:wrong.value,rubric:scores})});if(!r.ok){alert('Decision rejected');return}index++;render()}}
</script></body></html>`;

export function createFableParityReviewHandler(options: {
  workspaceRoot: string;
  manifestPath: string;
  sessionPath: string;
  token: string;
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(REVIEW_HTML);
        return;
      }
      if (!authorized(request, options.token)) {
        json(response, 401, { error: "unauthorized" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/review") {
        json(response, 200, await loadVerifiedBlindReviewSource(options.workspaceRoot, options.manifestPath));
        return;
      }
      const artifact = url.pathname.match(/^\/artifact\/([a-f0-9]{24})\/(?:(A|B)\/(desktop|mobile)|prompt)$/);
      if (request.method === "GET" && artifact) {
        const comparisonId = artifact[1]!;
        const kind = (artifact[4] === "prompt" ? "prompt" : artifact[3]) as "prompt" | "desktop" | "mobile";
        const side = (artifact[2] ?? null) as "A" | "B" | null;
        const resolved = await resolveVerifiedBlindArtifact(options.workspaceRoot, options.manifestPath, comparisonId, side, kind);
        response.writeHead(200, {
          "content-type": resolved.contentType,
          "cache-control": "no-store",
        });
        response.end(Buffer.from(resolved.bytes));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/decision") {
        const input = await body(request) as Omit<BlindDecision, "reviewerSessionId">;
        const updated = await appendBlindDecisionToSessionFile(options.workspaceRoot, options.manifestPath, options.sessionPath, input);
        json(response, 200, { locked: true, decided: updated.decisions.length });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/complete") {
        const completed = await completeBlindReviewSessionFile(
          options.workspaceRoot,
          options.manifestPath,
          options.sessionPath,
          new Date().toISOString(),
        );
        json(response, 200, { locked: true, decisions: completed.decisions.length });
        return;
      }
      json(response, 404, { error: "not_found" });
    } catch {
      json(response, 409, { error: "integrity_or_decision_rejected" });
    }
  };
}

async function main(): Promise<void> {
  const config = validateFableParityReviewServerEnvironment(process.env);
  const workspaceRoot = process.cwd();
  const manifestPath = process.env.OPENLEN_FABLE_REVIEW_MANIFEST_PATH?.trim();
  const sessionPath = process.env.OPENLEN_FABLE_REVIEW_SESSION_PATH?.trim();
  const reviewerSessionId = process.env.OPENLEN_FABLE_REVIEW_SESSION_ID?.trim();
  if (!manifestPath || !sessionPath || !reviewerSessionId) throw new Error("review manifest/session configuration is required");
  const source = await loadVerifiedBlindReviewSource(workspaceRoot, manifestPath);
  await ensureBlindReviewSessionFile(
    workspaceRoot,
    sessionPath,
    createBlindReviewSession(reviewerSessionId, source.artifactManifestSha256),
  );
  const server = createServer(createFableParityReviewHandler({ workspaceRoot, manifestPath, sessionPath, token: config.token }));
  server.listen(config.port, config.host, () => {
    console.log(`Blind reviewer listening on http://${config.host}:${config.port}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    console.error("Fable parity reviewer failed to start (details redacted).");
    process.exitCode = 1;
  });
}
