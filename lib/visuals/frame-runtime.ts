/**
 * THE BRIDGE THAT RUNS INSIDE A VISUAL'S FRAME (local spec
 * 2026-10-16-len-inline-visuals, §4.3–4.6), as the text of a script that
 * `buildVisualFrameDocument` embeds. Plain browser JavaScript, no build step:
 * the frame is another origin and loads nothing of ours.
 *
 * `__PARENT_ORIGINS__` is replaced by the JSON list of origins the frame takes
 * messages from. A `srcdoc` frame (origin "null") takes them from its parent.
 *
 * Two named functions do the painting, so the tests can reason about them:
 * - applyPartialHtml(container, html): the code so far, without its scripts;
 *   leading top-level nodes that didn't change are kept (same node), the rest
 *   replaced. A tag cut halfway is dropped by the HTML parser, never shown raw.
 * - renderFinal(container, code): the whole code once, then its scripts in
 *   document order, each as a new element; one with `src` is awaited (load or
 *   error) before the next; one that throws doesn't stop the others.
 */
export const FRAME_RUNTIME_JS = `(function () {
  "use strict";
  var PARENTS = __PARENT_ORIGINS__;
  var root = document.getElementById("root");
  var finalDone = false;

  function post(message) {
    try { window.parent.postMessage(message, "*"); } catch (e) {}
  }

  function reportHeight() {
    var h = Math.ceil(Math.max(root.scrollHeight, root.getBoundingClientRect().height));
    post({ kind: "ol-visual:height", height: h });
  }

  function parse(html) {
    var t = document.createElement("template");
    t.innerHTML = html;
    return t.content;
  }

  function withoutScripts(fragment) {
    var scripts = fragment.querySelectorAll("script");
    for (var i = 0; i < scripts.length; i++) scripts[i].parentNode.removeChild(scripts[i]);
    return fragment;
  }

  function applyPartialHtml(container, html) {
    var next = Array.prototype.slice.call(withoutScripts(parse(html)).childNodes);
    var i = 0;
    while (i < next.length && i < container.childNodes.length && container.childNodes[i].isEqualNode(next[i])) i++;
    while (container.childNodes.length > i) container.removeChild(container.lastChild);
    for (var j = i; j < next.length; j++) container.appendChild(next[j]);
  }

  function runScript(container, old) {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      for (var k = 0; k < old.attributes.length; k++) {
        var a = old.attributes[k];
        if (a.name !== "src") s.setAttribute(a.name, a.value);
      }
      var src = old.getAttribute("src");
      if (src) {
        s.onload = function () { resolve(); };
        s.onerror = function () { resolve(); };
        s.setAttribute("src", src);
        container.appendChild(s);
      } else {
        s.textContent = old.textContent;
        container.appendChild(s);
        resolve();
      }
    });
  }

  function renderFinal(container, code) {
    var scripts = Array.prototype.slice.call(parse(code).querySelectorAll("script"));
    applyPartialHtml(container, code);
    var chain = Promise.resolve();
    scripts.forEach(function (old) {
      chain = chain.then(function () { return runScript(container, old); });
    });
    return chain.then(reportHeight, reportHeight);
  }

  function applyTheme(theme, tokens) {
    var html = document.documentElement;
    html.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
    html.style.colorScheme = theme === "dark" ? "dark" : "light";
    for (var name in tokens) {
      if (Object.prototype.hasOwnProperty.call(tokens, name) && name.indexOf("--") === 0 && typeof tokens[name] === "string") {
        html.style.setProperty(name, tokens[name]);
      }
    }
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    if (location.origin !== "null" && PARENTS.indexOf(e.origin) < 0) return;
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.kind === "ol-visual:theme") {
      applyTheme(d.theme, d.tokens || {});
    } else if (d.kind === "ol-visual:render" && typeof d.code === "string" && !finalDone) {
      if (d.final) {
        finalDone = true;
        renderFinal(root, d.code);
      } else {
        applyPartialHtml(root, d.code);
        reportHeight();
      }
    }
  });

  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    e.preventDefault();
    post({ kind: "ol-visual:link", href: a.href });
  }, true);

  window.sendPrompt = function (text) {
    if (typeof text === "string" && text.trim()) post({ kind: "ol-visual:prompt", text: text.slice(0, 2000) });
  };
  window.openLink = function (url) {
    post({ kind: "ol-visual:link", href: String(url) });
  };

  if (typeof ResizeObserver === "function") new ResizeObserver(reportHeight).observe(root);
  post({ kind: "ol-visual:ready" });
})();`;
