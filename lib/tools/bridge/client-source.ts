// window.openlen: THE SCRIPT OPENLEN INJECTS INTO A TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.4),
// served at `/openlen/tool-bridge.js` on the tool's private host. In a frame it asks its parent by `postMessage`
// with targetOrigin "*" — a request carries nothing secret, as the visuals' frame does — and takes an answer only
// from `window.parent`, from one of the app's origins, on the tool channel. Without a parent (Len's eyes run the
// tool top-level), it calls `window.__openlenBridge`, which Puppeteer exposes. Plain ES5 on purpose: it runs
// before the tool's bundle, in any browser. Keep the methods in step with `OPENLEN_TYPES` (lib/tools/skeleton.ts).
import { BRIDGE_CHANNEL } from "./protocol";

export const BRIDGE_TIMEOUT_MS = 30_000;
/** The methods that wait on the person — OpenLen's dialog, the file picker — wait this long (§4.4). */
export const BRIDGE_PERSON_TIMEOUT_MS = 10 * 60_000;
export const WAITS_ON_THE_PERSON: readonly string[] = ["update", "jobs.run", "files.pick"];
/** How often `jobs.follow` asks. */
export const JOB_FOLLOW_EVERY_MS = 2_000;

export function toolBridgeClientSource(parentOrigins: readonly string[]): string {
  return `(function () {
  "use strict";
  var PARENTS = ${JSON.stringify(parentOrigins)};
  var CHANNEL = ${JSON.stringify(BRIDGE_CHANNEL)};
  var TIMEOUT = ${BRIDGE_TIMEOUT_MS};
  var PERSON_TIMEOUT = ${BRIDGE_PERSON_TIMEOUT_MS};
  var WAITS = ${JSON.stringify(WAITS_ON_THE_PERSON)};
  var FOLLOW_EVERY = ${JOB_FOLLOW_EVERY_MS};
  var SETTLED = ["completed", "killed", "failed"];
  var framed = window.parent && window.parent !== window;
  var next = 1;
  var pending = new Map();
  var listeners = new Set();

  function fail(error) {
    var e = new Error(error && error.message ? error.message : "bridge_error");
    if (error) { e.code = error.code; e.data = error.data; }
    return e;
  }

  if (framed) {
    window.addEventListener("message", function (e) {
      if (e.source !== window.parent || PARENTS.indexOf(e.origin) < 0) return;
      var m = e.data;
      if (!m || m.jsonrpc !== "2.0" || m.channel !== CHANNEL) return;
      if (typeof m.id === "number") {
        var p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.reject(fail(m.error)); else p.resolve(m.result);
      } else if (m.method === "context") {
        listeners.forEach(function (cb) { try { cb(m.params); } catch (_) {} });
      }
    });
  }

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = next++;
      var req = { jsonrpc: "2.0", id: id, method: method, channel: CHANNEL };
      if (params !== undefined) req.params = params;
      if (framed) {
        var timer = setTimeout(function () { pending.delete(id); reject(new Error("bridge_timeout")); }, WAITS.indexOf(method) >= 0 ? PERSON_TIMEOUT : TIMEOUT);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        window.parent.postMessage(req, "*");
      } else if (typeof window.__openlenBridge === "function") {
        Promise.resolve(window.__openlenBridge(JSON.stringify(req))).then(function (raw) {
          var m = JSON.parse(raw);
          if (m.error) reject(fail(m.error)); else resolve(m.result);
        }, reject);
      } else {
        reject(new Error("bridge_unavailable"));
      }
    });
  }

  function assign(target, source) {
    if (source) for (var k in source) if (Object.prototype.hasOwnProperty.call(source, k)) target[k] = source[k];
    return target;
  }

  function idsOf(files) {
    if (!files) return undefined;
    return Array.prototype.map.call(files, function (f) { return typeof f === "string" ? f : f && f.id; });
  }

  // DeepSeek's job registry from the tool's side: follow asks every 2 s and tells each change until it settles.
  function follow(id, onUpdate) {
    return new Promise(function (resolve, reject) {
      var last = "";
      function ask() {
        call("jobs.get", { id: id }).then(function (job) {
          var seen = JSON.stringify(job);
          if (seen !== last) { last = seen; if (typeof onUpdate === "function") { try { onUpdate(job); } catch (_) {} } }
          if (job && SETTLED.indexOf(job.status) >= 0) resolve(job); else setTimeout(ask, FOLLOW_EVERY);
        }, reject);
      }
      ask();
    });
  }

  var jobs = Object.freeze({
    run: function (name, options) {
      var o = options || {};
      return call("jobs.run", { name: String(name), input: o.input, files: idsOf(o.files) });
    },
    get: function (id) { return call("jobs.get", { id: String(id) }); },
    cancel: function (id) { return call("jobs.cancel", { id: String(id) }); },
    list: function () { return call("jobs.list"); },
    follow: follow
  });

  var files = Object.freeze({
    pick: function (options) {
      var o = options || {};
      return call("files.pick", { accept: o.accept, multiple: !!o.multiple });
    },
    deliver: function (file) {
      var f = file || {};
      return call("files.deliver", { name: String(f.name || "file"), contentType: f.contentType, bytes: f.bytes });
    }
  });

  window.openlen = Object.freeze({
    context: function () { return call("context"); },
    onContext: function (cb) { listeners.add(cb); return function () { listeners.delete(cb); }; },
    backend: function () { return call("backend"); },
    projects: function () { return call("projects"); },
    forms: function (projectId, options) { return call("forms", assign({ projectId: projectId }, options)); },
    visits: function (projectId, options) { return call("visits", assign({ projectId: projectId }, options)); },
    query: function (projectId, sql) { return call("query", { projectId: projectId, sql: sql }); },
    update: function (projectId, change) { return call("update", assign({ projectId: projectId }, change)); },
    sendPrompt: function (text) { return call("sendPrompt", { text: String(text) }); },
    jobs: jobs,
    files: files
  });
})();
`;
}
