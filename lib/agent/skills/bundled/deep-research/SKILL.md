---
name: deep-research
description: Research a question across several web sources and write it up as a report with its sources (a market, competitors, options to compare, a trend, what studies say). Load it when the answer needs more than one or two searches. A single fact (an address, today's price, opening hours) is one web_search, without this skill.
---

# Researching a question

One `web_search` answers a single fact. Use this method when the user wants a question understood: comparing options, a market, competitors, what the studies say, how something changed over time.

## Before searching

Ask only when the question is ambiguous in a way that would change what you search: which country, which period, a business or a product. Otherwise say in one line what you understood and start.

What is the user's own (their prices, their customers, their numbers, what they decided) is never on the web: ask them for it, or read it in the project, and do not search for it.

Split the question into subtopics, 3 by default and at most 5: one per thing the answer needs.

## Coordinate the researchers

When `subagent` is available, Len leads the research. Launch one `general-purpose` subagent per subtopic, together in one message. Give each a complete, self-contained prompt: the question and its scope, the assigned subtopic, what to find, the primary sources to prefer, its budget (at most 3 queries with `web_search` and 2 pages with `web_fetch`), and the instruction to return every fact with its source link, what remains unknown and any contradictions.

Continue useful work while they run. When only their results remain, end your turn: their notices bring you back. Do not poll, sleep or invent their findings.

When the notices arrive, compare the results, check the sources behind the key claims, and resolve gaps or contradictions. Launch one more researcher only for a real gap, with the same budget and a focused question. Then write the report below; do not just paste their messages together.

If `subagent` is not available, follow the subtopic method yourself within your own turn's limits. If you are already a delegated researcher, research only your assigned subtopic and report back to Len; do not delegate it again.

## The budget

Each researcher has its own limits. Every search query is billed to the user, including queries made by subagents: 1.5 credits per query. Give each researcher the narrower budget of 3 queries and 2 pages above; do not treat several researchers as a way to hide or ignore cost.

These are the hard limits for each agent's turn (including Len when researching without subagents):
- `web_search`: at most 10 queries per turn, 1 to 4 per call, 1.5 credits per query, billed to the user.
- `web_fetch`: at most 5 pages per turn, free.

Spend searches where they discover sources and pages where they confirm facts. Put several queries in one call when they are independent, within the researcher's assigned budget.

## Each subtopic

1. Search with short queries, under 5 words, written the way the sources are written and in their language. Never repeat a query or a near copy of it: change the angle (another term, the name of an organization, a year).
2. Read the results, and `web_fetch` the most promising pages, the ones the key figures will rest on: a snippet is easy to take out of context (a price from another city, another year, another product).
3. Stop the subtopic when its answer is supported, or when two angles found nothing new.

When the budget runs out before the question is covered, do not stretch what you have. Deliver what is covered, say plainly what is missing and why, and offer to continue it in another turn.

## Sources

- Prefer primary sources: the organization itself, the official statistics, the study, the company's own page. A news piece about a study is worth less than the study.
- Separate what is confirmed (two independent sources, or one primary) from what is one source's claim or a forecast, and say which is which.
- When sources contradict each other, say so with both, instead of choosing one in silence.
- Every number, date and name carries the link it came from, a page you read or a search result. A fact without one does not go in the answer: it goes in what is missing.
- Note each page's date when it matters: last year's price is not today's.

## Delivering

- A short answer (a few paragraphs) goes in the chat, with its links inline.
- A long one also goes in a file: write it in the terminal as `/tmp/office/<title>.md` (`mkdir -p /tmp/office` first; `/tmp` is never saved to the project nor published) and call `present` with it. Say in the chat what it found in a few lines; do not paste the whole report twice.
- If the user wants a PDF or a Word file, load `pdf` or `office-docx` and build it from the same text.
- Do not put the research into the user's page unless they ask: it is for them to read.

The shape of the report is in references/report.md: read it before writing a long one.
