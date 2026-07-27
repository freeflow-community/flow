# Freeflow — Landing Site Build Plan

Version 1.0 · Written before implementation · Next.js 15 App Router

---

## 1. What this site has to do

Freeflow is open-source team chat you run yourself. The site has exactly one job:

> **Convince a technical decision-maker to run `git clone` in the next five minutes.**

Every section either moves someone toward that command or removes a reason not to.
There is no signup, no trial, no waitlist, no pricing page. The conversion event is a
GitHub click. That single fact shapes the whole design: we can be generous, specific,
and technical, because we are not protecting a paywall.

### Three messages, ranked

1. **Free forever, and the license proves it.** Not freemium. Not "free tier."
   MIT-licensed source you can fork, sell, and run for a thousand seats without
   an invoice ever appearing.
2. **You can build coding agents that live inside chat.** Freeflow speaks the Slack Web
   API and Events API, so agents are first-class members of a channel — not webhooks
   bolted on the side.
3. **Migrating is not a rebuild.** Send an agent to do the packing. It carries your
   Slack or Discord ecosystem across — channels, threads, files, emoji, integrations.

### ICP (who the copy talks to)

| Segment | What they feel | What flips them |
|---|---|---|
| Eng leads at 20–200 person companies | Slack bill scales with headcount, not value | Per-seat cost goes to $0; history never truncates |
| Platform / DevEx engineers | Want bots and agents deeper than Slack allows | Slack-compatible API + agents as real members |
| Privacy / compliance-bound teams | Cannot put messages in someone else's database | AES-256-GCM at rest, own the Postgres |
| OSS-native founders & indie teams | Allergic to lock-in and seat math | MIT, self-host, fork it |
| Discord-based communities going pro | Discord feels casual; Slack feels expensive | Migration agents + threads/DMs/files parity |

### Voice

Active, declarative, second person. Short sentences. Concrete nouns. Numbers over
adjectives. We say "Freeflow encrypts every message at rest with AES-256-GCM," never
"enterprise-grade security." No exclamation marks. No emoji in body copy. Confident,
never breathless.

**Honesty constraint:** the project is at Phases 1–6 complete. We invent **zero**
testimonials, logos, user counts, or star counts. Credibility comes from specificity —
named algorithms, exact method counts, a public changelog, an explicit non-goals list.
An honest "we deliberately don't do search yet" outperforms a fake five-star quote with
this audience.

---

## 2. Design direction

Synthesised from the four reference pages:

| Reference | What we take |
|---|---|
| **Jobbie** | Light canvas, pill eyebrow badges with a leading dot, two-tone headlines (muted line + solid line), bordered cards with tinted icon chips, rounded-full CTAs, the comparison table, the big saturated CTA card at the end |
| **Fireflies** | Alternating dark/light section rhythm, accent-coloured words inside headlines, pastel-tinted feature panels |
| **Granola** | Serif display type, generous whitespace, an off-white "paper" feel, a dark logo/spec band, restraint |
| **Cluely** | One hero product shot that floats and dominates above the fold |

### The signature

**Inter for structure, Instrument Serif italic for one word per headline.** Every major
headline sets one word in large italic serif — `Own the chat your team *lives* in.` It
costs nothing, reads as crafted rather than templated, and instantly separates Freeflow from
the generic dark-SaaS gradient look every OSS project ships.

### Tokens

```
ink          #0B0C10   headings, dark sections
graphite     #1A1C22   dark section surface
body         #52545E   body copy
muted        #8A8C97   captions, labels
line         #E7E8EE   1px borders
mist         #F6F7FA   alternating section band
paper        #FFFFFF   base
accent       #4F46E5   indigo-violet — primary actions, links
accent-soft  #EEEFFE   accent tint backgrounds
free         #047857   emerald — reserved exclusively for "free / open" signals
warn         #B45309   amber — reserved for non-goals and honest caveats
```

Accent discipline: indigo is for action, emerald is *only* for the free-forever story,
amber is *only* for honest limitations. A visitor learns the colour language in one
scroll.

Radii: `12px` cards, `16px` panels, `24px` big surfaces, `999px` buttons and badges.
Shadows: almost none. One soft shadow on the hero mock, one on the final CTA. Depth
comes from 1px lines and background steps.

Type scale: hero `clamp(2.75rem, 6vw, 4.75rem)` at `-0.035em` tracking; section H2
`clamp(2rem, 4vw, 3.25rem)`; body `17px/1.65`. Mono is JetBrains Mono for every command,
token, path, and code block.

### Section rhythm (light → mist → light → dark → light → dark)

Never two identical backgrounds in a row. The two dark bands land on **Agents** and
**Final CTA** — the two moments that need weight.

---

## 3. Page architecture

```
/                 the full story (12 sections)
/agents           build your own coding agents, in depth
/migrate          Slack & Discord migration, in depth
/self-host        run it yourself: requirements, commands, deployment
```

Everything else (docs, changelog, specs, issues) links out to GitHub. We do not invent
documentation we do not have.

### `/` — section-by-section

| # | Section | Job | Framework beat |
|---|---|---|---|
| 1 | **Nav** | Get out of the way; one GitHub CTA | — |
| 2 | **Hero** | Value in 5 seconds + the product shot | Attention |
| 3 | **Spec bar** | Four hard numbers, no adjectives | Credibility |
| 4 | **Problem** | Name the three costs of rented chat | Problem / Agitate |
| 5 | **Free forever** | Kill the "what's the catch" reflex early | Objection |
| 6 | **Agents** (dark) | The differentiator; tabbed real code | Desire |
| 7 | **Migration** | "Send an agent to do the packing" | Desire |
| 8 | **Features** | Everything you get, grouped in six | Interest |
| 9 | **Architecture** | Prove it is real engineering | Proof |
| 10 | **Comparison** | Freeflow vs Slack Free / Slack Pro / Discord | Decision |
| 11 | **Quickstart** | Three commands, copyable | Reduce effort |
| 12 | **Non-goals + FAQ** | Handle every objection honestly | Objection |
| 13 | **Final CTA** (dark) | Repeat the ask with the license as risk reversal | Action |
| 14 | **Footer** | Four columns, all outbound to GitHub | — |

CTAs appear at hero, after Agents, after Quickstart, and in the final card — four total,
all the same primary action ("Clone the repo" / "Read the source"), never competing.

### Copy anchors (the lines that carry the page)

- **Hero H1** — "Own the chat your team *lives* in."
- **Hero sub** — "Open-source team chat you run yourself. Native on macOS, instant on
  the web, encrypted at rest — and the coding agents you write can review PRs, run CI,
  and ship, right from a channel."

**Positioning note:** never describe Freeflow as a "Slack clone." It is *team chat you own*.
"Slack-compatible API" stays — that is a technical fact about the surface bots talk to,
and it is an asset. "Clone" frames Freeflow as derivative; "compatible" frames it as a
migration path.
- **Free forever** — "Free isn't a trial. It's the license."
- **Agents** — "Your best engineer should be *in* the channel."
- **Migration** — "Moving off Slack or Discord? Send an agent to do the packing."
- **Non-goals** — "Here's what Freeflow *won't* do."
- **Final** — "Stop renting your team's conversations."

---

## 4. Technical plan

### Stack

- **Next.js 15**, App Router, TypeScript strict, React 19
- **Tailwind CSS v4** — single `@import "tailwindcss"` plus a `@theme` token block; no
  `tailwind.config.js` needed
- **Zero runtime dependencies beyond React/Next.** No component library, no icon
  package, no animation library. Icons are hand-rolled inline SVG; motion is CSS plus
  one 20-line IntersectionObserver hook. This keeps `npm install` fast and immune to
  version drift.
- **Fonts** via `next/font/google`: Inter (variable), Instrument Serif (400 + italic),
  JetBrains Mono (variable) — self-hosted at build time, zero layout shift.

### File map

```
site.config.ts              every outbound URL in one place — swap in 30 seconds
app/
  layout.tsx                fonts, metadata, nav, footer
  globals.css               Tailwind import + @theme tokens + keyframes
  page.tsx                  the landing page
  agents/page.tsx
  migrate/page.tsx
  self-host/page.tsx
  not-found.tsx
components/
  icons.tsx                 ~24 inline SVG icons
  ui.tsx                    Container, Eyebrow, Button, SectionHeading, Card,
                            Reveal, Code, Terminal, BrowserFrame, Stat
  nav.tsx                   sticky, blurs on scroll, mobile sheet
  footer.tsx
  app-mock.tsx              the fake Freeflow client — the hero's money shot
  sections/*.tsx            one file per landing section
lib/content.ts              all copy as typed data, so text edits never touch JSX
```

### Notable implementation decisions

- **FAQ uses native `<details>/<summary>`** — accessible, keyboard-navigable, works
  with JavaScript disabled, zero state code.
- **`Reveal`** wraps sections in a fade-and-rise that fires once on intersection and
  respects `prefers-reduced-motion`.
- **`AppMock`** is real DOM, not an image: sidebar, channel list, message list with an
  agent reply containing a code block, reactions, a typing indicator, and a thread rail.
  It renders crisply at any density and collapses gracefully under 768px.
- **Agent code tabs** are a small client component holding three real, correct snippets
  (declarative agent definition, a custom tool, a context binding). Freeflow is
  **AI-native messaging** — agents are a platform primitive you describe, never
  an app you install or an SDK you wire up. Never frame it as "point your Slack
  SDK at our server."
- **Comparison table** is a semantic `<table>` with `scope` attributes, horizontally
  scrollable on mobile with a sticky first column.
- **Accessibility:** WCAG AA contrast throughout, visible `:focus-visible` rings, one
  `<h1>` per route, skip-to-content link, every icon `aria-hidden` with adjacent text.
- **SEO:** per-route `metadata`, Open Graph and Twitter cards, `FAQPage` JSON-LD on `/`,
  `SoftwareApplication` JSON-LD with `price: 0`.

### Verification (no test runner available in this session)

1. Every import resolves to a file that exists — checked by re-reading the tree.
2. No client hooks in server components; `"use client"` sits only on nav, reveal, and
   the code tabs.
3. Tailwind v4 class names limited to stock utilities plus tokens declared in `@theme`.
4. User runs `npm install && npm run dev` → `http://localhost:3000`.

---

## 5. Definition of done

- [x] `npm install && npm run dev` boots on port 3000 with no config edits
- [x] Four routes render, cross-link, and share one nav/footer
- [x] Every external link resolves through `site.config.ts`
- [x] Open source + free-forever stated in hero, a dedicated section, the comparison
      table, the FAQ, and the final CTA
- [x] Custom-agent story present on `/` and expanded at `/agents`
- [x] Migration story present on `/` and expanded at `/migrate`
- [x] Zero fabricated testimonials, logos, or metrics
- [x] Mobile-clean from 360px up
