// @vitest-environment node
import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({enabled:vi.fn(),auth:vi.fn(),access:vi.fn(),select:vi.fn()}));
vi.mock("@/lib/artifacts/runtime",()=>({artifactsEnabled:mocks.enabled}));
vi.mock("@/auth",()=>({auth:mocks.auth}));
vi.mock("@/lib/projects/acceso",()=>({accesoAlProyecto:mocks.access}));
vi.mock("@/lib/db",()=>({db:{select:mocks.select},schema:{projects:{id:"id",title:"title"}}}));
vi.mock("drizzle-orm",()=>({eq:()=>true}));
vi.mock("next/navigation",()=>({notFound:()=>{throw Error("not_found");}}));
vi.mock("@/i18n/navigation",()=>({redirect:()=>{throw Error("login");}}));
vi.mock("./artifact-library",()=>({ArtifactLibrary:()=>null}));
import {renderToStaticMarkup} from "react-dom/server";
import Page from "@/app/[locale]/projects/[id]/artifacts/page";
import Loading from "@/app/[locale]/projects/[id]/artifacts/loading";
const props={params:Promise.resolve({locale:"es",id:"p"})};
beforeEach(()=>{vi.clearAllMocks();mocks.enabled.mockReturnValue(true);mocks.auth.mockResolvedValue({user:{id:"u"}});mocks.access.mockResolvedValue({duenoId:"u",rol:"lector"});mocks.select.mockReturnValue({from:()=>({where:()=>({limit:async()=>[{title:"Norte"}]})})});});
it("keeps the feature gate ahead of auth and database access",async()=>{
  mocks.enabled.mockReturnValue(false);await expect(Page(props)).rejects.toThrow("not_found");expect(mocks.auth).not.toHaveBeenCalled();expect(mocks.select).not.toHaveBeenCalled();
});
it("denies nonmembers and passes the actual read-only role to the page",async()=>{
  mocks.access.mockResolvedValueOnce(null);await expect(Page(props)).rejects.toThrow("not_found");expect(mocks.select).not.toHaveBeenCalled();
  const page=await Page(props);expect(page.props).toMatchObject({projectId:"p",projectName:"Norte",readOnly:true});
});
it("loads with its own history-shaped skeleton instead of inheriting the projects grid",()=>{
  // Without its own loading.tsx, this route showed app/[locale]/projects/loading.tsx.
  const html=renderToStaticMarkup(Loading());
  expect(html).toContain("workspace-v2");
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('data-loading="artifact-history"');
});
