# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Alpha Planet Counter — a React + Vite + TypeScript console for a local pool/snooker venue. It runs on a laptop at the counter and an iPad on the floor (same Wi-Fi). It is a staff-facing console, **not a SaaS dashboard**. `HANDOFF.md` has the long-form product context and palette; consult it for any non-trivial change.

Views: **Floor** (tables list · players · table · cafe), **Customers** (registry + open tabs), **Dashboard**, **Rates**.

## Commands

```bash
npm install
npm run dev      # vite --host 0.0.0.0 → http://localhost:5173 (LAN: http://<host-ip>:5173)
npm run build    # tsc && vite build — this is the lint/typecheck (TS strict is on)
npm run preview  # serve the built bundle
```

There are no tests. Validation is `npm run build` plus a browser pass at the target viewport (**1366×768, no page-level scrolling**) and at 1180×820 with touch (iPad). The verification tools stay outside the repo and add no repo dependencies:

- **SSR/logic harness:** write a scratch `.ts`/`.tsx` file in the session scratchpad that imports the real modules from `src/`. Bundle it with the esbuild that comes with vite, then run it with Node: `NODE_PATH=<repo>/node_modules <repo>/node_modules/.bin/esbuild h.tsx --bundle --platform=node --format=cjs --jsx=automatic --outfile=h.cjs && node h.cjs`. Render components with `renderToStaticMarkup`. Run date logic under `TZ=Asia/Kolkata` and one DST zone.
- **Browser pass:** use the system Python Playwright (`/Library/Frameworks/Python.framework/Versions/3.12/bin/python3`, browsers in `~/Library/Caches/ms-playwright`). Start `npx vite --host 127.0.0.1 --port <free port>`, and seed the `localStorage` key `alpha-planet-counter-v1` with `add_init_script`. Stop the server afterwards.
- Keep harnesses, seeds and screenshots in the scratchpad, never in the repo.

## Architecture

### Data flow

State lives in a single `AppState = { schemaVersion: 2, sessions, tables, menu, menuVersion, customers, charges, payments }` owned by `src/main.tsx`. `main.tsx` is the app shell: it holds state, wires keyboard shortcuts (⌘1–4), ticks the per-second timer, tracks the selected view/table, and passes handlers down (the props contract is `src/components/contracts.ts`).

- **Every write is a functional `setState` running a pure reducer on the current state** — never a value computed from the render closure. Reducers that touch sittings, the registry and tabs together live in `src/lib/appActions.ts` (seat, leave, bill a frame, charge the table order, close a table, put a bill on a tab, pay a tab, move/void charges, merge customers). One-sitting helpers live in `src/lib/sessionActions.ts`. Reducers return the old state unchanged when they do not apply, so a double tap is harmless.
- `src/lib/manualBill.ts` holds the manual bill, all pure: `manualSpan` (day and times), `manualBillTotals`, `manualBillError`, `recordManualBill`, `voidManualBill`, `manualFrameCharge`, `recordedOverlap`, `exceptionsToday`.
- Reads (active sitting, table status, `sittingAlert`, frame views, `leftSeats` / `tabChargeTargets`, totals, tabs, metrics, table history) go through selectors in `src/lib/billing.ts`. Registry helpers (phone normalising, search) are in `src/lib/customers.ts`. Menu categories and search are in `src/lib/menu.ts`.
- `src/lib/storage.ts` persists to `localStorage` and migrates older data (v1 loser-pays sittings become exact tab charges/payments via `src/lib/legacyFrames.ts`; the raw data is backed up under a side key first). `migrate` also replaces a saved menu whose `menuVersion` is not `MENU_VERSION`. `saveAppState` returns `false` when the browser refuses to save; the top bar then shows "Not saved". Rates has Export/Import backup.
- **Single-device only**: tabs live in one browser. Do not try to make `localStorage` multi-device; a shared backend is the path forward.

### Sittings (sessions)

A session is one sitting at a table (or one counter order).

- **Loser pays** (`splitMode: "frames"`, the snooker default): staff seat players (`seats`) and start frames — **a frame never starts by itself**. End frame records the end at the tap; picking the loser creates a `frame` charge on that customer's tab (table time + the table order) and the next frame waits for Start. The sitting itself bills nothing; Close table (or the last player leaving, when the table order is empty) closes it. A player who left can **Rejoin** (a new seat in the same sitting).
- **Whole table** (`splitMode: "table"`, pool default, the counter): the original bill — `Running (startedAt) → Billing (endedAt) → Settled (settledAt)`; Stop clock ends it; paid at the counter, or **put on a customer's tab** (`tabChargeId`). A void sets `settledAt` + `voidedAt`; voided bills are excluded everywhere. Reopen moves the start forward by the pause.
- **Manual bill** (`manual: true` on the session and on its charge): play that the floor did not record, entered afterwards from the **Manual bill** dialog (button in the tables-list head). `recordManualBill` sets `settledAt` when staff enter the record. One loser-pays entry is one frame, always on the loser's tab ("Add another" starts the next frame). A whole-table or counter entry takes Cash · UPI · Card or Put on tab. The Day select covers today and the 6 business days before it.
- `ratePerHour` and `extraPlayerRatePerHour` are **snapshotted onto the session** when it opens — never re-read table config when billing.

### Tabs

`Customer` (name, optional phone — digits, unique, Indian "91"/"0" prefix dropped; `guest` for "Player N"), `Charge` (`frame | cafe | bill | carry`, amounts snapshotted; `paymentId` when paid, `voidedAt` when voided, `manual` from a manual bill) and `Payment` (`amount` received, `discount`, the exact `chargeIds`, optional `carryChargeId` for what a part payment left owing). Customers pay tabs on the Customers page or from a player row ("Pay"), any day later.

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

**Loser pays**. Frames are explicit: each has its own `startedAt`/`endedAt` (both correctable before billing).

```
rate(t)        = ratePerHour + max(0, inFrame(t) − BASE_PLAYERS) × extraPlayerRatePerHour
inFrame(t)     = distinct customers with a seat joinedAt ≤ t and (no leftAt, or leftAt > frame start)
frameCharge    = floor(Σ segmentMs × rate / 3,600,000)      // floored once per frame
manualFrame    = floor((to − from) × rate(players) / 3,600,000)   // one fixed headcount
```

- `BASE_PLAYERS` (2) and `EXTRA_PLAYER_RATE_PER_HOUR` (₹30/hr = ₹0.5/min, snooker only; pool sittings snapshot 0) live in `src/data/tables.ts`.
- A player added mid-frame raises the rate from that moment. A player who leaves does **not** lower it: the rate stays until the frame ends, and the next frame starts from the players present at its start. A player who leaves and rejoins in one frame counts once. A player who left can't be the frame's loser. The last player in a running frame can't leave. `frameHeadcountAt` gives the headcount; `liveHeadcount` gives the one the rate displays use (tables list, Players rate footer, running frame). At the frame's end it equals the charge's `players`.
- Cancel frame only in its first 2 minutes.
- The **table order** (`session.orders`) goes into the next frame's charge. A "Charge to" chip on an open line moves one unit to a player's tab. "Charge all to…" (tap twice, between frames only) moves the whole table order. Both use `chargeTabTo`.

**Money views** (`calculateMetrics`, business day turns at `DAY_START_HOUR` = 6 AM): *sales* = whole bills settled today (paid or on a tab) + frame/cafe charges made today − tab discounts given today; *collected* = bills paid at the counter + tab payments; *open tabs* = every unpaid, unvoided charge. A `bill` charge is never counted twice (its session is the sale); a `carry` charge is never sales.

**Manual records** count on the business day of **entry** (`settledAt` / `createdAt`), not of play. This keeps bill numbers and "Collected" correct.

- A manual bill for an earlier day (`pastPlay = session.manual && startedAt < dayStart`) adds its money today, but no table minutes, sittings or utilization. Its money goes in the hour of entry. `calculateMetrics` and `getTableHistory` both apply this guard.
- A manual charge never sets the day's first activity (`earliest`). A manual frame played today sets it through its frame start.
- The manual times follow the 06:00 rules. A time before 06:00 is on the next calendar date, so 23:30–00:45 stays in one business day. An End of exactly 06:00 after a later start closes the business day. 06:00–06:00 is refused as equal times.
- `voidManualBill` voids manual records only, and only from the Done screen of the dialog that made the record. `voidCurrentSession` never voids a settled bill.

### Hardcoded config

- `src/data/tables.ts` — tables (name, rate, felt/rail colours, orientation for the tiny glyph in the tables list), pricing constants, the business-day hour, and the counter pseudo-table.
- `src/data/menu.ts` — the printed cafe menu, category by category in page order, with price variants. A dish printed on two pages is in both categories. **If you change this list, increase `MENU_VERSION`.** On the next load, `migrate` replaces a saved menu from an older version and drops the Rates edits to that menu.

Rates and menu prices are editable in the Rates view (PIN-gated); edits only affect new sittings and orders. After a price change, a menu tap opens a new order line (`findOrderLine` matches the item, the variant and the unit price).

### Rendering

CSS-only (`src/styles.css` plus per-area files in `src/styles/`), no UI library. `lucide-react` for icons. Manrope + Anton from Google Fonts loaded in `index.html`. The floor is a vertical tables list (no drawn tables): Tables 208px · Players 268px · Table 1fr · Cafe 300px at 1366×768. At 1199px and below the tables list is a rail (the same breakpoint in `styles.css` and `styles/floor-left.css`).

- **Tables:** the in-use count, "Tables" and the **Manual bill** button in the head; one row per table with its status pill; Cafe · Takeaway at the bottom.
- **Players:** seat rows, "Left the table" with **Rejoin**, the pinned add field, the live rate.
- **Table:** status pill + mode chip, the frame controls or the whole bill, and `OrderLines` — the one editable cafe list (Table order / Bill items / Order). While a frame waits for its loser, the lines show in that frame's breakdown. The whole bill is one scroll area under the hero total.
- **Cafe:** "Add to {table}", search, the category rail, the items, and a one-line summary of the list. The search looks through the whole menu. When a name has a word that starts with the search, only those names match; otherwise a name that contains the search matches (`filterMenu`). The chips keep the printed order and wrap so every category shows at once (never a sideways scroll). Sticky category headings show in "All" and in search results.

## Project-specific conventions

- **No new dependencies** without a clear operational benefit. React + CSS only — no canvas, no Three.js, no image-heavy assets.
- **Surgical edits over refactors.** Preserve billing/session behavior unless explicitly changing it.
- **Destructive actions use the tap-twice-within-3s confirm pattern** (a `confirming…` flag with an auto-reset effect). "Charge all to…" and the manual "Void bill" use it too. Do not use native `confirm()`. Dialogs (pay tab, customer, receipt, manual bill) are overlays on the receipt-overlay pattern; confirmations are never modals.
- **Money taps next to a list that can move have a 600 ms guard**: `TAP_GUARD_MS` in `OrderLines` (a "Charge to" chip after its line opens or after a charge) and `LOSER_PICK_GUARD_MS` in `TablePanel` (a loser button after End frame or after the breakdown changes). Keep these guards.
- **Show blocked reasons as text.** The iPad shows no `title` tooltips. Do not disable Pay or a seat's ✕: Pay opens the pay dialog with the reason, and a blocked ✕ shows its reason in the meta line for 3 s. The add field shows a table-level block as its placeholder. An empty counter order shows "Add items from the menu." in place of the payment controls. Hide a button that can't apply (Rejoin) instead of disabling it.
- **Add field: Enter never makes a new customer on a partial match.** The field highlights a row by default only for an exact match: the phone, or the one customer with that exact name.
- **One word per idea in UI text**: "loser" (never "lowest scorer" or "who lost"), "Table order" (never "table tab"; "tab" means only a customer's balance), "Bill items", "Order" (the counter), "Charge to" / "Charge all to…", "Rejoin" (never "back" or "return"), "Left the table", "Leave table" (never "away"), "Stop clock", "Back", "Manual bill", "Pay" (never "settle"), "Put on tab". Tenders always in the order Cash · UPI · Card (`TENDERS` in `contracts.ts`).
- **Table selection does NOT auto-start a session.** Starting requires the Start button. The Manual bill button never starts a sitting.
- **No cards.** Visual hierarchy comes from typography + hairline rules + whitespace. The intentional exceptions are buttons, inputs, pills, list rows that are buttons (tables list), `.qtyStepper` and the overlays — don't add more.
- **Palette tokens are CSS variables at the top of `src/styles.css`** (`--ink-blue`, `--felt-green`, `--brass`, `--ball-green`, `--ball-yellow`, `--ball-red`, `--surface`, `--hairline`…). Use them, don't hardcode colours.
- **Status colours**: running `var(--ball-green)`; needs-action `var(--ball-yellow)` for "Pick loser", "Take payment", "Idle 12m · n" (2+ seated, no frame for `IDLE_ALERT_MS` = 10 min) and "Charge table order" (nobody seated, table order not empty); "Seated · n" (before the first frame), "Between frames · n" and an empty counter order use the neutral seated tone; selected `var(--brass)`. `sittingAlert` gives the idle and order states. `TablesList.tableStatus` and `TablePanel.statusPill` both build the words: keep the tables list, the table panel pill and the top bar "waiting" count in sync.
- **No `font-weight: 900`.** Use 600/700 for hierarchy.
- **Codex rescue subagent** is the second-opinion reviewer on non-trivial changes (it caught the round-off staleness bug and the manual-bill 06:00 and first-activity bugs). Continue that pattern for changes that touch session math or contrast.
