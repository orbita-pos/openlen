// A MADE-UP PROVIDER for the return bench's $0 REHEARSAL (spec local 2026-11-13-conversar-todo-el-mes, §8):
// the whole bench — its server, the route, the three arms, the summary, the report — run end to end without a
// single request reaching a model provider.
//
// Loaded with NODE_OPTIONS=--import=file:///<abs path>/scripts/len-bench-return-fake-provider.mjs in BOTH the
// bench's server and its runner, it wraps globalThis.fetch and answers every POST to the providers' chat
// endpoints itself; everything else passes through untouched.
//
// 🔴 It installs itself ONLY in a rehearsal: never with NODE_ENV=production, and only when the provider's key
// in the environment is a rehearsal's (`DEEPINFRA_API_KEY=rehearsal-…`, which is not a key — a request that
// escaped would get a 401 for nothing). Anywhere else, importing it does nothing and says so on stderr.
//
// The rehearsal, as it was run on 2026-11-14 (a throwaway local Postgres with the schema pushed):
//   an env file with DATABASE_URL and DATABASE_URL_DIRECT (local), PAGES_DATABASE_URL= (empty), AUTH_SECRET
//   (random), AUTH_TRUST_HOST=true, EVAL_USER_EMAIL=rehearsal+openlen-eval@example.test,
//   DEEPINFRA_API_KEY=rehearsal-not-a-key, FIREWORKS_API_KEY=rehearsal-not-a-key, E2B_API_KEY= and the
//   NODE_OPTIONS above; then, with tsx --env-file=<that file> and --dir=<a folder of its own>:
//     scripts/len-bench-return-server.ts --config=build   →  scripts/len-bench-return.ts build --pilot --budget-usd=2 --yes
//     … --config=today                                    →  … run --arm=today --pilot --runs=1 --budget-usd=2 --yes
//     … --config=new                                      →  … run --arm=trim … and run --arm=trim_summary …, then report --pilot
//   Its «dollars» are the bench's own count over made-up usage: nothing is spent.
//
// What it answers, so the whole path is exercised:
//   · a request that ends with the compaction instruction → a short summary;
//   · the first call of a turn → one `web_search` call with the person's words (the bench's fixed web answers);
//   · the call after a tool result → a long answer, so the conversation has some weight.
// It reports usage like a provider with a prefix cache: what a request shares with the previous one of the
// same cache key comes back as cached. It writes nothing to stdout (npx reads it); with
// OPENLEN_FAKE_PROVIDER_LOG=<file>, one line per call goes there.
import fs from "node:fs";

const HOSTS = ["api.deepinfra.com", "api.fireworks.ai"];
const rehearsal = process.env.NODE_ENV !== "production" && /^rehearsal-/.test(process.env.DEEPINFRA_API_KEY ?? "");

if (!rehearsal) {
  process.stderr.write("[fake-provider] not a rehearsal (NODE_ENV=production, or DEEPINFRA_API_KEY is not «rehearsal-…»): nothing was installed\n");
} else {
  const real = globalThis.fetch;
  const previous = new Map();
  let calls = 0;

  const tokens = (text) => Math.ceil(text.length / 3.5);
  const textOf = (content) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("") : "");
  const FILLER = "Esto es una respuesta de ensayo, sin modelo detrás; sólo ocupa el sitio de una de verdad. ".repeat(45);

  const reply = (body) => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const last = messages.at(-1);
    if (last?.role === "user" && /compaction engine|compacted-summary/i.test(textOf(last.content))) {
      return { text: "## Primary Request and Intent\n- Ensayo sin modelo: la persona comparó catálogos y dejó dos finalistas.\n## Pending\n- (none)" };
    }
    const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
    const afterAssistant = messages.slice(lastAssistant + 1);
    const canSearch = (body.tools ?? []).some((t) => t?.function?.name === "web_search") && body.tool_choice !== "none";
    if (canSearch && !afterAssistant.some((m) => m.role === "tool")) {
      const asked = textOf([...afterAssistant].reverse().find((m) => m.role === "user")?.content).slice(0, 120) || "catálogo";
      return { tool: { name: "web_search", args: JSON.stringify({ queries: [asked] }) } };
    }
    return { text: `Respuesta de ensayo número ${calls}. ${FILLER}` };
  };

  const usageOf = (body, written) => {
    const prompt = JSON.stringify(body.messages ?? []) + JSON.stringify(body.tools ?? []);
    const key = String(body.prompt_cache_key ?? body.user ?? "");
    const before = previous.get(key) ?? "";
    let shared = 0;
    while (shared < before.length && shared < prompt.length && before.charCodeAt(shared) === prompt.charCodeAt(shared)) shared += 1;
    previous.set(key, prompt);
    const completion = tokens(written);
    return { prompt_tokens: tokens(prompt), completion_tokens: completion, total_tokens: tokens(prompt) + completion, prompt_tokens_details: { cached_tokens: Math.floor(shared / 3.5) } };
  };

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      return real(input, init);
    }
    if (!HOSTS.includes(host) || (init?.method ?? "GET").toUpperCase() !== "POST") return real(input, init);
    let body = {};
    try {
      body = JSON.parse(String(init?.body ?? "{}"));
    } catch {
      // An unreadable body is answered like an empty conversation.
    }
    calls += 1;
    const r = reply(body);
    const usage = usageOf(body, r.text ?? r.tool.args);
    const log = process.env.OPENLEN_FAKE_PROVIDER_LOG;
    if (log) {
      try {
        fs.appendFileSync(log, `${new Date().toISOString()} #${calls} ${host} ${r.tool ? `tool ${r.tool.name}` : "text"} · prompt ${usage.prompt_tokens} cached ${usage.prompt_tokens_details.cached_tokens}\n`);
      } catch {
        // A log that cannot be written never touches the call.
      }
    }
    const model = String(body.model ?? "fake");
    const toolCall = r.tool ? [{ index: 0, id: `call_${calls}`, type: "function", function: { name: r.tool.name, arguments: r.tool.args } }] : null;
    if (!body.stream) {
      const message = toolCall ? { role: "assistant", content: null, tool_calls: toolCall } : { role: "assistant", content: r.text };
      return new Response(JSON.stringify({ model, choices: [{ index: 0, message, finish_reason: toolCall ? "tool_calls" : "stop" }], usage }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const chunks = [
      { model, choices: [{ index: 0, delta: { role: "assistant", ...(toolCall ? { tool_calls: toolCall } : { content: r.text }) } }] },
      { model, choices: [{ index: 0, delta: {}, finish_reason: toolCall ? "tool_calls" : "stop" }] },
      { model, choices: [], usage },
    ];
    return new Response(`${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}
