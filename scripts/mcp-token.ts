// Crea un token personal del servidor MCP para una cuenta (hasta que exista la
// página de «Aplicaciones conectadas», Parte 4). El secreto sale UNA vez.
// Run: npm run mcp:token -- --email=tu@correo [--name="Claude Code"] [--scopes=projects:read] [--project=<id>]
import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { mintPersonalToken } from "../lib/mcp/tokens";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const email = arg("email");
  if (!email) throw new Error("Falta --email=<correo de la cuenta>");
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) throw new Error(`No hay cuenta con ${email}`);
  const scopes = (arg("scopes") ?? "projects:read").split(",").map((s) => s.trim()).filter(Boolean);
  const { secret } = await mintPersonalToken({ userId: user.id, name: arg("name") ?? "CLI token", scopes, projectId: arg("project") ?? null });
  const url = process.env.MCP_RESOURCE_URL?.trim() || "https://mcp.openlen.com/mcp";
  console.log(`Token (se enseña una sola vez):\n${secret}\n`);
  console.log(`Claude Code:\n  claude mcp add --transport http openlen ${url} --header "Authorization: Bearer ${secret}"`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
