# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Alpha Planet Counter — a React + Vite + TypeScript console for a local pool/snooker venue. It runs on a laptop at the counter and an iPad on the floor (same Wi-Fi). It is a staff-facing console, **not a SaaS dashboard**. `HANDOFF.md` has the long-form product context, palette, and ball-rack constants; consult it for any non-trivial change.

## Commands

```bash
npm install
npm run dev      # vite --host 0.0.0.0 → http://localhost:5173 (LAN: http://<host-ip>:5173)
npm run build    # tsc && vite build — this is the lint/typecheck (TS strict is on)
npm run preview  # serve the built bundle
```

There are no tests. Validation is `npm run build` plus a manual browser pass at the target viewport (**1366×768, no page-level scrolling**).

## Architecture

### Data flow

State lives in a single `AppState = { sessions: Session[] }` owned by `src/main.tsx`. `main.tsx` is the app shell: it holds state, wires keyboard shortcuts, ticks the per-second timer, tracks the selected view/table, and passes handlers down. Mutations go through pure helpers in `src/lib/sessionActions.ts`; reads (active session lookup, table status, totals, today's metrics, per-table history) go through selectors in `src/lib/billing.ts`. State is persisted via `src/lib/storage.ts` to `localStorage` — **single-device only**; do not try to make `localStorage` multi-device, a shared backend is the path forward.

### Session lifecycle

`Available → Running (startedAt set) → Billing (endedAt set, no settledAt) → Settled (settledAt set)`. A void path sets both `settledAt` and `voidedAt`; voided sessions are excluded from metrics and `getTableHistory`. `ratePerHour` is **snapshotted onto the Session at start** — never re-read table config when generating a bill. Reopen moves every timestamp up to the end forward by the pause, so the pause is not charged.

### Billing math (`calculateSessionTotals` in `src/lib/billing.ts`)

There are two bill shapes. `isFrameBilled(session)` (`splitMode === "frames"`) selects the second.

**Whole table** (pool, the counter, a snooker party that pays as one, and old saved `splitMode: "per-player"` sessions). All rounding goes down, in the customer's favour:

```
minutes       = max(1, floor(((endedAt ?? now) - startedAt) / 60000))
tableCharge   = floor(minutes × ratePerHour / 60)
subtotal      = tableCharge + Σ(unitPrice × qty)
afterDiscount = max(0, subtotal − discount)
total         = roundOffEnabled && afterDiscount ≥ 5 ? floor(afterDiscount / 5) * 5 : afterDiscount
```

`roundOff` is **derived, not stored** — the session only stores the `roundOffEnabled` boolean. This avoids staleness as `now` ticks every second during a running session.

**Loser pays** (the snooker default). Frames are continuous: frame 1 starts at `startedAt`, and each frame starts where the one before it ended. `session.frames` holds the finished frames (`{ endedAt?, loserId }`). The open frame runs to `endedAt ?? now`.

```
rate(t)        = ratePerHour + max(0, headcount(t) − BASE_PLAYERS) × extraPlayerRatePerHour
headcount(t)   = players with joinedAt ≤ t < leftAt
frameCharge    = floor(Σ segmentMs × rate / 3,600,000)      // floored once per frame
player tab     = Σ (frameCharge + folded cafe) of frames they lost + their own cafe lines
Σ tabs + open frame = subtotal                              // no discount or round-off
```

- `BASE_PLAYERS` (2) and `EXTRA_PLAYER_RATE_PER_HOUR` (₹30/hr = ₹0.5/min) live in `src/data/tables.ts`. `extraPlayerRatePerHour` is snapshotted onto the session, like `ratePerHour`.
- End frame records the frame end at the tap (`endFrame`), so the price stops while staff choose. The frame then waits for its lowest scorer (`setFrameLoser`); "Keep playing" undoes it (`cancelEndFrame`). The lowest scorer pays the frame's table time and every cafe line ordered in it (the line gets `frameNo`). A cafe line with `playerId` goes to that player instead.
- After End session, the open frame needs a lowest scorer (`billOpenFrame`) if it has ≥ 60 s of billable time or open cafe. A shorter time sliver is dropped. A last frame that ends with the session gets the same rule if its end time is corrected.
- A player settles when their tab is final (they left, or the session ended with every frame billed). The session closes when every player who owes has paid.
- Once any player has paid, the split toggle, time edits, reopen and void are locked, and so are the frames and lines on a paid tab.

### Hardcoded config

- `src/data/tables.ts` — table layout, rates, felt/rail colors, orientation. The `game` field (`snooker | american-pool | indian-pool`) drives rendering: American pool gets rail diamonds, Indian pool does not, snooker uses the snooker rack.
- `src/data/menu.ts` — kitchen menu and price variants.

The Rates view is read-only; editing rates means editing `tables.ts`.

### Rendering

CSS-only (`src/styles.css`), no UI library. `lucide-react` for icons. Manrope from Google Fonts loaded in `index.html`. Ball positions (rack + scattered "break" layouts) live in `src/lib/balls.ts` — they are deterministic and manually tuned, not physically simulated. Scattered layouts use `seedOffset(tableId)` so running tables don't look identical.

## Project-specific conventions

- **No new dependencies** without a clear operational benefit. React + CSS only — no canvas, no Three.js, no image-heavy assets.
- **Surgical edits over refactors.** Preserve billing/session behavior unless explicitly changing it.
- **Destructive actions use the tap-twice-within-3s confirm pattern** (`confirmingEnd`, `confirmingClear` flags with auto-reset effects). Do not use native `confirm()` or add a modal.
- **Table selection does NOT auto-start a session.** Starting requires the Start button.
- **No cards.** Visual hierarchy comes from typography + hairline rules + whitespace. The intentional exceptions are buttons, inputs, category pills, the table tile itself, `.tableInfo`, `.liveChip`, `.qtyStepper` — don't add more.
- **Light vintage palette is hardcoded** (no CSS variables yet). Key tokens: page `#f3ecd9`, text `#2a1f12`, action green `#226d3f`, brass gold `#b07820`, danger `#a13c2a`. Full palette in `HANDOFF.md`.
- **Status colors** (`#5fb978` running, `#d0a04c` billing, `#b07820` selected/premium) propagate across legend dots, live chips, info pills, and header counters — keep them in sync if you change one.
- **No `font-weight: 900`.** Use 600/700 for hierarchy.
- **Codex rescue subagent** has been used as a second-opinion reviewer on non-trivial changes (the round-off staleness bug was caught that way). Continue that pattern for changes that touch session math or contrast.
