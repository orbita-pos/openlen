// window.openlenApp: THE SCRIPT OPENLEN INJECTS INTO AN APP ON THE DESKTOP (spec local 2026-11-27-notificaciones-del-escritorio,
// §4.2), served at `/openlen-app.js` on the app's private host and built here as a string, like the tools' bridge
// (`lib/tools/bridge/client-source.ts`). In the frame it asks its parent —the window, `/desktop/<id>` on openlen.com— by
// `postMessage`; the window decides, draws the dialog and shows the notification (`protocol.ts` is the language).
//
//   · it posts only to `window.parent`, and always to an EXPLICIT origin, never "*": the one origin it was built with, or,
//     when it was built with several (localhost variants in development), the one the browser says framed it
//     (`location.ancestorOrigins[0]`, else the referrer's) when that is one of them, else the first (the app's);
//   · it takes an answer only from `window.parent`, from one of those origins, on its channel, for a request it made and
//     has not yet settled; a message of any other window, origin, channel or shape is nothing;
//   · request ids are random and unguessable (`crypto.randomUUID`, else `getRandomValues`; with neither it asks nothing);
//   · it carries nothing from OpenLen into the frame but the answers to its own requests: no session, no token, no state;
//   · `manage()` needs a CLICK or a KEY of the last 5 s in the frame, once each (`navigator.userActivation` when the
//     browser has it, on top of the events the script saw itself; only trusted events count), and posts nothing without;
//   · `state` and `show` and `manage` wait 30 s for the window; `request` waits on the person and has no limit;
//   · unframed (the private host opened by itself in a tab) there is no one to ask: every method rejects ENOTSUP.
// Every rejection is an `Error` whose `code` is `EPERM`, `EINVAL` or `ENOTSUP`. Plain ES5 on purpose: it runs before the
// app's bundle, in any browser. The window validates every request again (an app can post to its parent by hand), so the
// arguments go as the app gave them: `show({ body, title })` is the window's EINVAL, not something hidden here.
import { APP_API_CHANNEL } from "./protocol";

export const APP_API_TIMEOUT_MS = 30_000;
/** How long a click or a key press lets `manage()` through (Claude's transient activation). */
export const APP_API_GESTURE_MS = 5_000;

const ORIGIN = /^https?:\/\/[A-Za-z0-9.\-[\]:]+$/;

export function appApiClientSource(parentOrigins: readonly string[]): string {
  if (parentOrigins.length < 1) throw new Error("appApiClientSource needs at least one parent origin");
  for (const origin of parentOrigins) {
    if (!ORIGIN.test(origin)) throw new Error(`appApiClientSource: not an origin: ${JSON.stringify(origin)}`);
  }
  return `(function () {
  "use strict";
  var PARENTS = ${JSON.stringify(parentOrigins)};
  var CHANNEL = ${JSON.stringify(APP_API_CHANNEL)};
  var TIMEOUT = ${APP_API_TIMEOUT_MS};
  var GESTURE_MS = ${APP_API_GESTURE_MS};
  var CODES = ["EPERM", "EINVAL", "ENOTSUP"];
  var framed = !!window.parent && window.parent !== window;
  var pending = new Map();
  var gesture = { at: 0, spent: true };

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function randomId() {
    var c = window.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    if (c && typeof c.getRandomValues === "function") {
      var bytes = c.getRandomValues(new Uint8Array(16));
      var hex = "";
      for (var i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
      return hex;
    }
    return null;
  }

  function targetOrigin() {
    if (PARENTS.length === 1) return PARENTS[0];
    var seen = [];
    try { var ancestors = window.location.ancestorOrigins; if (ancestors && ancestors.length) seen.push(ancestors[0]); } catch (_) {}
    try { if (window.document.referrer) seen.push(new URL(window.document.referrer).origin); } catch (_) {}
    for (var i = 0; i < seen.length; i++) if (PARENTS.indexOf(seen[i]) >= 0) return seen[i];
    return PARENTS[0];
  }

  if (framed) {
    window.addEventListener("message", function (e) {
      if (e.source !== window.parent || PARENTS.indexOf(e.origin) < 0) return;
      var m = e.data;
      if (!m || typeof m !== "object" || m.channel !== CHANNEL || typeof m.id !== "string") return;
      var p = pending.get(m.id);
      if (!p) return;
      var failure = null;
      if (m.ok === false && typeof m.message === "string" && CODES.indexOf(m.code) >= 0) failure = fail(m.code, m.message);
      else if (m.ok !== true) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (failure) p.reject(failure); else p.resolve(m.value);
    });
    ["click", "keydown", "pointerdown", "touchend"].forEach(function (type) {
      window.addEventListener(type, function (e) {
        if (e && e.isTrusted === true) { gesture.at = Date.now(); gesture.spent = false; }
      }, true);
    });
  }

  function takeGesture() {
    var activation = window.navigator && window.navigator.userActivation;
    if (activation && activation.isActive !== true) return false;
    if (gesture.spent || Date.now() - gesture.at > GESTURE_MS) return false;
    gesture.spent = true;
    return true;
  }

  function call(method, args, waitsOnThePerson) {
    return new Promise(function (resolve, reject) {
      if (!framed) { reject(fail("ENOTSUP", "window.openlenApp only works inside the OpenLen desktop window")); return; }
      var id = randomId();
      if (!id) { reject(fail("ENOTSUP", "this browser has no secure random source")); return; }
      var timer = null;
      if (!waitsOnThePerson) timer = setTimeout(function () { pending.delete(id); reject(fail("ENOTSUP", "OpenLen did not answer")); }, TIMEOUT);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      try {
        window.parent.postMessage({ channel: CHANNEL, id: id, method: method, args: args }, targetOrigin());
      } catch (_) {
        pending.delete(id);
        clearTimeout(timer);
        reject(fail("EINVAL", "the arguments cannot be sent"));
      }
    });
  }

  window.openlenApp = Object.freeze({
    permissions: Object.freeze({
      state: function (name) { return call("permissions.state", name === undefined ? {} : { name: name }, false); },
      request: function (names) {
        return call("permissions.request", names === undefined ? {} : { names: typeof names === "string" ? [names] : names }, true);
      },
      manage: function () {
        if (framed && !takeGesture()) return Promise.reject(fail("EPERM", "permissions.manage() needs a click or a key press just before"));
        return call("permissions.manage", {}, false);
      }
    }),
    notification: Object.freeze({
      show: function (options) { return call("notification.show", options, false); }
    })
  });
})();
`;
}
