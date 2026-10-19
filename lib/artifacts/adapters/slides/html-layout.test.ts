// @vitest-environment node
import {expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
// A normalized computed-style snapshot, matching the actual browser repros.
// Geometry isn't simulated for fidelity claims: this pins rejection policy.
const defaults={display:"block",visibility:"visible",opacity:"1",transform:"none",filter:"none",boxShadow:"none",textShadow:"none",clipPath:"none",backgroundImage:"none",mixBlendMode:"normal",writingMode:"horizontal-tb",textDecorationLine:"none",overflow:"visible",overflowX:"visible",overflowY:"visible",backgroundColor:"rgba(0, 0, 0, 0)",borderTopColor:"rgb(255, 0, 0)",borderRightColor:"rgb(255, 0, 0)",borderBottomColor:"rgb(255, 0, 0)",borderLeftColor:"rgb(255, 0, 0)",borderTopWidth:"0px",borderRightWidth:"0px",borderBottomWidth:"0px",borderLeftWidth:"0px",borderTopStyle:"solid",borderRightStyle:"solid",borderBottomStyle:"solid",borderLeftStyle:"solid",borderTopLeftRadius:"0px",borderTopRightRadius:"0px",borderBottomRightRadius:"0px",borderBottomLeftRadius:"0px",listStyleType:"none",listStyleImage:"none"};
interface SnapshotElement {nodeType:number;tagName:string;id:string;childNodes:SnapshotElement[];childElementCount:number;style:Record<string,string>;scrollWidth:number;scrollHeight:number;clientWidth:number;clientHeight:number;getBoundingClientRect:()=>Record<string,number>;hasAttribute:()=>boolean;getAnimations:()=>never[]}
function element(style:Record<string,string>={},children:SnapshotElement[]=[]):SnapshotElement{
 return {nodeType:1,tagName:"DIV",id:"example",childNodes:children,childElementCount:children.length,style:{...defaults,...style},scrollWidth:180,clientWidth:180,scrollHeight:100,clientHeight:100,getBoundingClientRect:()=>({x:64,y:64,width:180,height:100,right:244,bottom:164}),hasAttribute:()=>false,getAnimations:()=>[]};
}
function measure(child:ReturnType<typeof element>){
 const body=element({},[child]),root=element();body.tagName="BODY";root.tagName="HTML";
 const source=readFileSync(new URL("../../../../tools/artifact-renderer/slide-layout.mjs",import.meta.url),"utf8").split("/** Shared with the browser proof.")[0]!.replace("export function","function");
 const run=new Script(source+";measureSlideDocument").runInNewContext({document:{body,documentElement:root},getComputedStyle:(el:ReturnType<typeof element>,pseudo?:string)=>pseudo?{content:"none"}:el.style});
 return run({width:1280,height:720,id:"test"});
}
it("retains the supported solid rectangle baseline",()=>expect(measure(element({backgroundColor:"rgb(0, 0, 255)"})).elements).toHaveLength(1));
it("rejects different border colors instead of exporting four identical sides",()=>{
 expect(()=>measure(element({borderTopWidth:"10px",borderRightWidth:"10px",borderBottomWidth:"10px",borderLeftWidth:"10px",borderRightColor:"rgb(0, 0, 255)"}))).toThrow(/slide_layout_unsupported/);
});
it("rejects visible native list markers instead of dropping bullets and numbering",()=>{
 for(const listStyleType of ["disc","decimal"])expect(()=>measure(element({display:"list-item",listStyleType}))).toThrow(/slide_layout_unsupported/);
});
it("rejects rounded clipping of descendants even without scroll overflow",()=>{
 expect(()=>measure(element({overflow:"hidden",overflowX:"hidden",overflowY:"hidden",borderTopLeftRadius:"24px",borderTopRightRadius:"24px",borderBottomRightRadius:"24px",borderBottomLeftRadius:"24px"},[element({backgroundColor:"rgb(0, 0, 255)"})]))).toThrow(/slide_layout_unsupported/);
});
