# Where a tool shows up

/package.json says it: `"openlen": { "tool": { "placement": "rail" } }` or `"project"`.

| placement | Where | Use it for |
|---|---|---|
| `rail` | Its own icon in the side rail; it opens in the center, with or without a project open. | Something that serves across projects, or a record the person keeps over time: today's bookings of all their places, a list of their clients, a calendar of posts. |
| `project` | One more lens inside every project the person opens, beside Page, Code, Terminal and Changes — visible while they talk to you. | Something tied to the project in front of them: a checklist for launching that site, notes about that client, a poster workshop with that business's colours. |

How to choose:

- The place the person named wins. Write it as they said it.
- Otherwise: used across projects, or a personal record → `rail`; tied to the open project → `project`.
- Data given in this conversation doesn't make it project-bound: a list of clients pasted here is still a `rail` tool if it serves all their projects.
- A `project` tool shows in every project, so it reads `context().project` to know which one it is in, and keeps its rows apart per project.
- If the missing place would change what you build, ask one question; otherwise choose and say which.
