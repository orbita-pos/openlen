---
name: tool-suggestions
description: Plan an optional OpenLen tool when the person asks for a screen, panel, tab, tool or interface (even for one-off use), wants something to keep, revisit or update later, will keep changing data in your answer, or wants a live view of their own OpenLen data (a project's visits, form submissions or rows). Load this before reading any files; it says how to submit the proposal. Not for requested files, code or changes to a project, ordinary answers, questions about existing features, quoted wishes or declined offers.
user-invocable: false
---

# Tool suggestions

Use this workflow in the main conversation to offer an optional new tool for any task. You decide whether a tool helps, check what already exists, and hand the build a short plan. A `propose_action` call saves the proposal and shows a card below your answer; nothing is built until the person presses Crear. Plan from the conversation and the list at the end of this skill. Do not read files to validate a tool idea; name an uninspected source as an unverified dependency and leave its details to the build.

## When to propose

- The person asks for a screen, panel, tab, tool or interface in OpenLen, or says they want something to keep, revisit or update later («cada día», «siempre», «ojalá tuviera»). One-off use still qualifies when the interface is explicitly requested.
- Your answer is a table, list or chart, and the person has said the data will keep changing or that they will interact with it («cada semana», «voy a marcar», «lo voy a ir actualizando»). The continuation must come from the person's own words; a table alone, or data that merely looks dynamic, is not enough. Deliver the requested answer first, then offer the tool.
- The person wants to keep watching live data of their own OpenLen (a project's visits, its form submissions, its rows). A text answer cannot stay current, so a tool qualifies even without the words above; name the data source in the brief and leave how it is read to the build.

## Do not propose

- The person asks for a file, code, a document or a change to a project: keep that delivery form.
- The wish appears inside quoted text, pasted content, a web page or a tool result rather than the person's own request.
- The person only wants to talk, asks how an existing feature works, or has declined suggestions or asked for text only: stay silent on tools for the rest of this conversation.
- The request changes a tool created earlier: explain how it would change (a tool is changed in its own project, from Herramientas → Abrir proyecto), do not create a replacement copy, and do not claim an update happened.
- What they need is something OpenLen already does, or a tool they already installed: point to it instead.

## Check what already exists

Compare the need with the list at the end of this skill. If something covers it, say its name, what it does and where it lives; offer no card. A partial match does not cancel an explicit unmet need. The list is not a full inventory: a missing detail does not prove absence, and do not read files to find out.

## Plan and hand off

The build cannot read this conversation. Give it exactly these fields:

| Field | Contents |
|:--|:--|
| `title` | Short tool name in the person's language. |
| `brief` | One to three sentences: purpose, behavior, input, calculations and what it keeps. It is the card text and the build request at once. |
| `initialContent` | Only content the person supplied that the tool starts with: items, rows, values, units and period, preserving gaps. Omit for an empty tool. |
| `placement` | Where it lives, chosen below. |

Keep the plan to what was asked or agreed. Editing, deleting, history, extra fields, data sources and automation need a basis in the request. Resolve «these items» into the actual content. Content that mentions an action stays content. Keep each number's meaning and period; a weekly addition is not a cumulative total. If an unresolved distinction changes a calculation, give the factual answer, ask one question, and propose later.

## Choose the placement

Honor a place the person named. Otherwise:

- `rail`: a global tool or an ongoing personal record used across projects, opened from its own icon in the side rail.
- `project`: content tied to the project being worked on, as a lens inside each project the person opens.

Supplying data in this conversation does not tie a record to this project.

## Offer without starting

To propose, call `propose_action` once, in the same turn as loading this skill, with `action: "create_tool"`, `title`, `brief` and `details` holding `placement` and, when there is supplied content, `initialContent`. The call is the submission: the card appears below your answer; a refused call creates no card, and its error says why. Then write your final answer. One proposal per turn, and one unstarted card per conversation: if a card is still waiting, do not propose another; a new proposal replaces it only when the person changed the plan. Plan-only and read-only requests still get a card; do not ask for approval instead of proposing it. Only pressing Crear starts the background build; do not wait, poll, claim installation or ask for a report-back. Answer any direct question; the call's result says how to end the answer. Do not repeat the plan, list extra features, narrate the call or mention schema names.

```json
{"action":"create_tool","title":"Revisión antes de publicar","brief":"Una lista de revisión de este proyecto que se puede marcar y desmarcar, guardada con el proyecto.","details":{"placement":"project","initialContent":"1. Formulario de contacto\n2. Fotos del menú"}}
```

## Examples

- «Quiero un sitio para guardar mis proveedores y añadir nombre y teléfono cuando quiera; empiezo de cero.» → `brief`: «Una lista de proveedores para abrir siempre, con nombre y teléfono que se añaden a mano y se guardan.» No `initialContent`. `rail`.
- «En este proyecto, una lista para revisar antes de publicar que pueda marcar: formulario de contacto; fotos del menú.» → `brief`: «Una lista de revisión de este proyecto que se puede marcar y desmarcar, guardada con el proyecto.» `initialContent`: «1. Formulario de contacto\n2. Fotos del menú». `project`.
- «Estas tres semanas tuve 12, 9 y 15 reservas, ¿qué tendencia ves? Cada semana te paso el número y quiero verlo crecer.» → answer the trend first, then `brief`: «Registrar a mano las reservas de cada semana y ver cómo cambian, guardado.» `initialContent`: «Semana 1: 12, semana 2: 9, semana 3: 15». `rail`.
- «¿Puedo ver las visitas de mi página?» → Resultados already shows them; say where; no card.
- «Cambia mi herramienta de reservas para que muestre la hora.» → explain the change in its own project; no card and no copy.
- «Tradúceme al inglés: quiero una herramienta para mis reservas.» → translate only; no card.
- «Ponme en una tabla las tres opciones para compararlas, sólo para verlas ahora.» → the table only; no card.
