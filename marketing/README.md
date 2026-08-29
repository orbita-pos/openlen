# OpenLen — Marketing Kit

Everything to promote **openlen.com** for a month: paste-ready copy across every platform + 12 ready-to-post branded images.

## What's here

| File | What |
|---|---|
| `openlen-social-kit.md` | All the copy — X/Twitter (launch thread + 15 tweets + ES), LinkedIn (8 posts + ES), Instagram & Threads (10 captions + 6 threads + ES), Reddit · Product Hunt · Hacker News, Email · Outreach · Facebook + 10 taglines |
| `promo/*.png` | 12 finished images (rendered @2x, on-brand) |
| `templates/*.html` | The HTML source for each image — edit text/colors and re-render |
| `render.mjs` | `node marketing/render.mjs` → re-renders every template in `templates/` to `promo/` |

## The 12 images

**Landscape 1600×900** → X / Twitter, LinkedIn, Facebook
- `hero-dark` · `hero-light` — launch / hero ("Describe it. Ship it." / "From idea to live page")
- `feat-ai` — AI generation (prompt bar → page)
- `feat-sections` — Section Library auto-match (the wow)
- `feat-publish` — one-click publish to yourname.openlen.com
- `pricing` — $3.99/mo
- `quote-dark` — "shouldn't take a weekend. It takes a sentence."
- `cta-light` — closing CTA

**Square 1080×1080** → Instagram, Threads
- `hero-square` · `feat-square-ai` · `pricing-square` · `quote-square`

To edit an image: open its `templates/<name>.<W>x<H>.html`, change the text, run `node marketing/render.mjs`.

---

## 4-week content calendar

A realistic solo-founder cadence (~4 posts/week + daily-ish tweets). Pair each post with the image noted. All copy is in `openlen-social-kit.md`.

### Week 1 — Launch 🚀
| Day | Platform | Post | Image |
|---|---|---|---|
| Mon | Product Hunt | PH launch (tagline + description + first comment) | `hero-dark` + gallery |
| Mon | X | Launch thread (9 tweets) | `hero-dark` on tweet 1 |
| Mon | LinkedIn | Post 1 — launch / founder story | `hero-light` |
| Tue | Instagram | Caption 1 (launch) | `hero-square` |
| Wed | Reddit r/SideProject | "I built…" post | — (text-first) |
| Thu | X | Standalone tweet #1 (finished page, not blank canvas) | `feat-ai` |
| Fri | Threads | Threads post 1 | `hero-square` |

### Week 2 — Feature spotlights ✨
| Day | Platform | Post | Image |
|---|---|---|---|
| Mon | X | Tweet #2 (Section Library) | `feat-sections` |
| Tue | LinkedIn | Post 4 — section-library auto-match | `feat-sections` |
| Wed | Instagram | Caption (AI generate) | `feat-square-ai` |
| Wed | X | Tweet #3 (Style Match) | `feat-ai` |
| Thu | Reddit r/webdev | technical/honest angle | — |
| Fri | X + Threads | Tweet #12 (tip: describe by outcome) | `quote-dark` |

### Week 3 — Value & use-cases 💡
| Day | Platform | Post | Image |
|---|---|---|---|
| Mon | LinkedIn | Post 5 — "ship your landing page this weekend" | `feat-publish` |
| Tue | X | Tweet #7/#8 (hot takes) | `quote-dark` |
| Wed | Instagram | Caption (pricing / $3.99) | `pricing-square` |
| Wed | X | Tweet #6 ($3.99 pricing) | `pricing` |
| Thu | Email | Launch announcement to list | `hero-light` |
| Fri | Facebook | FB post (broad audience) | `feat-publish` |

### Week 4 — Engagement & CTA 🔁
| Day | Platform | Post | Image |
|---|---|---|---|
| Mon | X | Tweet #10/#11 (before/after) | `feat-publish` |
| Tue | LinkedIn | Post 8 — milestone / build-in-public | `quote-dark` |
| Wed | Instagram | Caption (your weekend project) | `quote-square` |
| Thu | X | Tweet #13 (one page, one job) | `feat-sections` |
| Fri | X + LinkedIn | Closing CTA (Tweet #15) | `cta-light` |

**Ongoing:** sprinkle the remaining standalone tweets + Threads posts + ES variants between these. Re-share the launch thread once mid-month. DM template (in the kit) for 1:1 outreach to founders/freelancers.

**Posting tips:** images sell the scroll — always attach one. Lead with the hook line. Reply to every comment in the first hour. On Reddit, never drop a raw link in the title — value first, link in a comment or naturally in the body.
