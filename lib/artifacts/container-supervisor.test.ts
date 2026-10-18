// @vitest-environment node
import {expect,it} from "vitest";
import {reconcileArtifactContainers,removeArtifactContainer} from "./container-supervisor";
const token="11111111-1111-1111-1111-111111111111",name=`openlen-artifact-${token}`;
it("removes an expired fenced renderer before admission, leaving a live worker's container alone",async()=>{
  const calls:string[][]=[];
  const run=async(args:string[])=>{calls.push(args);return {code:0,stdout:args[0]==="ps"&&calls.length===1?name:""};};
  await reconcileArtifactContainers({query:async()=>[]},run);
  expect(calls.some(args=>args.join(" ")===`rm -f ${name}`)).toBe(true);
  const activeCalls:string[][]=[];
  await reconcileArtifactContainers({query:async()=>[{id:"live"}]},async args=>{activeCalls.push(args);return {code:0,stdout:name};});
  expect(activeCalls).toHaveLength(1);
});
it("fails closed when removal cannot be confirmed instead of releasing a mounted output directory",async()=>{
  await expect(removeArtifactContainer(name,async(args)=>({code:args[0]==="rm"?1:0,stdout:args[0]==="ps"?name:""}))).rejects.toMatchObject({code:"renderer_cleanup_unknown"});
  await expect(reconcileArtifactContainers({query:async()=>[]},async()=>({code:1,stdout:""}))).rejects.toMatchObject({code:"renderer_cleanup_unknown"});
});
