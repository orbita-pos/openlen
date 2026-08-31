import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProject } from "@/lib/projects";
import { getPostTemplate, getPostTemplateHtml } from "@/lib/marketing/post-templates/store";
import { fillPostTemplate } from "@/lib/marketing/fill";
import { buildPostData, extractPagePhotos, extractPageLang, parsePhotoPos } from "@/lib/marketing/post-data";
import { tagEditableText } from "@/lib/marketing/text-edit";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/marketing/preview?projectId=<id>&postId=<slug>&offer=<txt>&photo=<url>
//
// Fills a post template with the project's/business's data and returns raw
// HTML for the workspace's Marketing tab to iframe. No AI call, no credit
// check — this is pure server-side templating (lib/marketing/fill.ts).
//
// CSP sandbox + no X-Frame-Options: the response MUST be iframable by the
// workspace (same posture as the post's own inline styles/scripts, sandboxed).
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

// Injected into the sandboxed preview iframe. Makes [data-ol-tid] text elements
// contentEditable and reports edits to the parent; drags the photo box to set
// object-position; and re-applies parent-committed edits/pos on load (reload
// persistence). Only the parent posts to it; it sets text/CSS, never evals.
const EDITOR_SCRIPT = `<script>(function(){
var tids=document.querySelectorAll('[data-ol-tid]'),dirty={},img=null,pos={x:50,y:50};
function report(){var e={};for(var k in dirty){var el=document.querySelector('[data-ol-tid="'+k+'"]');if(el)e[k]=el.innerText;}parent.postMessage({olEdits:e},'*');}
for(var i=0;i<tids.length;i++){(function(el){el.setAttribute('contenteditable','plaintext-only');el.style.cursor='text';el.addEventListener('input',function(){dirty[el.getAttribute('data-ol-tid')]=1;report();});})(tids[i]);}
var box=document.querySelector('[data-ol-photo]');img=box&&box.querySelector('img');
if(box&&img){box.style.cursor='grab';box.style.touchAction='none';var drag=null;
function setPos(x,y){pos.x=Math.max(0,Math.min(100,Math.round(x)));pos.y=Math.max(0,Math.min(100,Math.round(y)));img.style.objectPosition=pos.x+'% '+pos.y+'%';}
box.addEventListener('pointerdown',function(e){drag={x:e.clientX,y:e.clientY,bx:pos.x,by:pos.y};box.setPointerCapture(e.pointerId);box.style.cursor='grabbing';e.preventDefault();});
box.addEventListener('pointermove',function(e){if(!drag)return;var w=box.clientWidth||1,h=box.clientHeight||1;setPos(drag.bx-((e.clientX-drag.x)/w)*100,drag.by-((e.clientY-drag.y)/h)*100);});
box.addEventListener('pointerup',function(){if(!drag)return;drag=null;box.style.cursor='grab';parent.postMessage({olPos:pos.x+','+pos.y},'*');});
box.addEventListener('pointercancel',function(){drag=null;box.style.cursor='grab';});}
addEventListener('message',function(ev){var d=ev&&ev.data;if(!d)return;
if(d.olApplyEdits){for(var k in d.olApplyEdits){var el=document.querySelector('[data-ol-tid="'+k+'"]');if(el&&typeof d.olApplyEdits[k]==='string'){el.innerText=d.olApplyEdits[k];dirty[k]=1;}}}
if(typeof d.olPhotoPos==='string'&&/^\\d{1,3}% \\d{1,3}%$/.test(d.olPhotoPos)&&img){img.style.objectPosition=d.olPhotoPos;var m=d.olPhotoPos.match(/(\\d+)% (\\d+)%/);if(m){pos.x=+m[1];pos.y=+m[2];}}});
parent.postMessage({olReady:true},'*');})();</script>`;

export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse(null, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  const postId = sp.get("postId");
  if (!projectId || !postId) return new NextResponse(null, { status: 400 });

  const project = await getProject(projectId, session.user.id);
  if (!project) return new NextResponse(null, { status: 404 });  const post = await getPostTemplate(postId);
  if (!post || post.status !== "published") return new NextResponse(null, { status: 404 });

  const data = buildPostData({
    html: project.data.html,
    subdomain: project.subdomain ?? null,
    pageTitle: project.title,
    userOffer: sp.get("offer") ?? undefined,
    photoUrl: sp.get("photo") ?? undefined,
    photoPosition: parsePhotoPos(sp.get("pos")),
    register: post.register,
    match: sp.get("match") !== "0",
  });

  // as=json: the workspace's PostDetail wants the built data + the page's own
  // photos to power captions + the photo strip — no HTML fetch/fill needed.
  // pageLang drives caption language: captions are for the page's AUDIENCE,
  // not the editor's UI locale (spec §4).
  if (sp.get("as") === "json") {
    return NextResponse.json(
      {
        data,
        pagePhotos: extractPagePhotos(project.data.html),
        pageLang: extractPageLang(project.data.html),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const postHtml = await getPostTemplateHtml(postId);
  if (!postHtml) return new NextResponse(null, { status: 404 });

  // Inline editor (runs in the sandboxed iframe, allow-scripts): tagged text
  // elements become contentEditable and report edits to the parent; the photo
  // box drags to reposition (live, no reload). The parent re-applies committed
  // edits + position on load so they survive a reload. Text edits/pos are baked
  // into the export by the render route — this script never reaches it.
  const filled = tagEditableText(fillPostTemplate(postHtml, data));
  const withScript = filled.includes("</body>")
    ? filled.replace("</body>", EDITOR_SCRIPT + "</body>")
    : filled + EDITOR_SCRIPT;

  return new NextResponse(withScript, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts",
      "Cache-Control": "no-store",
    },
  });
}
