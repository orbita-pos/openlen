// Publish-time <form> wiring — turns the decorative forms in a generated /
// pasted / templated page into working lead-capture forms. The actual DOM
// mutation lives in Rust (`@openlen/html-engine`'s `wirePublishedForms` via
// crates/html-engine/src/publish/forms.rs); this module just resolves the
// per-subdomain submit URL from the env and reshapes the per-form config
// from the project's Record<index, FormConfig> shape into the Vec the Rust
// function expects.

import {
  wirePublishedForms as rustWirePublishedForms,
  type WireFormConfig,
} from "@/lib/html-engine";
import type { FormConfig } from "@/lib/projects/types";
import { cidExpr } from "@/lib/analytics/cid";
import { parse } from "node-html-parser";
import {
  FORM_ID_ATTR,
  FORM_ID_FIELD,
  readFormIds,
  resolveFormConfigKey,
} from "@/lib/publish/form-identity";

function submitBase(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://openlen.com";
}

const CID_STAMP_MARKER = "data-ol-cid-stamp";

// Add the session visitor id to every OpenLen-wired <form> as a hidden input so
// the existing `new FormData(form)` submit (Rust forms.rs — untouched) carries
// it. The field is namespaced `_openlen_cid` (like `_openlen_hp`/`_openlen_form`)
// so it never collides with a real lead field. Done in JS, NOT in the markup, on
// purpose: a native no-JS POST leaves the input absent (= "untracked" lead),
// which the funnel reports honestly rather than pretending to attribute. Sealed
// like every other publish-time inline script (its hash enters script-src at
// the seal step). Idempotent + soft.
function injectFormCidStamp(html: string): string {
  if (html.includes(CID_STAMP_MARKER)) return html;
  // Only when the Rust pass actually wired a form to our submit endpoint.
  if (!html.includes("/api/f/")) return html;
  const script = `<script ${CID_STAMP_MARKER}>(function(){try{var c=${cidExpr()};if(!c)return;var fs=document.querySelectorAll('form[action*="/api/f/"]');for(var i=0;i<fs.length;i++){var f=fs[i];if(f.querySelector('input[name=_openlen_cid]'))continue;var h=document.createElement('input');h.type='hidden';h.name='_openlen_cid';h.value=c;f.appendChild(h)}}catch(e){}})();</script>`;
  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + script : html.slice(0, idx) + script + html.slice(idx);
}

/** Wire every <form> in the published HTML to OpenLen's submit endpoint,
 *  bake per-form config (from ProjectData.settings.forms), and inject the
 *  inline-submit script. No-op when the page has no forms.
 *
 *  Multi-page: `page` is the site-page slug this document publishes as
 *  (null/absent = home). It rides the action's query string — the Rust pass
 *  writes the action verbatim and both the inline-submit fetch and a native
 *  POST preserve it — so the submit endpoint can resolve page-scoped config
 *  and attribute the lead. Config keys: home forms use the legacy document-
 *  order index ("0"); site-page forms use "<slug>:<index>", falling back to
 *  the shared legacy key when no scoped entry exists. */
export function wirePublishedForms(
  html: string,
  subdomain: string,
  formConfigs?: Record<string, FormConfig>,
  page?: string | null,
): string {
  const action =
    `${submitBase()}/api/f/${subdomain}` +
    (page ? `?page=${encodeURIComponent(page)}` : "");
  // La resolución la decide `resolveFormConfigKey`, compartida con el endpoint
  // de envío: si publicar y recibir resolvieran distinto, el lead se iría a
  // otro sitio sin que ningún índice lo explicara. Identidad propia primero,
  // clave con página después, índice heredado al final.
  const cfgs = formConfigs ?? {};
  const ids = readFormIds(html);
  const byIndex = new Map<number, FormConfig>();
  for (let i = 0; i < ids.length; i++) {
    const key = resolveFormConfigKey(ids, i, page, cfgs);
    if (key) byIndex.set(i, cfgs[key] as FormConfig);
  }
  // Sin `<form>` legibles (documento raro, parser caído) se conserva la ruta de
  // siempre: las claves numéricas tal cual. Perder el aviso de éxito de un
  // formulario por un fallo de lectura sería peor que la ambigüedad heredada.
  if (ids.length === 0) {
    for (const [k, v] of Object.entries(cfgs)) {
      if (/^\d+$/.test(k)) byIndex.set(Number(k), v);
    }
    if (page) {
      const prefix = `${page}:`;
      for (const [k, v] of Object.entries(cfgs)) {
        if (!k.startsWith(prefix)) continue;
        const idx = Number(k.slice(prefix.length));
        if (Number.isInteger(idx) && idx >= 0) byIndex.set(idx, v);
      }
    }
  }
  const configs: WireFormConfig[] = [...byIndex.entries()].map(
    ([index, v]) => ({
      index,
      successMessage: v.successMessage,
      redirectUrl: v.redirectUrl,
    }),
  );
  const wired = rustWirePublishedForms(html, action, configs);
  return injectFormCidStamp(injectFormIdField(wired));
}

/**
 * El identificador del formulario, como campo oculto ESTÁTICO.
 *
 * Estático y no inyectado por JavaScript —al revés que `_openlen_cid`, donde la
 * ausencia significa algo— porque de esto depende a qué correo llega un lead:
 * un POST nativo sin JavaScript tiene que enrutar igual de bien. Idempotente y
 * blando: cualquier fallo deja el documento como estaba y el endpoint cae a la
 * ruta por índice.
 */
function injectFormIdField(html: string): string {
  if (!html.includes(FORM_ID_ATTR) || !html.includes("/api/f/")) return html;
  try {
    const dom = parse(html);
    let añadidos = 0;
    for (const form of dom.querySelectorAll("form")) {
      const id = form.getAttribute(FORM_ID_ATTR)?.trim();
      if (!id) continue;
      // Sólo los que apuntan a nuestro buzón: un `<form>` ajeno del usuario no
      // se toca.
      if (!(form.getAttribute("action") ?? "").includes("/api/f/")) continue;
      if (form.querySelector(`input[name="${FORM_ID_FIELD}"]`)) continue;
      form.insertAdjacentHTML(
        "beforeend",
        `<input type="hidden" name="${FORM_ID_FIELD}" value="${id}">`,
      );
      añadidos++;
    }
    return añadidos === 0 ? html : dom.toString();
  } catch {
    return html;
  }
}
