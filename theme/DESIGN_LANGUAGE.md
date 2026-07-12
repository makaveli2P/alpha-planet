# Alpha Planet — Design Language

The app lives in a billiards hall. Lean into that. Surfaces look like felt, paper,
and wood. Status reads like pool balls — saturated, instant, no label needed.
Typography is loud where it matters (table numbers, totals) and quiet everywhere
else. No drop shadows, no gradients, no glass effects. The room already has
texture; the screen shouldn't fight it.

The two reference images set the poles:
- **`2c84e…jpg` (Luceo poster)** — confident, condensed, vintage-modern, willing
  to be loud. Source of the typography and pill-tag vocabulary.
- **`snooker.jpg`** — schematic, top-down, saturated, structural. Source of the
  surface palette (felt / rail / pocket) and color discipline.

---

## The system: three surfaces + one accent set

Every pixel belongs to one of four roles. This replaces "cards / panels /
containers" — the metaphor carries the structural work.

### Felt — the work surface

Deep, saturated, slightly textured. This is where action lives: the table grid,
live session indicators, the bill area in flight. Two variants, allocated by the
table's `game` field:
- **Felt blue** — pool / american-pool / indian-pool tiles, and the page header band.
- **Felt green** — snooker tiles, and the rates view.

```
felt-blue       #1d4a82    primary felt; pool tables, header
felt-blue-rim   #16365e    inner shadow / inset stroke on felt-blue
felt-green      #2c7c44    snooker tables, rates view
felt-green-rim  #1d5731    inner shadow / inset stroke on felt-green
```

### Paper — the record surface

Warm cream, the color of a printed score sheet. Used for everything the user
*reads carefully* or *enters into*: bill itemization, menu cells, inputs, lists.

```
paper-cream     #f1ead4    primary canvas (slight warm-up of current #f3ecd9)
paper-warm      #e8dec0    hover / pressed / sunken input
paper-edge      #d8cba6    hairline at paper-on-paper boundaries
```

### Rail — the structure

Deep wood. Used as **strokes only**, never fills: hairline dividers, the
page-level top rail, table-tile perimeters. A rail says "structural edge."

```
rail-deep       #4d2a18    primary stroke (1–2px)
rail-walnut     #7a4a2a    secondary stroke / decorative trim
```

### Ball — the accent set

Saturated, instant-read colors lifted from a pool ball set. Each ball is bound
to **one** semantic role. Don't invent new colors for status — use the ball
that fits.

| Token         | Hex       | Role                                       |
|---------------|-----------|--------------------------------------------|
| ball-cue      | `#f3ead4` | text/icons on felt; "chalk" surface         |
| ball-yellow   | `#e2b431` | warning, billing-in-progress                |
| ball-orange   | `#d97a2a` | secondary action, selected/premium accent   |
| ball-red      | `#c83a32` | danger, void, end-session                   |
| ball-purple   | `#5a3680` | inactive premium / membership badge         |
| ball-green    | `#5fb978` | success, running                            |
| ball-brown    | `#7a4a2a` | tertiary (aliases rail-walnut)              |
| ball-blue     | `#1d4a82` | primary action backdrop (aliases felt-blue) |
| ball-pink     | `#d77a8a` | soft alert / special offer                  |
| ball-black    | `#1a1612` | ink for text on paper                       |

---

## Roles in practice

```
PAPER MODE   (default canvas — counter, lists, bills)
  bg          paper-cream
  text        ball-black
  divider     rail-deep @ 12%
  primary     felt-green        (start, confirm)
  warning     ball-yellow       (billing chip)
  danger      ball-red          (end, void)
  premium     ball-orange       (selected, brass moments)

FELT MODE    (table tile interior, live-billing focus, hero metrics)
  bg          felt-blue OR felt-green
  text        ball-cue
  divider     ball-black @ 30%
  primary     ball-cue button + felt text
  warning     ball-yellow
  danger      ball-red
  premium     ball-orange
```

The current palette in [HANDOFF.md](../HANDOFF.md) maps almost 1:1 — this is a
re-cast, not a rebuild. See "What changes vs. current" below.

---

## Typography

Two faces, no more.

### Manrope *(already loaded)* — utility
Body text, labels, inputs, list rows, menu cells. Weights 500 / 600 / 700. Never 900.

### Anton *(new — Google Fonts, ~12KB woff2)* — display
Single weight, condensed all-caps. Used only for **loud moments**:
- Table numbers inside the tile (`T1`, `T2`, …)
- The bill total
- End-of-day metric headline numbers
- The four section labels (`TABLES` / `RATES` / `METRICS` / `MENU`)

Anton has one weight (regular). That's fine — its character comes from width
and tracking, not weight. **Adding Anton is the one new external resource this
language asks for**; see open questions below.

### Type scale

```
Display XL   Anton    72 / 72    tracking +1     bill total, hero stats
Display L    Anton    44 / 44    tracking +1     table number in tile
Display M    Anton    28 / 28    tracking +2     view labels, caps
Body L       Manrope  600  18 / 24                list rows, primary
Body M       Manrope  500  15 / 20                secondary text
Body S       Manrope  600  12 / 16  caps  +1     meta labels (ALL CAPS)
Mono num     Manrope  600  16 / 20  tnum         money in lists
```

For any column of money, set `font-feature-settings: "tnum"` so decimal points
line up. Anton already feels monospaced at display sizes.

---

## Composition rules

Constraints, not suggestions.

1. **No cards.** The CLAUDE.md rule stands. Hierarchy comes from typography,
   hairlines, and surface change. The named exceptions remain the only ones.
2. **Surface change implies role change.** If you put paper on felt, the paper
   region must be doing something distinct — entering data, listing items.
   Never paper-on-felt purely for "visual interest."
3. **One loud thing per screen.** A bill panel earns one Display-XL number
   (the total). The grid earns one ball-orange selected tile. Don't stack
   loud moments — the eye loses the anchor.
4. **8px baseline grid.** Everything snaps to 8px. 4px half-steps allowed for
   icon-to-text padding. Nothing in between.
5. **Hairlines, not borders.** Dividers are 1px rail-deep @ 12% opacity.
   Table-tile perimeters are 2px rail-walnut. Never plain 1px black.
6. **Status is colored, not labeled.** A running table is a green dot. A
   billing table is a yellow dot. The dot does the work; "Running" is
   supplementary text, not load-bearing.
7. **Status colors propagate.** If you change `ball-green`, you change every
   running indicator across legend dots, live chips, info pills, and header
   counters — they're a single token, treat them as one.

---

## Component recipes

### Table tile

```
┌───────────────────────────┐  ← 2px rail-walnut, 12px radius
│                           │
│  T3                       │  ← Anton Display L, ball-cue on felt
│  ● Running                │  ← 8px ball-green dot + Manrope 500 12px
│                           │
│  ┌─────────────────────┐  │  ← inner felt panel, 1px felt-rim stroke
│  │    (ball rack)      │  │     (no surface change — just a rim)
│  └─────────────────────┘  │
│                           │
│  ₹220/hr · 14 min         │  ← Manrope 600 13px, ball-cue @ 70%
└───────────────────────────┘
```

- Background: `felt-green` for `snooker`, `felt-blue` for `american-pool` /
  `indian-pool` (matches reality).
- Selected: perimeter swaps to 2px `ball-orange`.
- Available: felt color desaturates 40%, text drops to ball-cue @ 50%.
- Billing: 8px `ball-yellow` dot, slow pulse (2s ease).

### Bill panel

```
                                ← paper-cream surface, fills right rail
┌─────────────────────────────┐
│ TABLE 3                     │  ← Anton Display M, ball-black
│ ─────────────────────────── │  ← 1px rail-deep @ 12%
│                             │
│ Table charge        ₹  52   │  ← Manrope 600 15px, tnum on money
│ Masala chai (×2)    ₹  60   │
│ Veg sandwich        ₹  80   │
│ ─────────────────────────── │
│ Discount           −₹  20   │  ← ball-red for negative
│ Round-off               ✓   │
│                             │
│ TOTAL                       │  ← Manrope 500 13px caps
│ ₹ 175                       │  ← Anton Display XL, ball-black
│                             │
│  [ End & Settle ]           │  ← felt-green fill, ball-cue text
│  [ Void ]                   │  ← outline, ball-red text
└─────────────────────────────┘
```

### Pill / tag

Two flavors, never combined:

- **State pill** (passive, in lists): `paper-warm` fill, ball-black text,
  1px rail-deep @ 20% hairline, radius 999px.
- **Action pill** (a small button): solid ball-color fill
  (`orange` / `red` / `green`), ball-cue text, no border, radius 999px.

### Status dots

8px solid circle. No halo, no border. Colors map 1:1 to the ball palette:

```
●  ball-green       running
●  ball-yellow      billing
●  ball-orange      selected (premium)
●  ball-red         voided / errored
○  ball-cue @ 50%   available / idle    (hollow ring on felt only)
```

### Buttons

```
Primary       fill: felt-green       text: ball-cue       radius: 8px
Danger        fill: ball-red         text: ball-cue       radius: 8px
Secondary     fill: paper-warm       text: ball-black     1px rail-deep @ 20%
Ghost         fill: transparent      text: felt-green     no border
```

Heights: `40px` for primary actions, `32px` for in-list actions, `48px` only
for the touch-targeted iPad "Start" button on a tile.

---

## Voice — poster moments

The Luceo poster's energy isn't operational UI — it's celebratory. Reserve it
for moments where staff is meant to *notice*, not just *operate*:

- **End-of-day metric headline** — `₹ 14,820 — TODAY` in Anton Display XL on a
  full-width `felt-blue` band, smaller stats below in `ball-cue`.
- **Empty grid at the start of the day** — `READY` in Anton on the otherwise-
  empty tables view.
- **Top performer / longest session** — small editorial chip in Anton M,
  felt-green background.

Operational UI (active sessions, bills mid-flight, the menu picker) stays
calm. **Loud is a reward, not the default.**

A script wordmark for "Alpha Planet" — echoing Luceo's logotype — fits the
poster moments but should not appear in the operational header. Keep the
operational header in Manrope 700 caps.

---

## What changes vs. current

| Current                          | New                                              |
|----------------------------------|--------------------------------------------------|
| Cream + green + gold + red       | Cream PLUS felt-blue, felt-green, walnut         |
| Manrope only                     | Manrope + Anton (one extra font request)         |
| Status colors as scattered hex   | Status colors elevated to named ball tokens      |
| Table tile uses light fill       | Table tile fills with felt by `game`             |
| Bill panel total in Manrope      | Bill panel total in Anton Display XL             |
| `#226d3f` action green           | Promote to `felt-green` `#2c7c44` (near-identical) |
| `#b07820` brass gold             | Recast as `ball-orange` `#d97a2a` (warmer)       |
| `#a13c2a` danger                 | Recast as `ball-red` `#c83a32` (cleaner red)     |
| Palette hardcoded inline         | Palette as CSS variables under the same prefix    |

This is a re-skin. Billing math, session lifecycle, state shape, and storage
are untouched. The change is surface + typography + accent role.

---

## Open questions to confirm before wiring up

1. **Add Anton from Google Fonts?** One extra request, ~12KB woff2. The
   poster's character relies on a condensed display face. Manrope ExtraBold
   *can* carry display moments, but the result is more generic. **Recommend
   yes.**

2. **Table tile — full felt fill, or felt header + paper body?** Full felt is
   more poster-like and matches the metaphor; paper-bodied is calmer and
   reads faster at the 1366×768 grid. **Recommend full felt.**

3. **Felt blue vs felt green allocation.** Proposed: `game`-driven
   (snooker → green, pool → blue) — matches reality. Alternative:
   status-driven (running → green, billing → blue). **Recommend game-driven,
   with status conveyed through dots on top.**

4. **Move from hardcoded hex to CSS variables now?** CLAUDE.md flags "no CSS
   variables yet" as the current state. The token system above only works
   cleanly with variables. **Recommend yes — introducing variables is part
   of this revamp.**
