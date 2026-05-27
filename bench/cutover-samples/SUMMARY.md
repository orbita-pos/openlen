# F3 S4 cutover — visual quality samples

Run date: 2026-05-27T23:43:09.355Z
Provider: Gemini 2.5 Pro via @openlen/ai-gateway

## /api/generate samples

| Slug | Status | Bytes | Duration | Notes |
|---|---|---|---|---|
| linear-clone | ✓ | 40,228 | 79.3s | tokens=2831→10868 stopKind=end_turn |
| coffee-shop | ✓ | 23,553 | 55.5s | tokens=2842→6473 stopKind=end_turn |
| ai-product-with-form | ✓ | 44,927 | 113.1s | tokens=2840→16381 stopKind=end_turn |

## /api/templates/ai-design samples

| Slug | Status | Mode | Bytes | Duration | Notes |
|---|---|---|---|---|---|
| mode-a-headline-cta | ✓ | ops | 8,461 | 6.8s | mode=ops tokens=1294→116 stopKind=end_turn |
| mode-b-editorial-rebuild | ✓ | rewrite | 9,928 | 33.5s | mode=rewrite tokens=1303→1141 stopKind=end_turn |
| mode-b-dark-cinematic | ✓ | rewrite | 10,495 | 28.9s | mode=rewrite tokens=1306→1441 stopKind=end_turn |

## Operator follow-up

Open each `*-gemini.html` file in a browser to verify the visual quality matches the pre-cutover Kimi era. Specifically check:
- Page actually renders end-to-end (no JS errors, no half-rendered hero)
- Typography hierarchy looks intentional (display vs body, accent color usage)
- Mobile responsiveness down to 360px
- Born-canonical markers landed (`<script data-ol-radius>`, etc. — inspect the head)

If any sample looks visually worse than its Kimi-era equivalent, flag in the F3 S4 handoff before merging.