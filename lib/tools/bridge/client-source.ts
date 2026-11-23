// window.openlen: THE SCRIPT OPENLEN INJECTS INTO A TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.4),
// served at `/openlen/tool-bridge.js` on the tool's private host. In a frame it asks its parent by `postMessage`
// with targetOrigin "*" — a request carries nothing secret, as the visuals' frame does — and takes an answer only
// from `window.parent`, from one of the app's origins, on the tool channel. Without a parent (Len's eyes run the
// tool top-level), it calls `window.__openlenBridge`, which Puppeteer exposes. Plain ES5 on purpose: it runs
// before the tool's bundle, in any browser. Keep the methods in step with `OPENLEN_TYPES` (lib/tools/skeleton.ts).
//
// Two variants of ONE script: an installed tool's (everything), and an AGENT's tool's (`{ lenArtifact: true }`, spec local
// 2026-11-22-artifacts-de-len, §3–§4), which exposes only `context`, `onContext`, `sendPrompt` and `data`.
// They share the channel, the origin checks, the timeouts and `call`; asking for no variant gives the installed tool's
// script exactly as it was (a test pins it).
import { BRIDGE_CHANNEL } from "./protocol";

export const BRIDGE_TIMEOUT_MS = 30_000;
/** The methods that wait on the person — OpenLen's dialog, the file picker — wait this long (§4.4). */
export const BRIDGE_PERSON_TIMEOUT_MS = 10 * 60_000;
export const WAITS_ON_THE_PERSON: readonly string[] = ["update", "jobs.run", "files.pick"];
/** How often `jobs.follow` asks. */
export const JOB_FOLLOW_EVERY_MS = 2_000;

export interface ToolBridgeClientOptions {
  /** The script of an agent's tool: `context`, `onContext`, `sendPrompt` and `data`, and nothing of an installed tool's. */
  readonly lenArtifact?: boolean;
}

// What only an installed tool's script has (jobs): the two constants, and — below — the helpers and the object.
const INSTALLED_CONSTANTS = `  var FOLLOW_EVERY = ${JOB_FOLLOW_EVERY_MS};
  var SETTLED = ["completed", "killed", "failed"];
`;

const INSTALLED_TAIL = `  function assign(target, source) {
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
  });`;

// The listener's extra branch in an agent tool's script: the parent's stream of its tool's documents.
const AGENT_DATA_BRANCH = ` else if (m.method === "data.changed") {
        onDataChanged(m.params);
      }`;

// An agent tool's database, from the tool's side. The parent holds the stream: on `data.subscribe` it tells a baseline (the
// whole set, again on every reconnect) and then each change. This keeps the documents it is told, and after EACH
// notification gives every subscriber the whole set (its own array) with the change that caused it (null for a baseline).
// Where an agent's tool posts its requests, which carry the person's data (data.set…): to the one parent it may have
// when there is only one, and once a parent has answered from one of its origins, to that origin — "*" only before then,
// and only where frame-ancestors already lets nothing else frame it. The installed tools' script stays as it was.
const AGENT_CONSTANTS = `  var target = PARENTS.length === 1 ? PARENTS[0] : "*";
`;
const AGENT_LEARNS_THE_PARENT = `
      target = e.origin;`;

const AGENT_TAIL = `  var docs = new Map();
  var subscribers = [];
  var streaming = false;
  var baselineSeen = false;

  function docKey(d) { return JSON.stringify([d.collection, d.docId]); }
  function isDoc(d) { return !!d && typeof d.collection === "string" && typeof d.docId === "string"; }
  // Documents are JSON: a deep copy kept here, and each subscriber keeps its OWN copies, so what one subscriber changes in
  // its copies never reaches the set kept here or another subscriber's. A change copies only the documents it names: the
  // others are the subscriber's copies from before (the same objects, so a screen can tell what didn't change).
  function copy(v) { return JSON.parse(JSON.stringify(v)); }

  // A document with null data is a removal, as the ones the parent names as deleted.
  function put(d) {
    if (!isDoc(d)) return;
    if (d.data === null) docs.delete(docKey(d)); else docs.set(docKey(d), copy(d));
  }

  // All of a subscriber's copies, made anew from the set kept here: its first snapshot, and every baseline.
  function copyAll(s) {
    s.copies = new Map();
    docs.forEach(function (d, key) { s.copies.set(key, copy(d)); });
  }

  // Only the documents a change names, for one subscriber: copied again if they are still here, forgotten if not.
  function copyChanged(s, keys) {
    keys.forEach(function (key) {
      if (docs.has(key)) s.copies.set(key, copy(docs.get(key))); else s.copies["delete"](key);
    });
  }

  function snapshotOf(s, change) {
    var all = [];
    s.copies.forEach(function (d) { all.push(d); });
    return { docs: all, change: change === null ? null : copy(change) };
  }

  function tell(change, keys) {
    subscribers.slice().forEach(function (s) {
      if (keys === null || !s.copies) copyAll(s); else copyChanged(s, keys);
      try { s.cb(snapshotOf(s, change)); } catch (_) {}
    });
  }

  function onDataChanged(p) {
    if (!p || typeof p !== "object") return;
    if (p.kind === "baseline" && Array.isArray(p.docs)) {
      docs = new Map();
      p.docs.forEach(function (d) { put(d); });
      baselineSeen = true;
      tell(null, null);
    } else if (p.kind === "change") {
      var keys = [];
      (Array.isArray(p.docs) ? p.docs : []).forEach(function (d) { if (isDoc(d)) { put(d); keys.push(docKey(d)); } });
      (Array.isArray(p.deleted) ? p.deleted : []).forEach(function (d) { if (isDoc(d)) { docs["delete"](docKey(d)); keys.push(docKey(d)); } });
      tell(p, keys);
    }
  }

  // The first subscriber opens the parent's stream; the next ones share it. One that arrives after a baseline is told on the
  // next microtask — after subscribe has returned its unsubscribe, so "var off = subscribe(function () { off(); })" works —
  // unless it unsubscribed first.
  function subscribe(cb) {
    if (typeof cb !== "function") throw new TypeError("openlen.data.subscribe needs a function");
    var s = { cb: cb };
    subscribers.push(s);
    if (!streaming) {
      streaming = true;
      // In a frame the baseline arrives as a notification; with no parent (Len's eyes) it is the answer itself.
      call("data.subscribe").then(function (r) {
        if (!framed && r && r.kind === "baseline") onDataChanged(r);
      }, function () { streaming = false; });
    }
    if (baselineSeen) {
      Promise.resolve().then(function () {
        // unsubscribed meanwhile, or already told by a notification that came first
        if (subscribers.indexOf(s) < 0 || s.copies) return;
        copyAll(s);
        try { cb(snapshotOf(s, null)); } catch (_) {}
      });
    }
    return function () {
      var at = subscribers.indexOf(s);
      if (at >= 0) subscribers.splice(at, 1);
    };
  }

  var data = Object.freeze({
    get: function (collection, docId) { return call("data.get", { collection: collection, docId: docId }); },
    set: function (collection, docId, value) { return call("data.set", { collection: collection, docId: docId, data: value }); },
    update: function (collection, docId, value) { return call("data.update", { collection: collection, docId: docId, data: value }); },
    "delete": function (collection, docId) { return call("data.delete", { collection: collection, docId: docId }); },
    list: function (collection) { return call("data.list", { collection: collection }); },
    query: function (collection, q) { return call("data.query", { collection: collection, query: q }); },
    subscribe: subscribe
  });

  // Task 8's Puppeteer calls this from Len's eyes (no parent to send messages) with a data.changed's params.
  if (!framed) window.__openlenBridgeNotify = onDataChanged;

  window.openlen = Object.freeze({
    context: function () { return call("context"); },
    onContext: function (cb) { listeners.add(cb); return function () { listeners.delete(cb); }; },
    sendPrompt: function (text) { return call("sendPrompt", { text: String(text) }); },
    data: data
  });`;

export function toolBridgeClientSource(parentOrigins: readonly string[], options: ToolBridgeClientOptions = {}): string {
  const lenArtifact = options.lenArtifact === true;
  return `(function () {
  "use strict";
  var PARENTS = ${JSON.stringify(parentOrigins)};
  var CHANNEL = ${JSON.stringify(BRIDGE_CHANNEL)};
  var TIMEOUT = ${BRIDGE_TIMEOUT_MS};
  var PERSON_TIMEOUT = ${BRIDGE_PERSON_TIMEOUT_MS};
  var WAITS = ${JSON.stringify(lenArtifact ? [] : WAITS_ON_THE_PERSON)};
${lenArtifact ? AGENT_CONSTANTS : INSTALLED_CONSTANTS}  var framed = window.parent && window.parent !== window;
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
      if (!m || m.jsonrpc !== "2.0" || m.channel !== CHANNEL) return;${lenArtifact ? AGENT_LEARNS_THE_PARENT : ""}
      if (typeof m.id === "number") {
        var p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.reject(fail(m.error)); else p.resolve(m.result);
      } else if (m.method === "context") {
        listeners.forEach(function (cb) { try { cb(m.params); } catch (_) {} });
      }${lenArtifact ? AGENT_DATA_BRANCH : ""}
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
        window.parent.postMessage(req, ${lenArtifact ? "target" : '"*"'});
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

${lenArtifact ? AGENT_TAIL : INSTALLED_TAIL}
})();
`;
}
