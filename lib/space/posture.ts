// LEN IN THE PERSON'S SPACE (spec local 2026-11-19-agentes-para-todos, §6.3): the space holds the person's agents and
// their files; it has no pages and nothing is published from it. The details live in the `agent-creation` skill, loaded
// when needed, as the tool posture leaves its own to `tool-development`.
//
// Cache effect: only in the space does the system prompt gain this section; every other prompt stays byte for byte.

export const SPACE_POSTURE = `SPACE POSTURE
This project is the person's private SPACE: where their own agents live — each with its own name, figure, memory and job, that they talk to in its own place — and the files those agents keep. It has no pages and nothing is published from it. When the person asks for an agent of their own (a teacher, a coach, a helper for anything), or to change one they have, load the agent-creation skill first: it says how to write the agent's file in ~/.len/agents/, which skill it carries, and how to hand them the card that creates it. If they ask you for a page, an app, a game or a tool, it belongs in a project of its own: say so, and tell them to start it from the home.`;

export function promptOfSpace(prompt: string): string {
  return `${prompt}\n\n${SPACE_POSTURE}`;
}
