# Alpha Planet Counter App Handoff

## Project Goal

A lightweight web app for a local pool/snooker venue called Alpha Planet. The app is a counter-staff console — not a SaaS dashboard. It runs on a laptop at the desk and an iPad on the floor (same Wi-Fi). Staff use it to:

- See every table at a glance in a vertical list, with its status and the live amount: free, seated, between frames, idle, frame running, frame waiting for its loser, table order to charge, whole-table clock running, or waiting for payment.
- Seat players on a table from the **customer registry** (name + phone) or as guests ("Player 1", …), also in the middle of a frame. A player who left can **Rejoin**.
- Run snooker as **loser pays**: staff start each frame, end it, and pick the loser. The frame's table time (priced by the number of players at the table) and the **table order** (the cafe that the table ordered) go on that player's **tab**.
- Keep the **whole-table bill** (one payer, clock from start to end, discount, round-off) for pool, the counter, or a party that pays together. Staff take the payment at the counter or put the bill on a tab.
- Enter a **manual bill** for play that the floor did not record, for example from a paper log (today and the 6 business days before it).
- Let people **pay their tab later** — the same night, days later or months later — on the Customers page or from their row on the floor, with discount and part payment.
- See the day's sales, money collected, open tabs, manual bills, voids and table use on the dashboard.

## Stack And How To Run

- React 19, TypeScript (strict), Vite
- CSS only (no UI library): `src/styles.css` + per-area files in `src/styles/`
- `lucide-react` for icons
- Google Fonts (Manrope, Anton) loaded in `index.html`
- Browser `localStorage` for persistence (single device — see risks)

```bash
npm install
npm run dev
```

- Local: `http://localhost:5173/` · LAN: `http://<host-ip>:5173/` (dev server uses `vite --host 0.0.0.0`)
- Build check: `npm run build` (runs `tsc && vite build`)
- Verification: an esbuild SSR harness and a system Python Playwright pass, both outside the repo (see CLAUDE.md "Commands").

The design target is **1366×768 with no page-level scrolling**. Every panel scrolls inside itself. At 1320px and below, the four floor columns are narrower. At 1199px and below (iPad landscape), the tables list becomes a narrow rail. At 920px and below (portrait), the rail sits next to one scrolling column.

## Current State

### Files

- `src/main.tsx` — app shell: state, timers, keyboard shortcuts (⌘1 Floor, ⌘2 Customers, ⌘3 Dashboard, ⌘4 Rates), selected view/table, dialogs (pay tab, customer, manual bill), handler wiring. **Every write is a functional `setState` running a pure reducer.**
- `src/components/contracts.ts` — the props contract between `main.tsx` and the floor components (`FloorActions`, `PayActions`, `ManualBillActions`), and `TENDERS` (the one tender order: Cash, UPI, Card).
- `src/types.ts` — domain types (`Customer`, `Charge`, `Payment`, `Session`, `Seat`, `Frame`, `ManualBillInput`, `AppState`, `Metrics`, …).
- `src/data/tables.ts` — tables, `BASE_PLAYERS`, `EXTRA_PLAYER_RATE_PER_HOUR`, `DAY_START_HOUR`, the counter pseudo-table.
- `src/data/menu.ts` — the printed cafe menu, its price variants and `MENU_VERSION`.
- `src/lib/billing.ts` — selectors: active sitting, table status, `sittingAlert`, headcount pricing, frame views, `leftSeats` / `tabChargeTargets`, totals, tabs, metrics, table history.
- `src/lib/sessionActions.ts` — pure helpers for one sitting (frames, the table order, `findOrderLine`, the whole bill).
- `src/lib/appActions.ts` — pure reducers across sittings, registry and tabs, plus the validators that the UI uses (`seatError`, `leaveError`, `closeSittingError`, `payBlockedReason`, `customerInputError`, …).
- `src/lib/manualBill.ts` — the manual bill, all pure: `manualSpan`, `manualBillTotals`, `manualBillError`, `recordManualBill`, `voidManualBill`, `manualFrameCharge`, `recordedOverlap`, `exceptionsToday`.
- `src/lib/customers.ts` — phone normalising, search, name/phone parsing.
- `src/lib/storage.ts` — load/save, migration, the menu-version rule, backup parsing. `src/lib/legacyFrames.ts` — the v1 loser-pays math, used only by the migration.
- `src/lib/menu.ts`, `src/lib/format.ts`, `src/lib/configActions.ts` — menu categories and search, formatting (money, clock, business day, `atOnBusinessDay`, `recentBusinessDays`, bill numbers), rate/menu edits.
- `src/components/` — `TopBar`, `TablesList`, `PlayersPanel`, `TablePanel`, `OrderLines`, `MenuPanel`, `ManualBillDialog`, `CustomersPage`, `CustomerDialog`, `PayTabDialog`, `Receipt`, `Dashboard`, `SettingsView`.
- `src/styles/` — `floor-left.css` (tables list, players), `table-panel.css` (Table column, `OrderLines`), `customers.css`, `misc.css` (menu), `manual.css` (manual bill dialog).

### Tables

`src/data/tables.ts`: Snooker 1 (₹1,200/hr), Snooker 2 (₹800), Snooker 3 (₹400), Snooker 4 and 5 (₹240), Pool 2 (American, ₹240, landscape, blue), Pool 1 (Indian, ₹240). Felt/rail colours and orientation drive the tiny glyph in the tables list. Rates and names are editable in Rates (PIN-gated); a new sitting snapshots the rate.

### Data shapes

```ts
type Customer = { id; name; phone?; guest?; createdAt };         // phone: 10 digits, unique
type Charge  = { id; customerId; createdAt; kind: "frame" | "cafe" | "bill" | "carry";
                 sessionId?; tableId?; tableName; frameNo?; minutes?; players?;
                 tableCharge; items: ChargeItem[]; adjust?; total; paymentId?; voidedAt?; fromPaymentId?; manual? };
type Payment = { id; customerId; at; mode: "Cash" | "UPI" | "Card"; amount; discount; chargeIds; carryChargeId? };
type Seat    = { id; customerId; joinedAt; leftAt? };             // a returning player gets a new seat
type Frame   = { id; startedAt; endedAt?; chargeId? };           // ended without charge = waiting for its loser
type Session = { id; tableId; startedAt; endedAt?; ratePerHour; orders; discount; roundOffEnabled?;
                 paymentMode?; settledAt?; voidedAt?; customerName?; splitMode?: "frames" | "table" | "per-player";
                 seats?; frames?; extraPlayerRatePerHour?; tabChargeId?; legacy?; manual? };
type ManualBillInput = { id; tableId; mode: "frames" | "table"; dayOffset; start; end; players; orders; discount; payer?; tender? };
type AppState = { schemaVersion: 2; sessions; tables; menu; menuVersion; customers; charges; payments };
```

### Menu

- `src/data/menu.ts` holds the printed cafe menu (Aug 2026 edition): 138 items in 17 categories, in the order of the printed pages. A dish that the menu prints on two pages has one item in each category, each with its own id and price. For example, Chilli Mushroom is under Starters and under Chinese, both at ₹250.
- **`MENU_VERSION` rule:** when you change the list in `src/data/menu.ts`, increase `MENU_VERSION`. On the next load, `migrate` replaces a saved menu from an older version with the new list. It also drops the Rates edits made to the older menu. An imported backup follows the same rule.
- **`findOrderLine`:** a menu tap adds one unit to the line with the same item, variant and unit price. After a price change, a tap opens a new line at the new price. The old line keeps its price.
- **Search** looks through the whole menu, whatever chip is selected. While a search runs, the "All" chip shows as active. When a name has a word that starts with the search, only those names match: "tea" gives the teas, not the Steamed Momos. When no name has such a word, a name that contains the search matches: "rita" gives Margherita Pizza. Results keep menu order. Esc or the ✕ button clears the search, and a chip tap clears it too.
- **Chips** stay in the printed order, so they never move during the night. All 18 chips show at once: they wrap onto about 6 rows (7 on the iPad) and never scroll. The chip text is in sentence case with tight padding, so the menu list keeps its room.
- **Headings:** in "All" and in search results, a sticky category heading marks the first item of each category. The headings also tell apart the two rows of a dish printed on two pages. One selected category shows no heading.

### Loser-pays snooker (`splitMode: "frames"`)

- A sitting opens when the first player is seated. It bills nothing by itself.
- **Start frame N** needs two players and never happens by itself. **End frame** records the end at the tap. Staff can correct the start while the frame runs. While the frame waits for its loser, staff can correct both Started and Ended. **Pick the loser** creates a `frame` charge on that customer's tab: the frame's table time plus the whole table order. **Keep playing** undoes End frame. **Cancel frame** works only in a frame's first 2 minutes.
- **Rate:** the table's rate covers 2 players; each extra player adds ₹30/hr (₹0.5/min) — snooker only. A player added mid-frame raises that frame's rate from that moment. A player who leaves does not lower it: the rate stays at the higher price until the frame ends, and the player can't lose the frame. The next frame starts from the players at the table when it starts. A player who leaves and rejoins in one frame counts once. So the frame's headcount is the number of different players at the table at any moment of the frame; it is also the "N players" on the frame's charge. The app prices the frame's charge second by second and floors it once. The tables list, the Players rate footer and the running frame show this same rate.
- **Table order:** the cafe that the table ordered and nobody pays yet. It goes to the next frame's loser. Staff can also charge one unit to a named player ("Charge to"), or, between frames only, the whole table order ("Charge all to…", tap twice). See **Layout → Table**.
- **Leave table** (✕, tap twice) keeps the player's tab. The last player in a running frame can't leave. The app deletes the seat of a player seated by mistake (under a minute, and not in a billed frame). This also works during a running frame, so a mis-entry never keeps the frame at the higher rate. **Rejoin** seats a player from "Left the table" again, with a new seat in the same sitting.
- **Close table** (tap twice) frees the table. The last player who leaves also closes it when no frame runs or waits and the table order is empty. Close table stays blocked while a frame runs or waits, and while the table order has lines ("Charge the table order to a player first.").
- **Status words:** "Seated · n" before the first frame and "Between frames · n" after it. The `sittingAlert` selector gives two needs-action states:
  - **idle:** 2 or more players are seated and no frame runs for 10 minutes (`IDLE_ALERT_MS`). The app counts from the later of the last frame's end and the sitting start. The pill shows "Idle 12m · n".
  - **order:** nobody is seated and the table order has lines. The tables list shows "Charge table order"; the panel pill adds "· ₹X".

### Whole-table bill (`splitMode: "table"`)

The original flow, with the same money: `minutes = max(1, floor(ms/60000))`, `tableCharge = floor(minutes × rate / 60)`, cafe, discount, round-off down to ₹5. **Start clock** → **Stop clock** (tap twice: "Tap again to stop") → take the payment.

- The hero total stays at the top. Everything under it scrolls as one area:
  - Name: "Add name" opens the field.
  - One line "In hh:mm · Out hh:mm · duration". A pencil opens the Started and Ended fields.
  - Discount and Round off. When the discount is at or above the subtotal, "Discount is more than the bill." shows in red.
  - **Take payment:** Cash · UPI · Card. Each opens a receipt preview with **Back** and "Confirm ₹X · Mode".
  - **Put on tab:** a player of this sitting, anyone in the registry, or a new customer. The new-tab button shows even when names match, so a second "Rahul" can get his own tab.
  - Reopen (after Stop clock) and Void bill (tap twice).
  - The **Bill items** list (`OrderLines`).
- The counter (Cafe · Takeaway) uses the same bill without a clock ("Order · n items", Void order). An empty counter order shows "Add items from the menu." in place of the payment controls.

### Manual bill (`src/lib/manualBill.ts`, `ManualBillDialog`)

A manual bill records play that the floor did not record, after the play.

- **Entry point:** the **Manual bill** button in the tables-list head. It shows the icon only in the rail, and the words only from 1200px to 1320px. A tap opens the dialog for the selected table. The floor selection does not change, and no sitting starts.
- **Form, in the owner's order:**
  - Table: chips S1 … P1, then Cafe · Takeaway. A hint shows when the table is in use now.
  - Billing: "Loser pays" or "Whole table". Snooker starts on Loser pays, pool on Whole table.
  - Players: 2–8, for loser pays on snooker only.
  - Day, then Started / Ended / Duration.
  - Discount: whole table and the counter only. There is no round-off.
  - The cafe items: the search looks through the whole menu.
  - The counter has no billing, day or times.
- **One frame per entry:** a loser-pays entry is one frame with one loser. **Add another** starts the next entry. It keeps the table, billing, day and players, sets Started to the previous Ended, and makes a new draft id.
- **Day:** "Today", "Yesterday", then the names of 5 more business days (`MANUAL_DAYS` = 7). On an older day, the note "Played {day}. It counts in today's sales." shows. The dialog keeps the date that staff picked, not an offset. A dialog left open across 6 AM therefore keeps the date, and a Today draft becomes Yesterday.
- **Times:** Started is empty and has the focus, so staff always type a real start. Ended is the current time on Today, and empty on an older day.
- **The 06:00 rules** (`atOnBusinessDay`, `manualSpan`):
  - A time before 06:00 is after midnight, on the next calendar date. So 23:30–00:45 stays in one business day.
  - An End of exactly 06:00 after a later start is the close of the business day (the next date, 06:00). So 23:00–06:00 is valid.
  - 06:00–06:00 is equal times: "End must be after start.".
  - A frame that crosses 06:00 fails with "End must be after start.". Enter it as two frames.
  - The dialog refuses an end in the future and a bill longer than 12 hours (`MANUAL_MAX_MINUTES` = 720).
- **Payer and tender:** a loser-pays entry always goes on the loser's tab (the payer field is "Loser"). A whole table or the counter takes Cash · UPI · Card, or **Put on tab** (the payer field is "Whose tab"). A new payer joins the registry in the same update. When Confirm is blocked, the first reason shows as text under it.
- **Records:** every record has `manual: true`: the session, the frame charge, and the bill charge of a whole bill put on a tab. `recordManualBill` sets `settledAt` when staff enter the record. The dialog makes the draft id once per draft, so a double tap never saves two bills. A read-only warning names a recorded sitting on the same table at an overlapping time (`recordedOverlap`).
- **Done screen:** "Put on tab" or "Payment recorded", then Pay now or Print receipt, **Add another** and Done. **Pay now** closes the dialog and opens the pay dialog for the loser. When `payBlockedReason` gives a reason, Pay now is disabled and the reason shows as text under it. When the id is not in state after the commit, the screen says "This bill is not on record." and **Back** returns to the kept draft.
- **Void rule:** `voidManualBill` voids a manual record only. Staff can use it only from the Done screen of the dialog that made the record: "Void bill", tap twice ("Tap again to void"), then "Bill voided". Staff can void a loser-pays entry only while its frame charge is open. This is a deliberate exception: `voidCurrentSession` never voids a settled bill.
- **Accounting (the entry-day rule):** a manual record counts on the business day when staff entered it (its `settledAt` / `createdAt`), not on the day of play. This keeps bill numbers stable and keeps "Collected" equal to the money taken today.
  - A manual bill for an earlier day (`pastPlay`) adds its money today but no table time. `calculateMetrics` and `getTableHistory` skip its minutes, sittings and utilization, and put its money in the hour of entry.
  - A manual charge never sets the day's first activity. A manual frame played today sets it through its frame start, like a floor frame.
- **Receipts and Dashboard:** a manual frame on a tab reads "{table} · Manual frame · lost", and a manual bill charge adds " · manual". A receipt has the row "Entry | Manual", plus " · played {day}" when the play day is not the entry day. Recent bills adds " · manual". The hero caption adds " · Manual n · ₹x" and " · Voids n · ₹x" (from `exceptionsToday`), each only when n > 0.

### Tabs and payments

- Customers page: registry with search, filters (Open tabs / Everyone / Guests), New customer, Edit (name, phone, merge duplicates).
- Pay dialog (from the Customers page or a player's **Pay** on the floor): the open charges as they were when the dialog opened, grouped by day; tick which to pay; Move to… another customer; Void (tap twice); discount; received (less than due leaves a `carry` charge); Cash · UPI · Card; printed tab receipt; past payments with Undo.
- The pay dialog holds back Confirm while a frame that the player can still lose waits for its loser. The floor's Pay button stays active and opens the dialog, which shows the reason.

### Money views (`calculateMetrics`)

The business day turns at 6 AM. *Sales* = whole bills settled today (paid or on a tab) + frame/cafe charges made today − tab discounts given today. *Collected* = bills paid at the counter + tab payments. *Open tabs* = every unpaid, unvoided charge. A `bill` charge never counts twice (its sitting is the sale), and a `carry` charge is never sales. Manual records follow the entry-day rule (see **Manual bill**).

### Layout (Floor, 1366×768)

`Tables 208px · Players 268px · Table 1fr · Cafe 300px` (196 · 252 · 1fr · 280px at 1320px and below; a 76px rail at 1199px and below — the same breakpoint in `styles.css` and `styles/floor-left.css`).

- **Tables list:**
  - The head holds the in-use count as an eyebrow ("3 in use" / "All free"), "Tables", and the **Manual bill** button.
  - Each row shows the glyph, short name (S1/P2), full name, rate, status pill and live ₹.
  - The pill words: "Free", "Seated · n", "Between frames · n", "Idle 12m · n", "Charge table order", "Frame N · mm:ss", "Pick loser · Frame N", "Clock h:mm", "Take payment ₹X".
  - Cafe · Takeaway is pinned at the bottom ("Order · n items").
- **Players:**
  - Seat rows: name + tab ₹ on the head line, then the meta line, then Pay, ✎ and ✕ Leave table. At 1199px and below, a row has three lines: head, meta, actions.
  - "Left the table": the players who left this sitting, with Pay, ✎ and **Rejoin**.
  - The add field, pinned at the bottom, and the live rate.
- **Rejoin** is one tap (not destructive, so no confirm). It sits where the ✕ sits on a seated row. It shows only when `seatError` allows the seat:
  - A missing customer record ("Unknown player") gets no Rejoin.
  - A player at another table who can't move (a clock, a bill to pay, a running or waiting frame) shows "Playing at {table}" and no Rejoin.
  - A player at an idle loser-pays table elsewhere shows "At {table}", and Rejoin moves them here.
  - A table-level block ("This bill has ended.", "The table is full (8).") hides Rejoin. The add field shows that reason as its placeholder.
  - Rejoin does not focus the add field, so the iPad keyboard stays closed. Mid-frame, the rate rises from that moment and the player can lose the frame. A ✕ within 60 s between frames deletes a mistaken new seat.
- **Add field:** it searches names and phones, and Enter picks the highlighted row.
  - By default the field highlights a row only for an exact match: the typed phone, or the one customer with exactly that name.
  - On a partial match nothing is highlighted, so Enter does nothing. The hint says "Tap a name, or ↑ to add new".
  - With no match, Enter adds the new name.
  - The Guest button focuses the field again only when the field had the focus, so it does not open the iPad keyboard.
- **Blocked reasons on the iPad:** the iPad shows no titles, so a blocked control shows its reason as text.
  - Pay is never disabled. The pay dialog shows why Confirm is held back.
  - A blocked ✕ is not disabled. The first tap shows the reason (for example "End or cancel frame 1 first.") in the row's meta line for 3 s and does not arm.
  - The first tap on an active ✕ says what leaving leaves behind: "Last player — table order ₹X not charged — tap again", "Owes ₹X, no phone — tap again", or "Leaves owing ₹X — tap again".
  - The first tap on Close table names anyone of this sitting (seated or left) who owes money and has no phone.
- **Table:** status pill + mode chip ("Loser pays" / "Whole table"), then the sitting:
  - Start buttons: snooker leads with Start frame, pool with Start clock.
  - The running frame: clock, table ₹, rate, the players in the frame, End frame, Cancel frame and Started. It shows no table-order figure; the **Table order** section under it shows the total.
  - The waiting frame: "Frame N ended — pick the loser", then the breakdown: Table time, the table-order rows (still editable), and "Goes on the loser's tab". Then the loser buttons, Keep playing, and the Started and Ended fields.
  - The **Table order** section, the Frames grid ("Amount", "Loser"; the loser can change while the charge is open) and Close table. For a whole bill, see **Whole-table bill**.
- **`OrderLines`** is the one editable list of a sitting's cafe lines: **Table order** (loser pays), **Bill items** (whole bill) or **Order** (the counter). It lives in the Table column only. While a frame waits for its loser, the lines show in that frame's breakdown, so each line shows once.
  - A tap on a row (or Enter/Space) opens the line. One line is open at a time. A second tap or Esc closes it.
  - An open line has a − qty + stepper. At qty 1, − removes the line.
  - On a loser-pays sitting, an open line also shows "Charge 1 to" (qty > 1) or "Charge to". Then comes one chip per seated player and a dashed "{name} · left" chip per player who left. One chip tap charges ONE unit to that player's tab.
  - A chip tap does nothing for 600 ms after its line opened or after the last charge (`TAP_GUARD_MS`). So a row that moves under the finger never charges the wrong player. A status line ("Charged 1 Tea to Rahul.") clears after 3 s.
  - The foot (loser pays) shows a note and the total. The note is "Goes to frame N's loser", "Goes to the next frame's loser", "Nobody at the table. Charge the table order to a player." or "Add a player to charge the table order.".
  - **Charge all to…** shows only between frames, when the table order has lines and a player can take it. A tap opens a picker. The first chip tap arms it ("{name} · tap again", 3 s); the second tap charges the whole table order.
  - The loser buttons ignore a tap for 600 ms after End frame, and after any tap, order change or height change in the breakdown (`LOSER_PICK_GUARD_MS`). So the second tap of a double tap never bills the frame.
- **Cafe:**
  - The eyebrow "Cafe" and the title "Add to {table}" ("Add to Takeaway" at the counter).
  - Search, the one-row category rail and the items (see **Menu**). The menu-row stepper changes the matching line (`findOrderLine`).
  - A one-line summary of the list, for example "Table order · 3 items ₹360" or "Nothing on the table order yet".

### Header, Dashboard, Rates

- Header: Floor · Customers · Dashboard · Rates; **Collected today** (sub: ₹ added to tabs) and **Live** (running + waiting); a red "Not saved" pill when the browser refuses to save; the hide-amounts toggle. "Waiting" counts every sitting in the needs-action colour: a loser to pick, a bill to take, an idle table, and a table order with nobody seated. An empty counter order does not count.
- Dashboard: hero = total sales (caption: bills · collected · on tabs, plus Manual n · ₹ and Voids n · ₹ when n > 0) with money through the day; stat strip (avg whole-table sitting, frames, players seated, tab payments, discounts, takeaway); sales mix donut; tender ribbon (collected by tender); per-table use meters; famous cafe items; recent bills and tab payments (open receipts). Chart colours: Cash `#2f7a48` / UPI `#1b4a86` / Card `#b5601a`; mix Table `#1b4a86` / Cafe `#b5601a` / Takeaway `#5a3680` (validated for CVD and contrast on the dashboard surface).
- Rates: table rates and names, menu items (PIN-gated), billing policy, **Backup** (export/import JSON, storage used), and clear data (PIN + tap twice).

### Migration

On first load of older data, the app copies the raw data to `alpha-planet-counter-v1-backup-before-v2`, then converts it: v1 loser-pays sittings become customers, charges and payments with the exact amounts that v1 billed (an active one keeps playing); "per-player" and v1 table sittings park their old fields under `legacy`. The app backs up a load that it can't read before it starts empty. Every load also applies the `MENU_VERSION` rule (see **Menu**). Manual flags need no migration: they are optional fields.

## Known risks and limitations

- **Tabs live in one browser.** The laptop and the iPad each keep their own data; clearing the browser deletes every open tab. Export a backup regularly (Rates → Backup). A shared backend is the real fix.
- **Storage grows** with every charge and payment (roughly 80–100 KB a busy day). The browser allows about 5 MB; the header shows "Not saved" when it is full. Archiving old records is future work.
- **A `MENU_VERSION` increase drops the Rates menu edits.** Before you increase it, copy any price that staff changed in Rates into `src/data/menu.ts`.
- **Manual bills have no PIN and no required reason.** The `manual` tag, the receipt row and the Dashboard caption are the audit trail. The dialog prices an older day at the rate in Rates today.
- **Manual bill skews (accepted):** a manual frame charge goes in the hour of its entry. A void of a manual bill renumbers the later bills of that day. Each loser-pays entry counts as one frame sitting.
- **Status words live in two places:** `TablesList.tableStatus` and `TablePanel.statusPill`. If you change a word, change it in both.
- **No tests in the repo.** Validation is `npm run build`, plus domain harnesses and browser passes that run outside the repo.
- **Light theme only.**
- The app assumes that `Intl.NumberFormat("en-IN", …)` is available.

## Dev style and product direction

- React + CSS only. No canvas, Three.js, image-heavy assets, or new UI libraries. No new dependencies without a clear operational benefit.
- **UI direction:** practical counter console, not a SaaS dashboard. No card-heavy layouts, glossy gradients or big shadows. Hierarchy via typography + hairline rules + whitespace.
- **One word per idea** in UI text:
  - "loser" (never "lowest scorer" or "who lost")
  - "Table order" for the cafe on a loser-pays table (never "table tab"), "Bill items" for a whole bill's lines, "Order" for the counter. "Tab" means only a customer's balance.
  - "Charge to" / "Charge 1 to" (one unit), "Charge all to…" (the whole table order)
  - "Rejoin" (never "back" or "return"), "Left the table", "Leave table" (never "away")
  - "Stop clock" (never "End session"), "Back" (the receipt preview; never "Change")
  - "Pay" (never "settle"), "Put on tab"
  - "Manual bill", "Manual frame", "Entry | Manual", "Manual n · ₹ · Voids n · ₹"
  - The tenders always in the order Cash · UPI · Card (`TENDERS`).
- **Staff speed first:** tap table → add players → Start frame → End frame → pick the loser. Customers pay their tabs when they are ready.
- **Engineering preferences:** money actions are pure reducers applied with functional state updates; a new sitting snapshots the rates; destructive actions are tap twice (no native `confirm()`); table selection never starts anything; a money tap next to a list that can move has a 600 ms guard; a blocked control on the iPad shows its reason as text.

## Suggested next work

1. **Shared backend** (SQLite/Postgres + small API, live sync) so tabs are shared by the laptop and the iPad and survive a cleared browser.
2. **Archive** old paid charges/sessions into monthly summaries once a backup is exported.
3. **Customer extras:** notes, credit limit, "regulars" quick list, WhatsApp/SMS tab reminders (needs a backend).
4. **QA on real hardware** at the counter laptop and iPad (touch targets, on-screen keyboard with the add field).

## A note on working with Codex on this codebase

- `npm run build` is the primary lint/typecheck — TypeScript strict mode is on.
- The Codex rescue subagent is the second-opinion reviewer for changes that touch money. It caught the round-off staleness bug, several v1 loser-pays bugs, a past-day manual frame that moved today's first activity, and a 06:00 end on the business-day boundary. Keep using it for session/tab math.
