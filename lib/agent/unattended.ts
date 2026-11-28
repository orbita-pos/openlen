// WHETHER A PERSON STARTED THIS TURN (ruling R24 of the workspace themes, spec local 2026-11-27-temas-del-workspace):
// what only changes how OpenLen looks to a person (`set_theme`) is refused in a turn nobody started. A turn the server
// starts (`opts.scheduled`: a scheduled task, Len Watch, «Hazlo» on an event task's card — whose press approves only the
// card's own action —, the subagents' notices, a tool's creation, Len's or an agent's message, «Que Len lo haga» on a
// visitors' card) and a goal round are unattended. The one server-started turn that is not: `ask_len` passing on what
// the owner TYPED to their own assistant just now (`ownerAsked`) — the owner asked, through their assistant.
import { isAssistantRequestOrigin, type TurnOrigin } from "@/lib/projects/types";

export function isUnattendedTurn(opts: { readonly scheduled?: { readonly origin: TurnOrigin }; readonly round?: unknown }): boolean {
  if (opts.round !== undefined) return true;
  if (opts.scheduled === undefined) return false;
  const origin = opts.scheduled.origin;
  return !(isAssistantRequestOrigin(origin) && origin.ownerAsked === true && origin.message !== true);
}
