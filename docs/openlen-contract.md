# The OpenLen Design Contract

The single source of truth for the OpenLen design language. Every ingredient —
a curated **template** (full `<!doctype html>` document) or a **section**
(insertable fragment) — is authored **against this contract**, so they compose
into coherent pages by construction.

Paste the relevant parts into a Claude (Opus) authoring session when generating
ingredients. The HARD-LOCKED rules are also enforced mechanically by
`npm run contract:lint` (see `lib/contract/lint.ts`).

The principle: **lock the grammar, free the vocabulary.** The craft is shared
(so every page is unmistakably well-made → recognizable); the identity varies
(so no two pages look alike → diverse). "OpenLen style" = a recognizable bar of
craft, infinite faces.

---

## 1. Token vocabulary (the canonical set)

Every color, radius and font resolves from one of these. ~13 core tokens. One
name per role, mode-agnostic.

| Group | Token | Role |
|---|---|---|
| Surface | `--bg` | page ground |
| | `--surface` | raised card / panel |
| | `--surface-2` | nested raised |
| Text | `--fg` | primary text |
| | `--fg-muted` | secondary text |
| | `--fg-faint` | tertiary — **must hit WCAG AA** |
| Line | `--border` | hairline divider (the disciplined alpha) |
| | `--border-strong` | the one stronger divider (rare) |
| Accent | `--accent` | THE accent (exactly one) |
| | `--accent-r` | accent as `R,G,B` triplet, for `rgba(var(--accent-r), …)` |
| | `--accent-ink` | text/icon color that sits ON the accent |
| Shape | `--radius` | base corner radius (`--radius-sm` / `--radius-lg` optional) |
| Type | `--font-display`, `--font-body`, `--font-mono` | font families |

Optional status tokens — `--warn`, `--danger` — are NOT a second accent; use
them only for status dots / deltas.

### Skins = same names, different values

A full document declares both modes; the page picks one. (Sections declare
neither — they inherit the host's tokens.)

```css
/* LIGHT skin */
:root {
  --bg:#FAFAF9; --surface:#F4F1EB; --surface-2:#EEEAE1;
  --fg:#1A1714; --fg-muted:#5C544B; --fg-faint:#6B6358;
  --border:rgba(26,23,20,.08); --border-strong:rgba(26,23,20,.12);
  --accent:#B36A3A; --accent-r:179,106,58; --accent-ink:#ffffff;
  --radius:14px;
  --font-display:'Fraunces',serif; --font-body:'Inter',sans-serif; --font-mono:'JetBrains Mono',monospace;
}
/* DARK skin — the :root.dark flip; every color resolves from a token so the page flips cleanly */
:root.dark {
  --bg:#0F0F0F; --surface:#131313; --surface-2:#181818;
  --fg:#EDEDED; --fg-muted:rgba(255,255,255,.62); --fg-faint:rgba(255,255,255,.55);
  --border:rgba(255,255,255,.06); --border-strong:rgba(255,255,255,.10);
  --accent:#3ECF8E; --accent-r:62,207,142; --accent-ink:#062614;
}
```

---

## 2. Primitives (the "shadcn-but-HTML" layer)

Defined ONCE against the tokens, so a button in a section matches a button in
the host template automatically. Author ingredients using these classes.

```css
.btn-primary { background:var(--accent); color:var(--accent-ink);
               border-radius:var(--radius); font-weight:600;
               transition:transform 120ms ease, box-shadow 120ms ease; }
.btn-primary:hover { transform:translateY(-1px);
               box-shadow:0 6px 24px -8px rgba(var(--accent-r),.5); }
.btn-ghost   { background:transparent; color:var(--fg);
               border:1px solid var(--border); border-radius:var(--radius); }
.card        { background:var(--surface); border:1px solid var(--border);
               border-radius:var(--radius); }
.input       { background:var(--surface); color:var(--fg);
               border:1px solid var(--border); border-radius:var(--radius); }
.badge       { color:var(--fg-muted); border:1px solid var(--border);
               border-radius:999px; font-family:var(--font-mono);
               text-transform:uppercase; letter-spacing:.04em; }
```

Signature flourishes (canonicalised, optional per page): `pulse-dot`, `marquee`,
`dot-grid`, `tabular-nums`, the half-tone headline span. All reference tokens.

---

## 3. LOCKED vs FREE — the rule Claude follows on every ingredient

**The litmus test for any dimension:** *if two OpenLen pages differed on this,
would they look like different **brands** (→ FREE) or like one was made by an
**amateur** (→ LOCK)?*

### 🔒 HARD-LOCKED — the linter rejects the ingredient (mechanical)
- Hairline borders: rgba white alpha ≤ **0.06** (dark) / black alpha ≤ **0.08** (light). No bright borders.
- **No raw hex outside `:root`.** Every color resolves from a token via `var()`.
- **Exactly one accent** (`--accent`). No second brand color.
- Radius, font, color all via `var()`. Radius derives from `--radius`.
- No `data-slot-path=` (reserved editor marker).
- A document declares the required tokens on `:root`. A fragment declares none — it inherits.

### 🔒 SOFT-LOCKED — required by this prompt, caught in review
- Spacing rhythm: a 4/8px grid; consistent section padding.
- Typography: display tracking −0.025 to −0.04em, headline `line-height` 0.92–0.98, body 1.5–1.6, `tabular-nums` on metrics.
- Motion: lifts 80–150ms ease; restrained, never bouncy/janky.
- Copy: no "Learn more →", "Streamline your workflow", three identical cards, lorem, emoji.

### 🎨 FREE — vary boldly to fit the brief (this is what avoids sameness)
- The accent hex · the mode (dark/light/cream) · the **font family** (Inter / Fraunces / Source Serif 4 / Crimson Pro / JetBrains Mono).
- The **radius value** (4px sharp/technical ↔ 20px soft/consumer).
- Layout & density (bento ↔ single-column, asymmetric ↔ centered, dense ↔ airy).
- Which sections, in what order · copy, voice, the one memorable signature move · which flourishes · imagery style.

---

## 4. Born-against-the-contract checklist (author every ingredient this way)

1. Declare the canonical tokens on `:root` (+ a `:root.dark` flip for a document).
2. Reference tokens via `var()` everywhere — never hardcode a color twice.
3. Use the primitives (`.btn-primary`, `.card`, `.input`, `.badge`).
4. Hold every 🔒 rule. Vary every 🎨 dimension to fit the brief.
5. Before registering (`templates:add` / sections seed), run `npm run contract:lint -- <file.html>` — zero errors.

> The linter enforces only the HARD-LOCKED floor. The SOFT-LOCKED craft and the
> FREE identity are the model's job — that is the part taste handles and a
> deterministic pass never could.
