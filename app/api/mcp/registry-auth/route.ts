// LA PRUEBA DE QUE openlen.com ES NUESTRO para el registro oficial de MCP
// (`com.openlen/openlen`; nunca openlen.app, que aloja lo de los usuarios). El
// texto (`v=MCPv1; k=ed25519; p=<clave pública>`) sale al generar la clave para
// `mcp-publisher login http` y vive en MCP_REGISTRY_AUTH.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const proof = process.env.MCP_REGISTRY_AUTH?.trim();
  if (!proof) return new Response("Not found", { status: 404 });
  return new Response(proof, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}
