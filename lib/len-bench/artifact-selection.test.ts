import {expect,it} from "vitest";
import {gradeArtifactSelection} from "./artifact-selection";
it("scores persisted identities rather than a claim of five finished pieces",()=>{
  const expected={dashboard:1,slides:1,motion:1,image:2};
  const rows=["dashboard","slides","motion","image","image"].map((kind,i)=>({id:String(i),kind,itemKey:`piece_${i}`,status:"queued"}));
  expect(gradeArtifactSelection(expected,[],rows,{assistantResponded:true,sourceUnchanged:true})).toMatchObject({selectionPassed:true,formatsVerified:false,ready:0});
  expect(gradeArtifactSelection(expected,[],[],{assistantResponded:true,sourceUnchanged:true}).selectionPassed).toBe(false);
  expect(gradeArtifactSelection(expected,[],rows.slice(0,4),{assistantResponded:true,sourceUnchanged:true}).selectionPassed).toBe(false);
});
it("rejects extra artifacts for discussion, a silent failed turn and source edits in a deliverable-only request",()=>{
  const image={id:"1",kind:"image",itemKey:"image_1",status:"draft"};
  expect(gradeArtifactSelection({},[],[image],{assistantResponded:true,sourceUnchanged:true}).selectionPassed).toBe(false);
  expect(gradeArtifactSelection({},[],[],{assistantResponded:false,sourceUnchanged:true}).selectionPassed).toBe(false);
  expect(gradeArtifactSelection({image:1},[],[image],{assistantResponded:true,sourceUnchanged:false}).selectionPassed).toBe(false);
  expect(gradeArtifactSelection({},[],[],{assistantResponded:true,sourceUnchanged:false,allowSourceChange:true}).selectionPassed).toBe(true);
});
