// Publish-time <form> wiring — turns the decorative forms in a generated /
// pasted / templated page into working lead-capture forms.
//
// At publish, every <form> on the page gets:
//   - action → the public OpenLen submit endpoint for this subdomain
//   - a hidden _openlen_form index (so the capture route maps a submission
//     back to its per-form config) + a hidden honeypot field
//   - data-openlen-form so the injected script can find it
//   - data-openlen-success / -redirect from the project's form config
// plus one <script> that submits inline via fetch (no page reload), with the
// native POST as the no-JS fallback. The editor HTML is untouched — only the
// published output carries this.

import * as cheerio from "cheerio";
import type { FormConfig } from "@/lib/projects/types";

function submitBase(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://openlen.com";
}

// Injected once per page. Submits any data-openlen-form inline; on success
// redirects (data-openlen-redirect) or swaps the form for a thank-you whose
// text is data-openlen-success (a default when unset). The `?openlen_form=ok`
// branch is the no-JS fallback path (native POST → 303 redirect back).
const FORM_SCRIPT = `(function(){
  function thanks(form){
    var msg=form.getAttribute('data-openlen-success')||'✓ Thanks — we got your message.';
    var box=document.createElement('div');
    box.setAttribute('data-openlen-form-thanks','');
    box.style.cssText='padding:16px;border-radius:10px;background:rgba(16,185,129,.12);color:#059669;font:500 14px/1.5 system-ui,-apple-system,sans-serif;text-align:center';
    box.textContent=msg;
    if(form.parentNode)form.parentNode.replaceChild(box,form);
  }
  function succeed(form){
    var to=form.getAttribute('data-openlen-redirect');
    if(to){location.href=to;return;}
    thanks(form);
  }
  if(/[?&]openlen_form=ok/.test(location.search)){
    var done=document.querySelector('form[data-openlen-form]');
    if(done)thanks(done);
  }
  document.addEventListener('submit',function(e){
    var form=e.target;
    if(!form||!form.matches||!form.matches('form[data-openlen-form]'))return;
    e.preventDefault();
    var btn=form.querySelector('button[type=submit],input[type=submit],button:not([type])');
    if(btn)btn.disabled=true;
    fetch(form.action,{method:'POST',body:new FormData(form),headers:{'Accept':'application/json'}})
      .then(function(r){if(!r.ok)throw 0;succeed(form);})
      .catch(function(){if(btn)btn.disabled=false;alert('Something went wrong — please try again.');});
  },true);
})();`;

const HONEYPOT =
  '<input type="text" name="_openlen_hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">';

/** Wire every <form> in the published HTML to OpenLen's submit endpoint,
 *  bake per-form config (from ProjectData.settings.forms, keyed by document-
 *  order index), and inject the inline-submit script. No-op when the page
 *  has no forms. */
export function wirePublishedForms(
  html: string,
  subdomain: string,
  formConfigs?: Record<string, FormConfig>,
): string {
  const $ = cheerio.load(html);
  const forms = $("form");
  if (forms.length === 0) return html;

  const action = `${submitBase()}/api/f/${subdomain}`;
  forms.each((i, el) => {
    const $form = $(el);
    $form.attr("action", action);
    $form.attr("method", "post");
    $form.attr("data-openlen-form", "");
    // The form's document-order index — the capture route reads it back to
    // find this form's per-form config (the notify email).
    if ($form.find('input[name="_openlen_form"]').length === 0) {
      $form.append(`<input type="hidden" name="_openlen_form" value="${i}">`);
    }
    if ($form.find('input[name="_openlen_hp"]').length === 0) {
      $form.append(HONEYPOT);
    }
    const cfg = formConfigs?.[String(i)];
    if (cfg?.successMessage) {
      $form.attr("data-openlen-success", cfg.successMessage);
    }
    if (cfg?.redirectUrl) {
      $form.attr("data-openlen-redirect", cfg.redirectUrl);
    }
  });

  if ($("script[data-openlen-form-script]").length === 0) {
    $("body").append(`<script data-openlen-form-script>${FORM_SCRIPT}</script>`);
  }
  return $.html();
}
