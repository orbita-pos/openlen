# Operations: an MCP server in an Edge Function

A tool's operations are what it does to its own data — add an employee, mark a booking as arrived. Write them once, as tools of an MCP server in one of the tool's Edge Functions. Once the person installs the tool, you get them in every project of theirs as `mcp__<serverName>__<operation>` (the way Claude Code names MCP tools), so «add Ana to my employees» works from anywhere. With the Edge Functions off on the server, none of this runs yet: the tool has no operations for you, and its screen hands you text with `sendPrompt`.

## One operation, two callers

DeepSeek's rule — one operation, two callers: the screen's button and your tool call do the same thing, with the same parameters and the same meaning. Put each operation's logic in `supabase/functions/_shared/` and call it from both: from its MCP tool, and from whatever the screen uses (a plain Edge Function, or the tool's backend straight from the browser). Never keep two copies of the logic.

What grants or confirms authority — approving a payment, accepting a charge, answering a question the person was asked — stays the person's, on the screen: never make it an operation.

## Declare it

In /package.json, under `openlen.tool.mcp`, next to the placement:

```json
{ "openlen": { "tool": { "placement": "rail", "mcp": { "serverName": "employees", "function": "mcp" } } } }
```

- `serverName`: lowercase letters, digits, `_` and `-`, starting with a letter, at most 24 characters. It is the middle of the names you'll see.
- `function`: the Edge Function serving it (`supabase/functions/<function>/index.ts`).

## The server

This is Supabase's own example (supabase.com/docs/guides/getting-started/byo-mcp), as the functions catalog serves it:

```ts
// supabase/functions/mcp/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0'
import { z } from 'npm:zod@^4.3.6'

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'mcp', version: '0.1.0' })

  server.registerTool(
    'add',
    {
      title: 'Addition Tool',
      description: 'Add two numbers together',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
    },
    ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] })
  )

  return server
})

Deno.serve((req) => handler.fetch(req))
```

OpenLen calls it with the person's session in the tool's own backend, so build the client from the request's `Authorization` and row level security applies — the operation acts as the person, never as the service key:

```ts
// supabase/functions/mcp/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@^4.3.6'
import { addEmployee } from '../_shared/employees.ts'

Deno.serve((req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization')! } },
  })
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'employees', version: '1.0.0' })
    server.registerTool(
      'add_employee',
      {
        title: 'Add an employee',
        description: 'Adds a person to the employees list.',
        inputSchema: z.object({ name: z.string(), role: z.string().optional() }),
      },
      async (input) => {
        const { error } = await addEmployee(supabase, input)
        if (error) return { content: [{ type: 'text', text: error.message }], isError: true }
        return { content: [{ type: 'text', text: `Added ${input.name}.` }] }
      }
    )
    return server
  })
  return handler.fetch(req)
})
```

- Keep `verify_jwt` on (the default): the gateway checks the person's session before your code runs.
- Each operation's `inputSchema` is a `z.object`. Names: letters, digits, `_` and `-`. A description says what it does in one line.
- An operation touches only this tool's own database. Another project's data goes through the screen and OpenLen's confirmation (`window.openlen.update`), never through an operation.
- A secret (an API key) is like in any function: ask for it with `request_secrets` and read it with `Deno.env.get`.

## Check it

1. In this project (the draft), call the function with `curl` from your terminal at the address the platform manual gives for this project's Edge Functions (`…/functions/v1/mcp`): POST `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}`, then `tools/list` and a `tools/call`, with the headers `content-type: application/json` and `accept: application/json, text/event-stream`.
2. Install it with `publish`. Installing asks the server for its tools once: an operation the model provider couldn't take is left out and the answer names it — fix it and install again.
3. From your next turn you have `mcp__<serverName>__<operation>`: call one, then do the same from the screen and compare.
