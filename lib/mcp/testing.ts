// Sólo para pruebas: un cliente MCP OFICIAL cuyas peticiones van al manejador,
// sin red. Así las pruebas ejercitan el protocolo de verdad.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export async function connectTestClient(
  handler: (req: Request) => Promise<Response>,
  token = "olp_test",
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test/mcp"), {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init)),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "openlen-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}
