// CÓMO SE LLAMA EN VERSIONES LO QUE ESCRIBE LA PERSONA (no Len): desde su
// terminal, desde el editor de la lente «Código» o desde un agente de fuera
// por el servidor MCP (plans/mcp-de-openlen). Una sola tabla para los dos
// sitios que la usan (la carpeta y las páginas).
export function userEditLabels(desde: "editor" | "mcp" | undefined): { name: string; before: string } {
  if (desde === "editor") return { name: "Code editor", before: "Before code edit" };
  if (desde === "mcp") return { name: "External agent", before: "Before external agent edit" };
  return { name: "Terminal", before: "Before terminal edit" };
}
