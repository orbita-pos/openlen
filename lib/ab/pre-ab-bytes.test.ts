// @vitest-environment node
// WITHOUT AN EXPERIMENT, A PAGE'S BYTES ARE THE ONES IT HAD BEFORE A/B TESTING (review item 2; master 04b218999).
//
// The analytics snippet and the form stamp are baked into EVERY published page, and a release is content-addressed:
// one extra byte changes every site's sha and weighs on every page. The A/B reader (sessionStorage `ol_ab`, the CTA
// click handler, the `_openlen_ab` stamp) is emitted only on a document that carries an experiment tag (`abTag`).
import { describe, expect, it, vi } from "vitest";

// The Rust binding can't load under vitest: stand in for it with what the pass does to the markup that matters here.
vi.mock("@/lib/html-engine", () => ({
  wirePublishedForms: (html: string, action: string) =>
    html.replace(/<form(\s|>)/g, `<form action="${action}" method="post"$1`),
}));

import { cidExpr, sourceExpr } from "@/lib/analytics/cid";
import { injectAnalyticsSnippet } from "@/lib/analytics/snippet";
import { wirePublishedForms } from "@/lib/publish/forms";

/** The snippet exactly as master 04b218999 emitted it (its template, copied). */
const preAbSnippet = (projectId: string, page: string | null) => `<script>(function(){
var P=${JSON.stringify(projectId)},G=${JSON.stringify(page)},E="/c/"+P;
var CID=${cidExpr()},SRC=${sourceExpr()};
function s(d){try{d.p=G;if(CID)d.cid=CID;var b=JSON.stringify(d);
if(navigator.sendBeacon)navigator.sendBeacon(E,b);
else fetch(E,{method:"POST",body:b,keepalive:true,headers:{"content-type":"application/json"}});}catch(e){}}
s({t:"v",r:document.referrer||null,s:SRC});
document.addEventListener("click",function(e){
var a=e.target.closest&&e.target.closest('a[href^=http]');if(!a)return;
try{if(new URL(a.href).host===location.host)return;}catch(_){return;}
s({t:"c",h:a.href,l:(a.textContent||"").trim().slice(0,80)});
},true);})();</script>`;

/** The form stamp exactly as master 04b218999 emitted it. */
const preAbFormStamp = `<script data-ol-cid-stamp>(function(){try{var c=${cidExpr()};if(!c)return;var fs=document.querySelectorAll('form[action*="/api/f/"]');for(var i=0;i<fs.length;i++){var f=fs[i];if(f.querySelector('input[name=_openlen_cid]'))continue;var h=document.createElement('input');h.type='hidden';h.name='_openlen_cid';h.value=c;f.appendChild(h)}}catch(e){}})();</script>`;

const PAGE = "<html><body><h1>Hola</h1></body></html>";

describe("the analytics snippet", () => {
  it("🔴 with no experiment tag it is byte-for-byte the pre-A/B snippet (home, subpage, explicit null)", () => {
    expect(injectAnalyticsSnippet(PAGE, "proj-1", null)).toBe(PAGE.replace("</body>", `${preAbSnippet("proj-1", null)}</body>`));
    expect(injectAnalyticsSnippet(PAGE, "proj-1", "menu")).toBe(PAGE.replace("</body>", `${preAbSnippet("proj-1", "menu")}</body>`));
    expect(injectAnalyticsSnippet(PAGE, "proj-1", "menu", null)).toBe(injectAnalyticsSnippet(PAGE, "proj-1", "menu"));
  });

  it("no experiment ⇒ nothing of the A/B reader on the page", () => {
    const out = injectAnalyticsSnippet(PAGE, "proj-1", null);
    expect(out).not.toContain("ol_ab");
    expect(out).not.toContain('"cta"');
    expect(out).not.toContain("ol_ab_");
  });

  it("a garbage tag is no tag: still the pre-A/B bytes", () => {
    expect(injectAnalyticsSnippet(PAGE, "proj-1", null, "not a tag")).toBe(injectAnalyticsSnippet(PAGE, "proj-1", null));
  });

  it("with a tag the page carries the variant and the CTA handler", () => {
    const out = injectAnalyticsSnippet(PAGE, "proj-1", null, "ab_1234abcd:b");
    expect(out).toContain('var AB="ab_1234abcd:b"');
    expect(out).toContain("d.ab=AB");
    expect(out).toContain('t:"cta"');
    // The pre-A/B external-link report is still there.
    expect(out).toContain('s({t:"c",h:a.href');
  });
});

describe("the form wiring", () => {
  const FORM_PAGE = '<html><body><form><input name="email"></form></body></html>';

  it("🔴 with no experiment tag the form stamp is byte-for-byte the pre-A/B one and no A/B field is added", () => {
    const out = wirePublishedForms(FORM_PAGE, "mi-sitio", undefined, null);
    expect(out).toContain(preAbFormStamp);
    expect(out).not.toContain("_openlen_ab");
    expect(out).not.toContain("ol_ab");
    // Same page, with and without the explicit null.
    expect(wirePublishedForms(FORM_PAGE, "mi-sitio", undefined, null, null)).toBe(out);
  });

  it("with a tag the form carries the variant as a static hidden field (no JS needed)", () => {
    const out = wirePublishedForms(FORM_PAGE, "mi-sitio", undefined, null, "ab_1234abcd:a");
    expect(out).toContain('name="_openlen_ab" value="ab_1234abcd:a"');
    expect(out).toContain(preAbFormStamp);
  });
});
