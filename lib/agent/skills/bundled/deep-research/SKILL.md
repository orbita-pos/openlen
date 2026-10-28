---
name: deep-research
description: Research a question across several web sources and write it up as a report with its sources (a market, competitors, options to compare, a trend, what studies say). Load it when the answer needs more than one or two searches. A single fact (an address, today's price, opening hours) is one web_search, without this skill.
---

# Researching a question

One `web_search` answers a single fact. Use this method when the user wants a question understood: comparing options, a market, competitors, what the studies say, how something changed over time.

## Before searching

Ask only when the question is ambiguous in a way that would change what you search: which country, which period, a business or a product. Otherwise say in one line what you understood and start.

What is the user's own (their prices, their customers, their numbers, what they decided) is never on the web: ask them for it, or read it in the project, and do not search for it.

Split the question into subtopics, 3 by default: one per thing the answer needs. Plan between 3 and 6 searches for the whole question before the first one.

## The budget

These are this turn's limits, and they are real:
- `web_search`: at most 10 queries per turn, 1 to 4 per call, 1.5 credits per query, billed to the user.
- `web_fetch`: at most 5 pages per turn, free.

Spend searches where they discover sources and pages where they confirm facts. Put several queries in one call when they are independent.

## Each subtopic

1. Search with short queries, under 5 words, written the way the sources are written and in their language. Never repeat a query or a near copy of it: change the angle (another term, the name of an organization, a year).
2. Read the results. A snippet is not a source: `web_fetch` the page you are going to rely on, the most promising one or two.
3. Stop the subtopic when its answer is supported, or when two angles found nothing new.

When the budget runs out before the question is covered, do not stretch what you have. Deliver what is covered, say plainly what is missing and why, and offer to continue it in another turn.

## Sources

- Prefer primary sources: the organization itself, the official statistics, the study, the company's own page. A news piece about a study is worth less than the study.
- Separate what is confirmed (two independent sources, or one primary) from what is one source's claim or a forecast, and say which is which.
- When sources contradict each other, say so with both, instead of choosing one in silence.
- A fact without a source does not go in the answer. Every number, date and name carries its link.
- Note each page's date when it matters: last year's price is not today's.

## Delivering

- A short answer (a few paragraphs) goes in the chat, with its links inline.
- A long one also goes in a file: write it in the terminal as `/tmp/office/<title>.md` (`mkdir -p /tmp/office` first; `/tmp` is never saved to the project nor published) and call `present` with it. Say in the chat what it found in a few lines; do not paste the whole report twice.
- If the user wants a PDF or a Word file, load `pdf` or `office-docx` and build it from the same text.
- Do not put the research into the user's page unless they ask: it is for them to read.

The shape of the report is in references/report.md: read it before writing a long one.
