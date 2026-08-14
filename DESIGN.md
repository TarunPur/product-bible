---
name: Playbook
description: A citation-safe Q&A tool over Lenny's Podcast's transcript archive
colors:
  page: "#15130f"
  surface: "#1e1b15"
  wash: "#221f19"
  ink: "#f4efe4"
  ink-soft: "#d8d0c2"
  muted: "#b3a998"
  faint: "#a89882"
  fainter: "#948970"
  rule: "#33302a"
  rule-soft: "#262319"
  edge: "#3a362c"
  accent: "#d99a3a"
  accent-hover: "#eab04f"
  accent-label: "#c99a4e"
typography:
  display:
    fontFamily: "Oswald, sans-serif"
    fontSize: "clamp(2.5rem, 7vw, 5rem)"
    fontWeight: 400
    lineHeight: 0.98
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.14em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  button:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "normal"
  entry:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "15.5px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  heading:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.page}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "10px 28px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  cue-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.lg}"
    padding: "19px 20px"
  citation-marker:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  source-card:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
    typography: "{typography.entry}"
    rounded: "{rounded.xl}"
    padding: "14px"
---

# Design System: Playbook

## Overview

**Creative North Star: "The Chapter Index"**

Chapter Index spans the whole app: the landing/empty state (where it was first built) and the active Q&A conversation view (header, question, citations, sources sidebar, source transcript panel, session rail, follow-up input), extended into the latter in a second pass on the same established world — not a new direction, not a second system. There is exactly one visual world in this project now.

Chapter Index treats the app as a broadcast-studio show-notes system rather than a chatbot: a near-black "on-air" ground, one warm amber "tally-light" accent that marks something live or interactive, and content laid out as numbered, timestamped entries — the same bordered, mono-numbered pill style carries example questions on the landing state, inline citation markers inside an answer, and each source card in the sidebar, so the whole app previews and then delivers the same visual promise of "attributed, not guessed." No guest name or timestamp is ever invented on an unverified entry; PRODUCT.md's anti-fabrication principle is a hard boundary the visual system respects, not just the copy.

**Key Characteristics:**
- Dark, near-black ground — chosen from the broadcast-studio scene (dim control rooms, tally lights), not from category default
- One accent hue, amber, reserved for live/interactive signifiers and a small set of named, bounded exceptions (see Named Rules) — never a second accent color for a different status
- Condensed display type (Oswald) for the app's two headline moments (landing tagline, active question); tabular mono (JetBrains Mono) wherever a number is structural — timestamps, index numerals, labels — never generic "tech" decoration
- Flat page surfaces at rest; the only page-level shadow is a warm amber glow on hover/focus. A slide-over panel is the one named exception (see Elevation & Depth)

## Colors

Near-black ground with one warm accent — restrained, not a full palette. No gradients, no second accent hue.

### Primary
- **Accent** (`#d99a3a`): the sole accent hue. Used where something is live, interactive, or actively focused — the CUE dot, hover/focus states, button fills, inline citation markers and source-card highlighting — plus two named, bounded exceptions below. Never used for static decoration or body copy outside those exceptions.
- **Accent Hover** (`#eab04f`): lightened accent for filled-button hover states.
- **Accent Label** (`#c99a4e`): a slightly deeper accent reserved for small mono labels at rest ("CUE", category headers, the header tagline) — distinguishes label-accent from interactive-accent at a glance.

### Neutral
- **Page** (`#15130f`): the app's background. A near-black warm charcoal, not pure black — a broadcast control-room scene, not a category default.
- **Surface** (`#1e1b15`): one step up from Page — cue-inputs, the article column, the source transcript panel.
- **Wash** (`#221f19`): a step above Surface — resting source cards, the active session-rail item. Reads as "raised, not floating."
- **Ink** (`#f4efe4`): primary text — headlines, hover/active text, typed input value.
- **Ink Soft** (`#d8d0c2`): secondary-primary text one step down from Ink — the streamed answer body, chapter-entry question text at rest, the "well covered" status dot.
- **Muted** (`#b3a998`): secondary text — subheads, source-card excerpts, session-rail inactive items. ~8:1 against Page.
- **Faint** (`#a89882`): small structural text — citation-marker numerals, stat lines, placeholder text. ~5–6.6:1 against Page/Surface.
- **Fainter** (`#948970`): the quietest tier — footer counts, "open transcript" links. ~5–5.4:1 against Page/Surface. Faint and Fainter sit close in value on purpose: a near-black ground doesn't leave much room for multiple washed-out gray steps that still clear a 4.5:1 floor at small text sizes, so the hierarchy between them is real but subtle.
- **Rule** (`#33302a`) / **Rule Soft** (`#262319`): dividers, from most to least visible.
- **Edge** (`#3a362c`): input and card borders at rest.

### Named Rules
**The Live-Only Amber Rule.** Amber marks something live, interactive, or focused — never a static label, a body color, or decoration — with two bounded exceptions: (1) the low-confidence banner's static amber tint, justified by product truth (Product Principle #1: never let an interface imply certainty a citation doesn't support — amber-as-caution is the signal, always-on because the caution is always real when shown), and (2) small mono labels at rest use Accent Label, a distinct deeper value, precisely so idle labeling never gets confused with the live/interactive signal. Any other static or decorative use of amber is a violation.

**The One Hue Rule.** Status and state are signaled by amber intensity, neutral value, shape, or icon — never by introducing a second accent color. A "good" or "verified" state reads as quiet/neutral (Ink Soft), not green; a "caution" state reads as amber. If a new status needs distinguishing from both, change the shape or add an icon before reaching for a new hue.

**The No-Invented-Citation Rule.** Any element styled like a citation marker (bordered mono-numbered pill) may never carry a fabricated guest name or timestamp. Real citations exist only inside actual answers, generated from verified retrieval. A pill with no real attribution behind it stays a bare number — never dressed up to imply a source that isn't there.

## Typography

**Display Font:** Oswald (with sans-serif fallback)
**Body Font:** Public Sans (with system-ui fallback)
**Label/Mono Font:** JetBrains Mono (with ui-monospace fallback)

**Character:** A condensed, broadcast-lower-third display face against a plain workhorse body sans, with a tabular mono reserved for anything structurally numeric — timestamps, index numerals, labels — never used decoratively.

### Hierarchy
- **Display** (400, line-height 0.98): the app's headline voice, used in exactly two mutually-exclusive headline instances — the landing tagline (`clamp(2.5rem,7vw,5rem)`, uppercase, tracking -0.01em, a short fixed 2-line phrase) and the active-turn question headline (`clamp(28px,3.6vw,42px)`, sentence case, tracking -0.01em, arbitrary-length real user text). The Q&A instance drops uppercase and scale deliberately: real questions run long, and uppercase at tagline scale would overflow and fight legibility — the craft floor's own Type check caps display size and asks for balanced headings, which uppercase real prose at 5rem cannot deliver. The header's 15px "P" badge also sets its single letterform in this face — that's a wordmark mark, not a headline instance, and sits outside the headline count below.
- **Heading** (600, 24px, line-height 1.2): one level below Display, in-family (no new face) — the source panel's guest-name heading. Never used for a page-level H1.
- **Body** (400, 17px, line-height 1.625): the landing subhead. Measure capped at 62ch.
- **Label** (400, 10px, tracking 0.14em, uppercase): "CUE", category headers, the header tagline, source-card metadata.
- **Mono** (400, 17px): cue-input typed/placeholder text — the one place body-scale text is set in mono, because it's a "keyed in" query, not prose.
- **Button** (600, 15px): filled-button labels.
- **Entry** (400, 15.5px, line-height 1.4): chapter-entry and streamed-answer-adjacent list text — sits between Label and Body as the app's "list row" reading scale.

### Named Rules
**The Structural Mono Rule.** Monospace is reserved for things that are actually numbers, labels, or a "typed query" register — never applied to a headline or paragraph just to read as "technical."

**The One Headline Rule.** Only one Display-scale *headline* is ever on screen at a time (the app has exactly two headline states, landing and active-turn, and they're mutually exclusive). The persistent header badge is a small wordmark letterform in the same face, not a headline, and doesn't count against this rule. A future surface that wants a second simultaneous Display headline needs a documented exception here first, not a quiet reuse of the face.

## Layout

Single-column reading measure throughout — `max-w-[900px]` on the landing state, `max-w-[720px]` for the Q&A article column, `340px` fixed for the sources sidebar at `xl`. Responsive horizontal padding (`px-5` mobile, `px-8` at `sm`). The Q&A view adds a persistent session rail (`xl` and up: a `260px` sticky left column; below `xl`: a horizontal scrolling pill row) and a `fixed` bottom follow-up bar with a `to-transparent` scroll-fade mask in Page. The whole system reflows at `sm` (640px) and `xl` (1280px, sidebar/rail breakpoint) — narrowing and restacking columns, not a distinct mobile design.

## Elevation & Depth

Flat by default at the page level. No resting shadows on page-level surfaces. The one page-level shadow is a soft amber glow on filled-button hover/focus — depth earned by state, not applied at rest.

**Structural Elevation exception:** the source transcript slide-over panel keeps a resting drop shadow (`-24px 0 60px -30px rgba(23,22,20,0.4)`) at all times, including idle. This is distinct from the Flat-By-Default Rule below: a slide-over is compositing above the page, not sitting on it, and needs a real separation cue the backdrop scrim alone doesn't fully provide. This is the only surface in the system allowed a resting shadow.

### Shadow Vocabulary
- **Amber Glow** (`box-shadow: 0 0 18px -3px rgba(217,154,58,0.6)`, or `var(--color-accent)` unparented): filled-button hover/focus only. The system's one authored "lit" moment on a page surface; do not add a second competing glow (a prior draft put a ring-glow on source-card hover too — removed; border/background color shift alone carries that state).
- **Panel Shadow** (`box-shadow: -24px 0 60px -30px rgba(23,22,20,0.4)`): the source panel's resting elevation. See Structural Elevation exception above.

### Named Rules
**The Flat-By-Default Rule.** Page-level surfaces are flat at rest. The only depth on a page surface is the Amber Glow, and it appears only in response to hover or focus. A slide-over/modal panel is compositing, not a page surface, and keeps its own resting Panel Shadow instead.

## Shapes

Soft, moderate radii throughout — `4px` on mono-pill markers, `8px` on filled buttons and the header badge, `12px` on cue-inputs and the mobile turn-selector pills, `16px` on source cards and the source panel's transcript block (the largest surfaces get the largest radius). No sharp corners. No fully-rounded pill shapes on primary controls — a control that switches state (the mobile turn selector) uses the `lg` radius, not a capsule; small circular status dots (the CUE pulse, confidence dots) are the one legitimate fully-round shape in the system, since they're indicators, not controls. Borders are always 1px and always a Rule/Edge neutral — never a colored border, never a colored `border-left`/`border-right` accent stripe (a cited-transcript-line highlight uses a background tint instead, not a border stripe).

## Components

### Buttons
- **Shape:** 8px radius (`{rounded.md}`)
- **Primary (Ask):** Accent fill, Page text, `10px 28px` padding (landing) or `20px 8px` (Q&A follow-up, more compact), semibold. The only filled control in the system.
- **Hover / Focus:** fill lightens to Accent Hover plus the Amber Glow shadow on hover; a 2px accent ring with 2px offset on `:focus-visible`. Disabled drops to 40% opacity and suppresses both.

### Inputs / Fields (Cue Input)
- **Style:** Surface background, Edge border, 12px radius, mono type, preceded by an inline "CUE" label with a small pulsing amber dot — a real `<label>` (accessibility, not decoration) that doubles as the tally-light signifier. Used identically on the landing hero input and the Q&A follow-up bar (the latter more compact).
- **Focus:** the whole container's border shifts to Accent on `:focus-within` — the primary control's only focus treatment; never reintroduce `outline-none` without this replacement.

### Citation Marker (signature component)
A small bordered mono-pill numeral, `{typography.label}` scale, 4px radius, Edge border at rest, Accent border/text on hover or when active. This single component appears in three places with the same shape: the landing chapter-entry list (unattributed, per the No-Invented-Citation Rule), inline inside a streamed answer (`[Guest, timestamp]` tags, only rendered when validated), and each source card's own index number. Any future citation-shaped element reuses this exact pill — it is the system's most-reused device.

### Source Card
- **Shape:** 16px radius, 14px padding.
- **Rest:** Wash background, transparent border.
- **Hot (hovered/synced with an inline marker):** Surface background, Accent border. No additional glow — the border/background shift alone carries the state (a prior ring-shadow was removed as a duplicate device).
- **Contents:** Citation Marker numeral, Accent-colored timestamp, Ink guest name (Entry-adjacent weight), Muted excerpt, Fainter "Open transcript" affordance when a real transcript exists.

### Source Panel (slide-over)
- **Shape:** fixed right-hand panel, Surface background, Edge left border, Structural Elevation Panel Shadow (see above), backdrop scrim in `Page` at 70% opacity with a light blur.
- **Heading:** guest name at the Heading typography role (bold Public Sans, not Display — Display is reserved for the app's two headline moments).
- **Cited line highlight:** a soft background tint (`color-mix` of Accent at 10% into transparent, with matching horizontal padding/radius) on the specific transcript line a citation resolves to — never a colored border stripe.

### Navigation (Header)
One implementation app-wide: a small amber square badge (8px radius, Page-on-Accent "P", Display typography), the "Playbook" wordmark in Ink, the "every answer, cited" tagline in Accent Label mono (hidden below `sm`). Sticky, Rule bottom border, translucent Page background with backdrop blur. A "Clear conversation" control (neutral border, Muted text, hover to Ink/Fainter border) appears only once a conversation exists.

### Coverage Note (confidence banner)
Two confidence states, never a numeric score:
- **Low:** a static amber-tinted background (`color-mix` of Accent at ~12% into Page) and border (~35% mix), Accent label text, Ink Soft disclaimer body. See the Live-Only Amber Rule's first named exception.
- **High:** Surface background, Rule border, an Ink Soft status dot (not a second hue — see the One Hue Rule), Muted body text.

### Session Rail
`xl` and up: a sticky left column, Label-scale "This session" heading, each turn a text button — Wash background plus bold Ink text when active, Muted text with Ink hover otherwise. Below `xl`: a horizontal scrolling row of `lg`-radius pills (never fully rounded — see Shapes) in the same active/inactive treatment.

## Do's and Don'ts

### Do:
- **Do** keep Amber reserved for live/interactive state, plus the two named exceptions only (Live-Only Amber Rule).
- **Do** style any citation-shaped element as the Citation Marker pill — and leave it unattributed rather than inventing a guest or timestamp (No-Invented-Citation Rule).
- **Do** keep every input's `:focus-within` accent border as its visible focus state.
- **Do** use JetBrains Mono only for genuinely structural content (Structural Mono Rule).
- **Do** signal a new status with amber intensity, a neutral value, shape, or an icon before reaching for a new hue (One Hue Rule).

### Don't:
- **Don't** add a second glow or shadow effect to a page-level surface; the Amber Glow is the system's one authored page-level depth/motion moment (Flat-By-Default Rule). A slide-over panel is the one named exception, via its own Panel Shadow.
- **Don't** introduce a second accent hue for a different status or state (One Hue Rule) — a prior draft did this for a "well covered" indicator and it was reverted.
- **Don't** add a kicker or eyebrow label above any Display headline; the headline carries its own weight.
- **Don't** use a colored `border-left`/`border-right` accent stripe on any card, row, callout, or highlighted line — use a background tint instead.
- **Don't** use a fully-rounded pill shape on a control that changes state (buttons, selectors); reserve full roundness for small status/indicator dots.
