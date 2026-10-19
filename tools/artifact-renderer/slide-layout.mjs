/** Runs only inside the isolated browser. Keep this function closure-free. */
export function measureSlideDocument({width,height,id}){
 const elements=[],assets=[],rasters=[];
 let serial=0,characters=0;
 const next=()=>`node-${serial++}`;
 const fail=(el,why)=>{throw new Error(`slide_layout_unsupported: ${id}/${el.id||el.tagName}: ${why}; isolate that visual with data-len-raster`);};
 const color=value=>{
  const match=/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value);
  if(!match)throw new Error("slide_layout_unsupported: non-sRGB color");
  return {hex:match.slice(1,4).map(v=>Math.round(Number(v)).toString(16).padStart(2,"0")).join("").toUpperCase(),alpha:match[4]===undefined?1:Number(match[4])};
 };
 const box=(rect,el)=>{
  if(rect.x<-.5||rect.y<-.5||rect.right>width+.5||rect.bottom>height+.5)throw new Error(`slide_element_outside_canvas: ${id}/${el.id||el.tagName}`);
  return {x:Math.max(0,rect.x),y:Math.max(0,rect.y),w:Math.min(rect.width,width-Math.max(0,rect.x)),h:Math.min(rect.height,height-Math.max(0,rect.y))};
 };
 const add=e=>{elements.push(e);if(elements.length>1500)throw new Error("slide_layout_too_large");};
 const text=node=>{
  const el=node.parentElement,style=getComputedStyle(el);
  const c=color(style.color);if(c.alpha===0)return;if(c.alpha!==1)fail(el,"translucent text");
  const family=style.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g,"");
  if(!/^[A-Za-z0-9 _-]{1,100}$/.test(family))fail(el,"font family");
  let offset=0,line=null;
  const flush=()=>{
   if(!line||!line.text.trim()){line=null;return;}
   const r={...line.rect,right:line.rect.x+line.rect.width,bottom:line.rect.y+line.rect.height};
   const b=box(r,el);
   add({id:next(),type:"text",...b,text:line.text,fontSize:parseFloat(style.fontSize),letterSpacing:parseFloat(style.letterSpacing)||0,fontFamily:family,bold:Number(style.fontWeight)>=600||style.fontWeight==="bold",italic:style.fontStyle==="italic",color:c.hex,align:"left"});line=null;
  };
  for(const char of node.textContent){
   if(++characters>200000)throw new Error("slide_layout_too_large");
   const range=document.createRange();range.setStart(node,offset);offset+=char.length;range.setEnd(node,offset);
   const r=range.getBoundingClientRect();
   if(r.width<.01||r.height<.01)continue;
   if(line&&Math.abs(line.rect.y-r.y)>1)flush();
   let value=char;
   if(style.textTransform==="uppercase")value=char.toUpperCase();
   else if(style.textTransform==="lowercase")value=char.toLowerCase();
   else if(style.textTransform!=="none")fail(el,"text-transform");
   if(!line)line={text:"",rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
   line.text+=value;
   const right=Math.max(line.rect.x+line.rect.width,r.right);
   line.rect.x=Math.min(line.rect.x,r.x);line.rect.width=right-line.rect.x;line.rect.height=Math.max(line.rect.height,r.height);
  }
  flush();
 };
 const walk=el=>{
  const s=getComputedStyle(el),r=el.getBoundingClientRect();
  if(["SCRIPT","STYLE","LINK","META","HEAD","NOSCRIPT"].includes(el.tagName)||s.display==="none"||s.visibility!=="visible"||Number(s.opacity)===0)return;
  if(el.hasAttribute("data-len-raster")){
   if(el===document.body||el===document.documentElement||r.width*r.height>=width*height*.9)fail(el,"whole-slide raster is not allowed");
   const b=box(r,el);if(b.w<1||b.h<1)fail(el,"empty raster");
   const key=`layout-${id}-${next()}`;el.setAttribute("data-len-layout-capture",key);
   rasters.push({id:key,selector:`[data-len-layout-capture="${key}"]`});
   add({id:next(),type:"image",...b,assetId:key,fit:"contain"});return;
  }
  for(const pseudo of ["::before","::after"]){const p=getComputedStyle(el,pseudo);if(!["none","normal","\"\""].includes(p.content)&&p.display!=="none")fail(el,"pseudo-element");}
  if(s.transform!=="none"||s.filter!=="none"||s.boxShadow!=="none"||s.textShadow!=="none"||s.clipPath!=="none"||s.backgroundImage!=="none"||Number(s.opacity)!==1||s.mixBlendMode!=="normal"||s.writingMode!=="horizontal-tb"||s.textDecorationLine!=="none")fail(el,"CSS effect");
  if(el.getAnimations().some(a=>a.playState==="running"))fail(el,"running animation");
  if(["SVG","CANVAS","VIDEO","IFRAME"].includes(el.tagName.toUpperCase()))fail(el,"complex visual");
  if(s.overflow!=="visible"&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1))throw new Error(`slide_text_overflow: ${id}/${el.id||el.tagName}`);
  if(r.width>.01&&r.height>.01){
   const fill=color(s.backgroundColor),border=color(s.borderTopColor),borderWidth=parseFloat(s.borderTopWidth);
   if(el.tagName==="IMG"){
    if(parseFloat(s.borderTopLeftRadius)>0||borderWidth>0||fill.alpha>0)fail(el,"image decoration");
    const m=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(el.src);
    if(!m)fail(el,"image format");
    if(!["fill","contain","cover"].includes(s.objectFit)||s.objectPosition!=="50% 50%")fail(el,"image positioning");
    const key=`layout-${id}-${next()}`;assets.push({id:key,mime:m[1],base64:m[2]});
    add({id:next(),type:"image",...box(r,el),assetId:key,fit:s.objectFit==="fill"?"stretch":s.objectFit});return;
   }
   if(fill.alpha>0||borderWidth>0){
    if([s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth].some(v=>v!==s.borderTopWidth)||borderWidth>0&&[s.borderTopStyle,s.borderRightStyle,s.borderBottomStyle,s.borderLeftStyle].some(v=>v!=="solid"))fail(el,"nonuniform border");
    if(borderWidth>0&&border.alpha!==1)fail(el,"translucent border");
    if(borderWidth>0&&fill.alpha!==1&&fill.alpha!==0)fail(el,"mixed fill/border alpha");
    const radius=parseFloat(s.borderTopLeftRadius)*(s.borderTopLeftRadius.includes("%")?Math.min(r.width,r.height)/100:1);
    if([s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius].some(v=>v!==s.borderTopLeftRadius))fail(el,"nonuniform radius");
    if(el!==document.body&&el!==document.documentElement)add({id:next(),type:"shape",shape:"rect",...box(r,el),radius,opacity:fill.alpha||1,...fill.alpha>0&&{fill:fill.hex},...borderWidth>0&&{stroke:border.hex},strokeWidth:borderWidth});
   }
  }
  const nodes=[...el.childNodes];
  if(nodes.every(n=>n.nodeType===1||!n.textContent.trim()))nodes.sort((a,b)=>(a.nodeType===1?Number.parseInt(getComputedStyle(a).zIndex)||0:0)-(b.nodeType===1?Number.parseInt(getComputedStyle(b).zIndex)||0:0));
  for(const child of nodes){if(child.nodeType===1)walk(child);else if(child.nodeType===3&&child.textContent.trim())text(child);}
 };
 const rootStyle=getComputedStyle(document.documentElement);
 if(rootStyle.backgroundImage!=="none"||rootStyle.transform!=="none"||Number(rootStyle.opacity)!==1)fail(document.documentElement,"root CSS effect");
 const bg=color(getComputedStyle(document.body).backgroundColor),htmlBg=color(rootStyle.backgroundColor);
 const blend=(fg,base)=>({hex:[0,2,4].map(i=>Math.round(parseInt(fg.hex.slice(i,i+2),16)*fg.alpha+parseInt(base.hex.slice(i,i+2),16)*(1-fg.alpha)).toString(16).padStart(2,"0")).join("").toUpperCase(),alpha:1});
 walk(document.body);
 return {id,background:blend(bg,blend(htmlBg,{hex:"FFFFFF"})).hex,elements,assets,rasters};
}

/** Shared with the browser proof. Never inject Node bindings into a frame. */
export async function captureSlideLayout(page,packet){
 const handles=await page.$$("iframe.slide");
 if(handles.length!==packet.pageCount)throw new Error("slide_count_mismatch");
 const slides=[],assets=[];let total=0;
 const save=a=>{total+=Buffer.byteLength(a.base64,"base64");if(total>8*1024*1024||assets.length>=5000)throw new Error("slide_layout_too_large");assets.push(a);};
 for(const handle of handles){
  const id=await handle.evaluate(el=>el.dataset.slideId),frame=await handle.contentFrame();
  if(!frame)throw new Error("slide_count_mismatch");
  const result=await frame.evaluate(measureSlideDocument,{width:packet.width,height:packet.height,id});
  for(const raster of result.rasters){
   const el=await frame.$(raster.selector);if(!el)throw new Error("slide_layout_unsupported");
   const bytes=await el.screenshot({type:"png"});save({id:raster.id,mime:"image/png",base64:Buffer.from(bytes).toString("base64")});
  }
  for(const a of result.assets)save(a);
  slides.push({id:result.id,background:result.background,elements:result.elements});
 }
 const png=new Uint8Array(await handles[0].screenshot({type:"png"}));
 return {png,layout:{slides,assets},checks:["slides:html-layout-measured","slides:component-raster-only",`slides:component-images:${assets.length}`]};
}
