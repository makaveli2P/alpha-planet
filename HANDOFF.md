# Alpha Planet Counter App Handoff

## Project Goal

Lightweight web app for a local pool/snooker venue called Alpha Planet. The app is a counter-staff console — not a SaaS dashboard. It runs on a laptop at the desk and an iPad on the floor (same Wi-Fi). Staff use it to:

- Start and end table sessions, with the bill calculated to the minute against a stored hourly rate.
- Add kitchen/menu items to a table bill, with quantity steppers and variant pricing.
- Apply discount and round off (to nearest ₹5) before settlement.
- Settle by payment mode (Cash / UPI / Card) and view today's metrics.
- Glance at the live floor to see which tables are running, billing, free, and their running totals — without clicking into them.

## Stack And How To Run

- React 19
- TypeScript
- Vite
- CSS only (no UI library)
- `lucide-react` for icons
- Google Fonts (`Manrope`) loaded in `index.html`
- Browser `localStorage` for prototype persistence

```bash
npm install
npm run dev
```

- Local: `http://localhost:5173/`
- LAN: `http://<host-ip>:5173/` (dev server uses `vite --host 0.0.0.0`)
- Build check: `npm run build` (runs `tsc && vite build`)

The design target is **1366×768 with no page-level scrolling**. The floor view fits; the dashboard and rates views scroll internally inside their panels.

## Current State

### Files

- `src/main.tsx` — app shell only: state, timers, keyboard shortcuts, selected view/table, handler wiring.
- `src/types.ts` — shared domain types (`Session`, `TableConfig`, `MenuItem`, `Metrics`, `AppView`, etc.).
- `src/data/tables.ts` — hardcoded table layout/rates/felt/rail config.
- `src/data/menu.ts` — hardcoded kitchen menu and price variants.
- `src/lib/billing.ts` — active-session lookup, table status, billing totals, dashboard metrics, table history.
- `src/lib/sessionActions.ts` — pure session mutation helpers used by `main.tsx`.
- `src/lib/menu.ts` — menu category ranking and filtering.
- `src/lib/balls.ts` — snooker/pool rack and break-state ball layouts.
- `src/lib/format.ts` — money, duration, hour, category, ID helpers.
- `src/lib/storage.ts` — localStorage load/save wrapper.
- `src/components/*` — `TopBar`, `FloorBoard`, `BillPanel`, `MenuPanel`, `Dashboard`, `SettingsView`.
- `src/styles.css` — full app layout, table styling, rails, pockets, balls, light vintage theme, responsive rules.
- `index.html` — Google Fonts link for Manrope.
- Assets: `menu1.avif`, `menu2.avif`, `ChatGPT Image May 16, 2026, 11_41_11 AM.png` (reference, not consumed at runtime).

### Tables

Hardcoded in `tables` array in `src/data/tables.ts`:

| Name | Type | Game value | Orientation | Rate | Notes |
|------|------|------------|-------------|------|-------|
| Snooker 4 | Snooker | `snooker` | portrait | ₹240/hr | standard tier |
| Snooker 3 | Snooker | `snooker` | portrait | ₹400/hr | standard tier |
| Snooker 2 | Snooker | `snooker` | portrait | ₹800/hr | high tier (`tier-high`) |
| Snooker 1 | Snooker | `snooker` | portrait | ₹1,200/hr | premium tier (`tier-premium`) |
| Pool 2 | American Pool | `american-pool` | landscape, blue cloth, black rails, **diamonds** | ₹240/hr | the only landscape table |
| Pool 1 | Indian Pool | `indian-pool` | portrait, green cloth, brown rails, **no diamonds** | ₹240/hr | |

**Important:** the convention is now Pool 2 = American (with diamonds), Pool 1 = Indian (no diamonds). The `game` field drives rendering: `american-pool` → diamonds via `<RailDiamonds />`; `indian-pool` → no diamonds; `snooker` → snooker rack and color positions.

### Data shapes

```ts
type Session = {
  id: string;
  tableId: string;
  startedAt: number;            // ms timestamp
  endedAt?: number;             // ms timestamp; set when staff hits End Session
  ratePerHour: number;          // snapshotted from table config at startSession()
  orders: OrderLine[];
  discount: number;             // ₹ off
  roundOffEnabled?: boolean;    // when true, total is rounded to nearest 5 dynamically
  paymentMode?: PaymentMode;    // Cash | UPI | Card
  settledAt?: number;
  voidedAt?: number;            // void path sets both settledAt and voidedAt
};
```

```ts
type AppState = { sessions: Session[] };
type ClosedSession = Session & { settledAt: number };   // type predicate used in getTableHistory
```

### Billing math (`calculateSessionTotals` in `src/lib/billing.ts`)

```
minutes        = max(1, ceil(((endedAt ?? now) - startedAt) / 60000))
tableCharge    = ceil((minutes / 60) * ratePerHour)
kitchenTotal   = Σ(unitPrice × quantity)
subtotal       = tableCharge + kitchenTotal
afterDiscount  = max(0, subtotal − discount)
if (roundOffEnabled):
  target       = max(0, round(afterDiscount / 5) * 5)
  roundOff     = target − afterDiscount         // can be negative or positive
  total        = target
else:
  total        = afterDiscount
```

**Round-off is derived, not stored.** This avoids staleness as `now` ticks every second and `minutes` increments. The session only stores the boolean `roundOffEnabled`.

### Session lifecycle

1. **Available** — no active session. Tile shows rack of balls. Selecting it opens the bill panel which displays last-session and today-on-this-table stats.
2. **Running** — `startedAt` set, `endedAt` undefined. Tile shows scattered ("broken") balls. Header live-counter increments. Live chip overlay on the tile shows `elapsed · ₹total` in green.
3. **Billing** — `endedAt` set, no `settledAt`. Timer frozen. Live chip overlay in gold. Settle buttons (Cash/UPI/Card) become active.
4. **Settled** — `settledAt` set. Session disappears from active state, contributes to today's dashboard metrics and `getTableHistory` stats.
5. **Voided** — `voidedAt` and `settledAt` both set. Excluded from metrics and history.

End-session and Clear-local-data both use a **tap-twice-within-3s confirm pattern** (`confirmingEnd`, `confirmingClear` flags with auto-reset effects). No native `confirm()` modal.

### Visual / UX direction (current)

- **Light theme, warm vintage palette.** Page bg `#f3ecd9` (cream paper). Top bar `#ede4cc`. Text `#2a1f12` primary, `#5a4936` secondary, `#7a6a54` muted. Borders `#d8c9af` subtle, `#c2b094` defined, `#a89478` sepia. Action greens `#226d3f / #1f5c36 / #1e6938`. Amber for warnings `#8a4f1d`. Brass gold `#b07820` for billing/premium. Danger red `#a13c2a`.
- **Floor canvas** is a warm-beige radial gradient (`#efe1c5 → #d8c4a0`) with very subtle sepia grid lines.
- **No cards.** Panel containers (`.floorPanel`, `.billPanel`, etc.) have no border or background. Hierarchy comes from typography + hairline rules + whitespace. The `.totalStrip`, `.adjustments`, `.metricGrid`, `.tableHistoryStrip` use 1-column-per-stat with `border-left` hairline separators and top/bottom rules to frame each band.
- **Exceptions to no-cards** (intentional): buttons (need press affordance), inputs, category pills, the table tile itself, `.tableInfo` pill below each table (brass-nameplate look on light floor), `.liveChip` overlay on running tiles, `.qtyStepper` (green chip marks "this item is on the bill").
- **Fonts.** Manrope for UI (weights 400-800). All `font-weight: 900` rules were removed; use 600/700 for hierarchy and keep letter spacing at `0` except uppercase eyebrow labels.
- **Status semantics.**
  - Running/billing tiles get a 3px outset border (`#5fb978` / `#d0a04c`) via `::after`. Suppressed when the tile is also selected (gold outline takes over).
  - Selected tile has a gold outline (`#b07820`, 3px, 4px offset).
  - Premium-tier (₹1,200) Snooker 1 gets a gold accent on its info pill border.
  - High-tier (₹800) Snooker 2 + premium get gold rate text in the info pill.
  - Status colors propagate to: legend dots, live chip text, info pill `em` color, header live counter chips.

### Header

- Left: brand block (`<Circle filled />` icon as a cue ball + "Counter System / Alpha Planet").
- Middle: Floor / Dashboard / Rates nav. Active state is solid billiard-green button.
- Right: two stacked stat blocks — `Today ₹X · N settled` (settled-today total) and `Live ₹X · N running · M billing` (live total across active tables, with green/gold accents when nonzero).
- Keyboard shortcuts: ⌘1 / ⌘2 / ⌘3 (or Ctrl+ on non-Mac) switch views.

### Bill panel (center column, free vs active)

- **Free table:** clock icon, "Ready for the next session", rate label, Start button, then a 2-column `tableHistoryStrip` showing Last Session (`duration · total · time · payment mode`) and Today on this table (`N sessions · X minutes · ₹revenue`). Uses `getTableHistory()` which filters sessions by `tableId`, `settledAt`, `!voidedAt`.
- **Active table:** 4-column total strip (Duration / Table / Kitchen / Total), then a 2-column adjustments row (Discount input / Round off toggle), then bill actions (End Session with confirm / Cash / UPI / Card / Void bill), then scrolling order list with inline quantity steppers per line.

### Menu panel (right column)

- Search box, category pill rail (wraps; sorted by today's usage with "All" pinned first; pill labels are `shortCategory(name)` which strips "Planet" / "Mania" suffixes).
- Menu items are flat rows with a hairline bottom border. Each item shows name on the left, price button(s) on the right. For items with two prices (Half/Full), two buttons render side-by-side.
- **Inline `− N +` stepper:** once a price has been added to the active bill, the price button is replaced by a green stepper showing the current quantity and a trailing price label. Decrementing to 0 returns the stepper to the original `+ ₹X` button.

### Dashboard view

Scrolls internally. Sections (top-to-bottom):
1. KPI row — 4 inline stats: Total sales / Table revenue / Kitchen revenue / Discounts.
2. 2×2 insight grid — Most sought tables (by minutes), Famous kitchen items (by quantity), Peak hours (by sessions started in each hour), Payment modes (by total).
3. Receipts list — last 8 settled, non-voided bills with table name, payment mode, time, duration, total.

### Rates view

Scrolls internally. Six rate rows (one per table) showing name / type / `₹X / hour`. Read-only. Policy box at the bottom with the billing-policy text and a Clear local data button (tap-twice confirm).

## Cue-sport details worth knowing

- Snooker rack: baulk at the bottom of the table (player POV). Black on top spot (`y=13`), reds triangle with apex toward baulk (`y=36` to `y=25.6`, 2.6% row spacing), pink at apex (`y=42`), blue at center (`y=50`), brown/yellow/green on baulk line (`y=73`, with yellow on the right `x=65`, green on the left `x=35`), cue ball inside the D (`y=78`). Reds touch pink — apex-to-pink gap is ~6% which equals the 9px sum of radii at typical table render sizes.
- 8-ball rack order is `[1, 10, 3, 15, 8, 2, 6, 11, 4, 14, 5, 13, 9, 7, 12]` — apex 1, 8 ball middle of row 3, back-row corners are 5 (solid) and 12 (stripe) per WPA rules.
- Diamond markers (American pool only): six per long rail at `13/25/37/63/75/87` % (skipping 50% where the middle pocket sits), three per short rail at `25/50/75` %. Portrait diamond positions exist but Pool 1 (Indian) doesn't render diamonds.
- Running-state ball scatter uses `seedOffset(tableId)` for per-table variation (range ±6) so multiple running tables don't look identical.

## Known risks and limitations

- **localStorage persistence is local to each device.** A session started on the laptop won't appear on the iPad. Production needs a shared backend.
- **Rates and table config hardcoded** in `src/data/tables.ts`. Rates view is display-only.
- **Menu items hardcoded** in `src/data/menu.ts` from the menu images.
- **No tests.** Validation is `npm run build` plus manual browser checks.
- **Light theme only**, no toggle. If you reintroduce dark, the old palette is in git history.
- **Ball positions are deterministic but manually chosen.** They look like a rack / break but aren't physically simulated.
- **`Intl.NumberFormat("en-IN", ...)`** is used for currency. Locale availability is assumed.
- **Codex CLI is used as a second-opinion reviewer** in this project (run via `/codex` skill or `codex` CLI). Several bugs in this round were caught by Codex review — recommend the same pattern for non-trivial future changes.

## Dev style and product direction

- React + CSS only. No canvas, Three.js, image-heavy assets, or new UI libraries.
- No new dependencies without a clear operational benefit.
- Keep changes scoped, prefer surgical edits over refactors. Test with `npm run build`.
- **UI direction:** practical counter console, not a SaaS dashboard. No card-heavy nested layouts, no glossy gradients, no oversized shadows, no decorative section-header icons. Hierarchy via typography + hairline rules + whitespace.
- **Staff speed first:** select table → start session → add items → end session → settle. Common path should require minimal mouse travel.
- **Important operational data above the fold:** elapsed time per table, live revenue, table tier, last-session context — visible without clicking.
- **Engineering preferences:**
  - Preserve billing/session behavior unless explicitly changing it.
  - Table/session rates are snapshotted at session start, not re-read on bill generation.
  - Destructive actions are explicit and confirmed (tap-twice pattern). No native `confirm()`.
  - Table selection does NOT auto-start sessions. Starting requires the Start button.
  - Use deterministic UI states; the screen should not flicker between renders.
  - For future production work, a small shared backend with SQLite or Postgres is the path. Don't try to make localStorage multi-device.

## Suggested next work

1. **Shared persistence backend**:
   - Small API server (FastAPI / Express / Hono)
   - SQLite database
   - Tables: `sessions`, `orders`, `payments`, optionally `tables` and `menu_items` if rates/menu become editable
   - WebSocket or polling for cross-device live sync
2. **Settings UI become editable**:
   - Edit table rates (with rate snapshot semantics preserved on existing sessions)
   - Edit table names / types / orientation / felt color
   - Edit menu items, prices, variants
3. **Receipt / history workflow**:
   - View past bills (filter by date, table, payment mode)
   - Reprint / duplicate receipt
   - Refund / void history view
   - Optionally a printable receipt format
4. **Polish from the review backlog**:
   - `.eyebrow` at 10px/600 is a flagged contrast risk on cream — bump to 11px or 650 weight.
   - Consider disabling the Round off button while session is still running (currently the live total ticks every minute and the displayed round-off chip follows, which is correct but visually noisy). UX call.
   - Per-rate edit affordance in the Rates view (currently read-only).
   - Add some kind of "regular customer" marker / quick-start (deferred until backend exists).
5. **QA on real hardware** at counter laptop (Windows / Mac) and iPad landscape. Touch tap targets, font rendering on each, search input behavior with software keyboard.

## A note on working with Codex on this codebase

- `npm run build` is the primary lint/typecheck — TypeScript strict mode is on via `tsconfig.json`.
- Light theme color tokens are hardcoded (no CSS variables yet). For future theme work, introducing CSS custom properties at `:root` would be a small pragmatic refactor.
- The Codex rescue subagent has been used as a second-opinion reviewer for non-trivial changes (e.g., the round-off math staleness bug was caught that way). Recommend continuing that pattern when adding features that touch session math or theme contrast.
