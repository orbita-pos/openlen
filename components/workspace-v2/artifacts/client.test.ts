import {describe,expect,it} from "vitest";
import {artifactFileUrl,cursorAfter,parseArtifactList,validatePreviewUrl} from "./client";

describe("artifact UI contracts",()=>{
  it("compares 64-bit cursors without rounding or accepting invalid values",()=>{
    expect(cursorAfter("9007199254740993","9007199254740992")).toBe(true);
    expect(cursorAfter("9007199254740992","9007199254740993")).toBe(false);
    expect(()=>cursorAfter("bad","0")).toThrow();
  });
  it("pins every download to an artifact revision and escapes project identity",()=>{
    expect(artifactFileUrl("p/a","a/b",4,2)).toBe("/api/projects/p%2Fa/artifacts/a%2Fb/files/2?revision=4");
  });
  it("never embeds grant HTML on the authenticated host or unsafe URLs",()=>{
    const token="a".repeat(43);
    expect(validatePreviewUrl(`https://preview.openlen.test/grant/${token}`,"https://app.openlen.test")).toContain("preview.openlen.test");
    for(const url of [`https://app.openlen.test/grant/${token}`,"javascript:alert(1)",`https://preview.openlen.test/grant/${token}?extra=1`,`http://preview.openlen.test/grant/${token}`])expect(()=>validatePreviewUrl(url,"https://app.openlen.test")).toThrow();
  });
  it("rejects malformed readiness instead of manufacturing finished items",()=>{
    expect(()=>parseArtifactList({artifacts:[{id:"x",kind:"image",status:"ready"}]})).toThrow();
    expect(parseArtifactList({artifacts:[],kinds:[]})).toEqual([]);
  });
});
