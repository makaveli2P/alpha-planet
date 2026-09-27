import React from "react";
import { AlertTriangle, ArrowLeft, CircleCheck, CircleX, Minus, Plus, Printer, Search, X } from "lucide-react";
import { BASE_PLAYERS } from "../data/tables";
import { payBlockedReason } from "../lib/appActions";
import {
  COUNTER_ID,
  calculateSessionTotals,
  getActiveSession,
  isFrameBilled,
  leftSeats,
  ratePerHourFor,
  seatedNow,
  startOfDay,
  tabTotal
} from "../lib/billing";
import { findByPhone, searchCustomers, splitNameAndPhone } from "../lib/customers";
import { businessDayName, businessDayStart, createId, formatDuration, formatMoney, recentBusinessDays, shortTableName, timeValue } from "../lib/format";
import { MANUAL_DAYS, manualBillError, manualBillTotals, manualSpan, recordedOverlap, voidManualBill } from "../lib/manualBill";
import { filterMenu } from "../lib/menu";
import {
  MAX_SEATED,
  MIN_FRAME_PLAYERS,
  addOrderToSession,
  changeOrderQuantity,
  createCounterOrder,
  createSitting,
  findOrderLine
} from "../lib/sessionActions";
import type { AppState, Customer, ManualBillInput, ManualPayer, MenuItem, OrderLine, PaymentMode, Session, TableConfig } from "../types";
import { TENDERS, type ManualBillActions } from "./contracts";
import { Receipt, maskedPhone } from "./Receipt";

export type ManualBillDialogProps = ManualBillActions & {
  state: AppState;
  tableId: string; // the floor's selected table, or "counter"
  now: number;
  onClose: () => void;
  onPayNow: (customerId: string) => void; // closes this dialog and opens the pay dialog
};

type Tender = PaymentMode | "Tab";

const CONFIRM_MS = 3000;
const MENU_RESULTS = 8;
const MAX_SUGGESTIONS = 6;
const QUICK_PICKS = 4;
const MAX_INPUT = 60;
// The tender buttons in the floor order, then Put on tab.
const TENDER_CHOICES: Tender[] = [...TENDERS, "Tab"];

// Tap-twice guard for a destructive button: the first tap arms it, and it
// disarms by itself after 3 s.
function useConfirming(): [boolean, (value: boolean) => void] {
  const [confirming, setConfirming] = React.useState(false);
  React.useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  return [confirming, setConfirming];
}

function toAmount(text: string): number {
  const value = Math.floor(Number(text));
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clockTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Loser pays is the snooker default; pool bills the whole table.
function defaultMode(table: TableConfig | undefined): ManualBillInput["mode"] {
  return table?.game === "snooker" ? "frames" : "table";
}

// The headcount at the table now when that is enough for a frame, else 2.
function defaultPlayers(state: AppState, tableId: string): number {
  const active = getActiveSession(state.sessions, tableId);
  const seated = active ? seatedNow(active).length : 0;
  return seated >= MIN_FRAME_PLAYERS ? Math.min(seated, MAX_SEATED) : MIN_FRAME_PLAYERS;
}

// The draft's cafe lines use the floor's own line reducers (same item, variant
// and price → one line), on a counter-order shell that is never saved.
function linesShell(orders: OrderLine[]): Session {
  return { ...createCounterOrder(COUNTER_ID, 0, "draft"), orders };
}

// Quick picks for the payer: the players of the table's sitting now (seated
// first, then those who left), else of its latest sitting settled today.
function quickPicks(state: AppState, tableId: string, now: number): { label: string; customers: Customer[] } {
  if (tableId === COUNTER_ID) return { label: "", customers: [] };
  const byId = new Map(state.customers.map((customer) => [customer.id, customer]));
  const pick = (ids: string[]) =>
    Array.from(new Set(ids))
      .map((id) => byId.get(id))
      .filter((customer): customer is Customer => customer != null)
      .slice(0, QUICK_PICKS);
  const active = getActiveSession(state.sessions, tableId);
  const atTable = active ? pick([...seatedNow(active), ...leftSeats(active)].map((seat) => seat.customerId)) : [];
  if (atTable.length > 0) return { label: "At the table now", customers: atTable };
  const dayStart = startOfDay(now);
  const latest = state.sessions
    .filter((session) => session.tableId === tableId && !session.manual && !session.voidedAt && session.settledAt != null && session.settledAt >= dayStart)
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))[0];
  return { label: "Played here today", customers: latest ? pick((latest.seats ?? []).map((seat) => seat.customerId)) : [] };
}

// ====== Payer field: suggestions ======

type PayerOption = { customer: Customer; tab: number };
type NewPayerRow = { label: string; name: string; phone?: string; blocked: boolean };
type PayerModel = { options: PayerOption[]; last: NewPayerRow; defaultIndex: number };

// The suggestion rows for the typed text, as on the floor's add field: registry
// matches, then "add as new". The default highlight is an exact match only (the
// typed phone, or the one customer with exactly this name), so Enter never picks
// a lookalike; with no matches it is the last row.
function buildPayerModel(state: AppState, text: string): PayerModel {
  const q = text.trim();
  const parsed = splitNameAndPhone(q);
  const digitsOnly = /^[\d\s+()-]+$/.test(q);
  const phoneText = parsed.phone ?? (digitsOnly ? q : undefined);
  const phoneOwner = phoneText ? findByPhone(state.customers, phoneText) : undefined;
  const sameName = state.customers.filter((customer) => customer.name.toLowerCase() === q.toLowerCase());
  const exact = phoneOwner ?? (sameName.length === 1 ? sameName[0] : undefined);

  let matches = searchCustomers(state.customers, q, MAX_SUGGESTIONS);
  if (exact) matches = [exact, ...matches.filter((customer) => customer.id !== exact.id)].slice(0, MAX_SUGGESTIONS);
  const options = matches.map((customer) => ({ customer, tab: tabTotal(state.charges, customer.id) }));

  const { name, phone } = parsed;
  let last: NewPayerRow;
  if (phoneOwner) {
    last = { label: `Phone belongs to ${phoneOwner.name}`, name, phone, blocked: true };
  } else if (digitsOnly || !name) {
    last = { label: phone ? "New number — type a name before it" : "Type a name, or the whole phone number", name, phone, blocked: true };
  } else if (state.customers.some((customer) => customer.name.toLowerCase() === name.toLowerCase())) {
    last = { label: `Add another "${name}"`, name, phone, blocked: false };
  } else {
    last = { label: `Add "${name}" as new`, name, phone, blocked: false };
  }

  const exactIndex = exact ? options.findIndex((option) => option.customer.id === exact.id) : -1;
  const defaultIndex = exactIndex >= 0 ? exactIndex : last.blocked || options.length > 0 ? -1 : options.length;
  return { options, last, defaultIndex };
}

// Type a name or phone; Enter picks the highlighted row. Escape with text
// clears it (and closes the suggestions) before it can close the dialog.
function PayerField({
  state,
  label,
  text,
  onText,
  onPick
}: {
  state: AppState;
  label: string;
  text: string;
  onText: (value: string) => void;
  onPick: (payer: ManualPayer) => void;
}) {
  const [focused, setFocused] = React.useState(false);
  const [cursor, setCursor] = React.useState<number | null>(null);
  const blurTimer = React.useRef<number | undefined>(undefined);
  const listId = React.useId();
  React.useEffect(() => () => window.clearTimeout(blurTimer.current), []);

  const model = buildPayerModel(state, text);
  const count = model.options.length + 1;
  const active = cursor ?? model.defaultIndex;
  const open = focused && text.trim() !== "";
  const optionId = (index: number) => `${listId}-opt-${index}`;

  function isSelectable(index: number): boolean {
    if (index < 0 || index >= count) return false;
    return index < model.options.length || !model.last.blocked;
  }

  function pick(index: number) {
    if (!isSelectable(index)) return;
    if (index < model.options.length) onPick({ customerId: model.options[index].customer.id });
    else onPick({ name: model.last.name, phone: model.last.phone });
  }

  function move(step: 1 | -1) {
    let index = active < 0 ? (step > 0 ? -1 : count) : active;
    for (index += step; index >= 0 && index < count; index += step) {
      if (isSelectable(index)) {
        setCursor(index);
        return;
      }
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (text.trim()) pick(active);
    } else if (event.key === "Escape" && text) {
      event.preventDefault();
      onText("");
      setCursor(null);
    }
  }

  // A tap on a row keeps the focus in the field.
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();

  return (
    <div className="mbPayerField">
      {open && (
        <ul className="mbSuggest" id={listId} role="listbox" aria-label="Matching customers">
          {model.options.map((option, index) => (
            <li
              key={option.customer.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className={`flOption${index === active ? " is-active" : ""}`}
              onMouseDown={keepFocus}
              onMouseEnter={() => setCursor(index)}
              onClick={() => pick(index)}
            >
              <span className="flOptName">
                <strong>{option.customer.name}</strong>
                {option.customer.guest && <em className="flGuestTag">guest</em>}
              </span>
              {option.tab > 0 && <span className="flOptTab">Tab {formatMoney(option.tab)}</span>}
              <span className="flOptMeta">{maskedPhone(option.customer.phone)}</span>
            </li>
          ))}
          <li
            id={optionId(model.options.length)}
            role="option"
            aria-selected={active === model.options.length}
            aria-disabled={model.last.blocked ? true : undefined}
            className={`flOption flOptNew${active === model.options.length ? " is-active" : ""}${model.last.blocked ? " is-blocked" : ""}`}
            onMouseDown={keepFocus}
            onMouseEnter={() => (model.last.blocked ? undefined : setCursor(model.options.length))}
            onClick={() => pick(model.options.length)}
          >
            <span className="flOptName">
              {model.last.blocked ? <AlertTriangle size={13} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
              <strong>{model.last.label}</strong>
            </span>
            {model.last.phone && !model.last.blocked && <span className="flOptMeta">Phone {model.last.phone}</span>}
          </li>
          <li className="flSuggestHint" role="presentation">
            {active < 0 && model.options.length > 0 && !model.last.blocked ? "Tap a name, or ↑ to add new" : "↑ ↓ to choose · Enter to pick · Esc to clear"}
          </li>
        </ul>
      )}
      <input
        className="cxInput"
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        placeholder="Name or phone"
        value={text}
        maxLength={MAX_INPUT}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        onChange={(event) => {
          onText(event.target.value);
          setCursor(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          window.clearTimeout(blurTimer.current);
          setFocused(true);
        }}
        onBlur={() => {
          // Wait a moment so a tap on a suggestion still lands.
          blurTimer.current = window.setTimeout(() => setFocused(false), 150);
        }}
      />
    </div>
  );
}

// ====== The dialog ======

// A bill that the floor did not record, entered afterwards from a paper log:
// the table, loser pays or the whole table, the players, the day and times, the
// cafe items, then the payment. One bill per entry; "Add another" starts the
// next one where this one ended. The money math is in lib/manualBill.ts, and the
// dialog finds what it recorded in state by the draft id.
export function ManualBillDialog({ state, tableId: startTableId, now, onClose, onPayNow, onRecordManual, onVoidManual }: ManualBillDialogProps) {
  const startTable = startTableId === COUNTER_ID ? undefined : state.tables.find((entry) => entry.id === startTableId) ?? state.tables[0];
  // Made once per draft, so a double tap can never save two bills.
  const [draftId, setDraftId] = React.useState(() => createId());
  const [tableId, setTableId] = React.useState(() => startTable?.id ?? COUNTER_ID);
  const [mode, setMode] = React.useState<ManualBillInput["mode"]>(() => defaultMode(startTable));
  const [players, setPlayers] = React.useState(() => defaultPlayers(state, startTable?.id ?? COUNTER_ID));
  // The business day that staff picked, as the day's start (not as "N days
  // ago"), so a dialog left open across 6 AM keeps the date. A draft on Today
  // then becomes Yesterday, the night that just ended.
  const [day, setDay] = React.useState(() => businessDayStart(now));
  // Started is empty, so a guessed length never goes through unchecked. Ended
  // is the current time on Today, until staff change it.
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState(() => timeValue(now));
  const [endTouched, setEndTouched] = React.useState(false);
  const [orders, setOrders] = React.useState<OrderLine[]>([]);
  const [discountText, setDiscountText] = React.useState("");
  const [tender, setTender] = React.useState<Tender | undefined>(undefined);
  const [payer, setPayer] = React.useState<ManualPayer | undefined>(undefined);
  const [payerText, setPayerText] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [recordError, setRecordError] = React.useState<string | undefined>(undefined);
  const [done, setDone] = React.useState<{ id: string; at: number } | null>(null);
  const [receiptOpen, setReceiptOpen] = React.useState(false);
  const [armedVoid, setArmedVoid] = useConfirming();
  const uid = React.useId();

  // A refused record's reason stays only until the draft changes.
  React.useEffect(() => {
    setRecordError(undefined);
  }, [draftId, tableId, mode, players, day, start, end, orders, discountText, tender, payer]);

  // Escape closes the dialog (the payer field and the menu search clear their
  // text first). The receipt overlay handles its own Escape while it is open.
  const escapeRef = React.useRef({ receiptOpen, onClose });
  escapeRef.current = { receiptOpen, onClose };
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (escapeRef.current.receiptOpen) return;
      escapeRef.current.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counter = tableId === COUNTER_ID;
  const table = counter ? undefined : state.tables.find((entry) => entry.id === tableId);
  const frames = !counter && mode === "frames";
  // The rates a new sitting on this table would snapshot.
  const pricing = table ? createSitting(table, 0, draftId) : undefined;
  const perPlayer = frames && (pricing?.extraPlayerRatePerHour ?? 0) > 0;
  const rate = pricing ? ratePerHourFor(pricing, perPlayer ? players : BASE_PLAYERS) : 0;
  const usesPayer = frames || tender === "Tab";
  // After the record, price the draft at the moment it was recorded, so the
  // head does not change if the business day turns while the dialog is open.
  const priceAt = done?.at ?? now;
  // -1 for a day older than the last week: manualBillError refuses it.
  const dayOffset = recentBusinessDays(priceAt, MANUAL_DAYS).indexOf(day);
  const input: ManualBillInput = {
    id: draftId,
    tableId,
    mode,
    dayOffset,
    start,
    end,
    players,
    orders,
    discount: frames ? 0 : toAmount(discountText),
    payer: usesPayer ? payer : undefined,
    tender: frames ? undefined : tender
  };
  const totals = manualBillTotals(state, input, priceAt);
  const span = manualSpan(input, priceAt);
  const timed = table != null && span.to > span.from;
  const whyNot = manualBillError(state, input, now) ?? recordError;
  const tableLabel = table ? table.name : "Cafe · Takeaway";
  const units = orders.reduce((sum, line) => sum + line.quantity, 0);
  const customersById = new Map(state.customers.map((customer) => [customer.id, customer]));

  function pickTable(id: string) {
    if (id === tableId) return;
    setTableId(id);
    setMode(defaultMode(state.tables.find((entry) => entry.id === id)));
    setPlayers(defaultPlayers(state, id));
  }

  function pickDay(offset: number) {
    // The date of the option that staff saw (the list is from this render).
    setDay(recentBusinessDays(now, MANUAL_DAYS)[offset]);
    // Ended defaults to the current time only on Today; an older day starts empty.
    if (!endTouched) setEnd(offset === 0 ? timeValue(Date.now()) : "");
  }

  function addItem(item: MenuItem, price: MenuItem["prices"][number]) {
    setOrders((current) => addOrderToSession(linesShell(current), item, price, createId).orders);
  }

  function changeLine(lineId: string, delta: number) {
    setOrders((current) => changeOrderQuantity(linesShell(current), lineId, delta).orders);
  }

  function record() {
    if (whyNot) return;
    // The day's index at the moment of the tap, in case 6 AM went by since the
    // last render.
    const result = onRecordManual({ ...input, dayOffset: recentBusinessDays(Date.now(), MANUAL_DAYS).indexOf(day) });
    if ("error" in result) {
      setRecordError(result.error);
      return;
    }
    setDone({ id: result.id, at: Date.now() });
    setArmedVoid(false);
  }

  // Keeps the table, billing, day and players; the next bill starts where this
  // one ended.
  function addAnother() {
    // The next entry starts where this one ended. An end at 06:00 sharp closes
    // the business day, so the next entry belongs to the day after it.
    const nextDay = !counter && Number.isFinite(span.to) ? businessDayStart(span.to) : day;
    setDraftId(createId());
    setDay(nextDay);
    setStart(counter ? "" : end);
    setEnd(nextDay === businessDayStart(Date.now()) ? timeValue(Date.now()) : "");
    setEndTouched(false);
    setOrders([]);
    setDiscountText("");
    setPayer(undefined);
    setPayerText("");
    setTender(undefined);
    setQuery("");
    setDone(null);
    setReceiptOpen(false);
    setArmedVoid(false);
  }

  // ====== What was recorded (the Done screen) ======

  const saved = done ? state.sessions.find((session) => session.id === done.id) : undefined;
  const savedFrames = saved ? isFrameBilled(saved) : false;
  const savedChargeId = saved ? (savedFrames ? saved.frames?.[0]?.chargeId : saved.tabChargeId) : undefined;
  const savedCharge = savedChargeId ? state.charges.find((charge) => charge.id === savedChargeId) : undefined;
  const savedTotal = saved ? (savedFrames ? savedCharge?.total ?? 0 : calculateSessionTotals(saved, priceAt).total) : 0;
  const savedCustomer = savedCharge ? customersById.get(savedCharge.customerId) : undefined;

  if (receiptOpen && saved) {
    return <Receipt state={state} now={now} session={saved} onClose={() => setReceiptOpen(false)} />;
  }

  // ====== Head ======

  const duration = !start.trim() ? "Enter Started to price the table" : timed ? formatDuration(totals.minutes) : "—";
  let sub: string;
  if (!table) sub = `Takeaway · ${units} ${units === 1 ? "item" : "items"}`;
  else if (frames) sub = ["Loser pays", perPlayer ? `${players} players` : "", `${formatMoney(rate)}/hr`, duration].filter(Boolean).join(" · ");
  else sub = `Whole table · ${formatMoney(table.ratePerHour)}/hr · ${duration}`;
  const parts = [
    totals.tableCharge > 0 ? `Table ${formatMoney(totals.tableCharge)}` : "",
    totals.cafe > 0 ? `Cafe ${formatMoney(totals.cafe)}` : "",
    totals.discount > 0 ? `−${formatMoney(totals.discount)}` : ""
  ]
    .filter(Boolean)
    .join(" · ");

  const head = (
    <header className="cxPayHead mbHead">
      <div className="cxPayWho">
        <p className="eyebrow">Manual bill</p>
        <h2 className="cxDialogTitle">{tableLabel}</h2>
        <span>{sub}</span>
      </div>
      <div className="cxPayOpen">
        <span>Total</span>
        <strong>{formatMoney(saved ? savedTotal : totals.total)}</strong>
        {parts && <em className="mbParts">{parts}</em>}
      </div>
      <button type="button" className="receiptClose" onClick={onClose} aria-label="Close">
        <X size={16} />
      </button>
    </header>
  );

  // ====== Done screen ======

  if (done) {
    let body: React.ReactNode;
    if (!saved) {
      body = (
        <div className="cxEmpty">
          <strong>This bill is not on record.</strong>
          <span>Check the details and try again.</span>
          <button type="button" className="rowGhostBtn" onClick={() => setDone(null)}>
            <ArrowLeft size={13} aria-hidden="true" /> Back
          </button>
        </div>
      );
    } else {
      const voided = saved.voidedAt != null;
      const canVoid = !voided && voidManualBill(state, saved.id, now) !== state;
      const onTab = savedFrames || Boolean(saved.tabChargeId);
      const who = savedCustomer?.name ?? "a customer";
      const payBlocked = savedFrames && savedCustomer && !voided ? payBlockedReason(state, savedCustomer.id, now) : undefined;
      body = (
        <>
          <div className="settleConfirm cxPayDone" role="status">
            {voided ? <CircleX size={30} aria-hidden="true" /> : <CircleCheck size={30} aria-hidden="true" />}
            <h3>{voided ? "Bill voided" : onTab ? "Put on tab" : "Payment recorded"}</h3>
            {!voided && <div className="settleConfirmTotal">{formatMoney(savedTotal)}</div>}
            <p className="settleConfirmWho">
              {voided
                ? `${tableLabel} · ${formatMoney(savedTotal)} · removed from sales`
                : onTab
                  ? `${tableLabel} · ${who} · pays later`
                  : `${tableLabel} · ${saved.paymentMode ?? "—"}`}
            </p>
            <div className="cxDoneActions mbDoneActions">
              {!voided && savedFrames && savedCustomer && (
                <button type="button" className="ghostAction" disabled={Boolean(payBlocked)} onClick={() => onPayNow(savedCustomer.id)}>
                  Pay now
                </button>
              )}
              {!voided && !onTab && (
                <button type="button" className="ghostAction" onClick={() => setReceiptOpen(true)}>
                  <Printer size={16} aria-hidden="true" /> Print receipt
                </button>
              )}
              <button type="button" className="ghostAction" onClick={addAnother}>
                <Plus size={16} aria-hidden="true" /> Add another
              </button>
              <button type="button" className="primaryAction" onClick={onClose}>
                Done
              </button>
            </div>
            {payBlocked && (
              <p className="settleConfirmWho mbBlocked">
                <AlertTriangle size={13} aria-hidden="true" />
                {payBlocked}
              </p>
            )}
          </div>
          {canVoid && (
            <button
              type="button"
              className={`ghostAction danger mbVoid${armedVoid ? " confirming" : ""}`}
              onClick={() => {
                if (!armedVoid) {
                  setArmedVoid(true);
                  return;
                }
                setArmedVoid(false);
                onVoidManual(saved.id);
              }}
            >
              {armedVoid ? "Tap again to void" : "Void bill"}
            </button>
          )}
        </>
      );
    }
    return (
      <div className="receiptOverlay" role="dialog" aria-modal="true" aria-label="Manual bill">
        <div className="receiptPaper cxPaper cxPay mbPaper">
          {head}
          <div className="cxPayScroll mbDone">{body}</div>
        </div>
      </div>
    );
  }

  // ====== The form ======

  const inUse = table ? getActiveSession(state.sessions, table.id) : undefined;
  const days = recentBusinessDays(now, MANUAL_DAYS);
  const dayName = (index: number) => (index === 0 ? "Today" : index === 1 ? "Yesterday" : businessDayName(days[index], now));
  const overlap = table && timed ? recordedOverlap(state, table.id, span.from, span.to, now) : undefined;
  const q = query.trim();
  const results = q ? filterMenu(state.menu, "All", q).slice(0, MENU_RESULTS) : [];
  const shell = linesShell(orders);

  const pickedCustomer = payer && "customerId" in payer ? customersById.get(payer.customerId) : undefined;
  const payerShown = payer != null && (!("customerId" in payer) || pickedCustomer != null);
  const payerName = payer ? ("customerId" in payer ? pickedCustomer?.name : payer.name) : undefined;
  const picks = usesPayer && !payerShown && !payerText.trim() ? quickPicks(state, tableId, now) : { label: "", customers: [] };

  let confirmLabel: string;
  if (frames) confirmLabel = `Put ${formatMoney(totals.total)} on ${payerName ? `${payerName}'s` : "the loser's"} tab`;
  else if (tender === "Tab") confirmLabel = `Put ${formatMoney(totals.total)} on ${payerName ? `${payerName}'s tab` : "a tab"}`;
  else confirmLabel = `Confirm payment · ${formatMoney(totals.total)}${tender ? ` · ${tender}` : ""}`;

  const tableChip = (id: string, short: string, name: string) => (
    <button
      key={id}
      type="button"
      role="radio"
      aria-checked={id === tableId}
      aria-label={name}
      title={name}
      className={id === tableId ? "active" : ""}
      onClick={() => pickTable(id)}
    >
      {short}
    </button>
  );

  return (
    <div className="receiptOverlay" role="dialog" aria-modal="true" aria-label="Manual bill">
      <div className="receiptPaper cxPaper cxPay mbPaper mbEdit">
        {head}

        <div className="cxPayScroll mbBody">
          <div className="mbForm">
            <div className="mbBlock">
              <p className="mbLabel" id={`${uid}-table`}>
                Table
              </p>
              <div className="mbChips" role="radiogroup" aria-labelledby={`${uid}-table`}>
                {state.tables.map((entry) => tableChip(entry.id, shortTableName(entry.name), entry.name))}
                {tableChip(COUNTER_ID, "Cafe · Takeaway", "Cafe · Takeaway")}
              </div>
              {table && inUse && (
                <p className="mbHint mbWarn">
                  <AlertTriangle size={13} aria-hidden="true" />
                  {table.name} is in use now. For a late Start or End, fix the times on the floor instead.
                </p>
              )}
            </div>

            {table && (
              <div className="mbBlock">
                <p className="mbLabel" id={`${uid}-billing`}>
                  Billing
                </p>
                <div className="cxTender mbSeg" role="radiogroup" aria-labelledby={`${uid}-billing`}>
                  {(["frames", "table"] as const).map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      role="radio"
                      aria-checked={mode === entry}
                      className={mode === entry ? "active" : ""}
                      onClick={() => setMode(entry)}
                    >
                      {entry === "frames" ? "Loser pays" : "Whole table"}
                    </button>
                  ))}
                </div>
                {frames && <p className="mbHint">One frame, one loser. Tap Add another for the next frame.</p>}
              </div>
            )}

            {perPlayer && (
              <div className="mbBlock mbInline">
                <p className="mbLabel">Players</p>
                <div className="qtyStepper" role="group" aria-label="Players">
                  <button
                    type="button"
                    disabled={players <= MIN_FRAME_PLAYERS}
                    onClick={() => setPlayers((value) => Math.max(MIN_FRAME_PLAYERS, value - 1))}
                    aria-label="One player fewer"
                  >
                    <Minus size={12} />
                  </button>
                  <span>{players}</span>
                  <button
                    type="button"
                    disabled={players >= MAX_SEATED}
                    onClick={() => setPlayers((value) => Math.min(MAX_SEATED, value + 1))}
                    aria-label="One more player"
                  >
                    <Plus size={12} />
                  </button>
                  <em>{formatMoney(rate)}/hr</em>
                </div>
              </div>
            )}

            {table && (
              <div className="mbBlock">
                <label className="mbDay">
                  <span className="mbLabel">Day</span>
                  <select className="mbSelect" value={dayOffset} onChange={(event) => pickDay(Number(event.target.value))}>
                    {days.map((dayStart, index) => (
                      <option key={dayStart} value={index}>
                        {dayName(index)}
                      </option>
                    ))}
                  </select>
                </label>
                {dayOffset > 0 && (
                  <p className="mbHint">Played {dayOffset === 1 ? "yesterday" : dayName(dayOffset)}. It counts in today's sales.</p>
                )}
              </div>
            )}

            {table && (
              <div className="mbBlock">
                <div className="mbTimes">
                  <label className="timeField">
                    <span>Started</span>
                    <input type="time" value={start} onChange={(event) => setStart(event.target.value)} autoFocus />
                  </label>
                  <label className="timeField">
                    <span>Ended</span>
                    <input
                      type="time"
                      value={end}
                      onChange={(event) => {
                        setEnd(event.target.value);
                        setEndTouched(true);
                      }}
                    />
                  </label>
                  <div className="timeField mbDuration">
                    <span>Duration</span>
                    <strong>{timed ? formatDuration(totals.minutes) : "—"}</strong>
                  </div>
                </div>
                {overlap && (
                  <p className="mbHint mbWarn">
                    <AlertTriangle size={13} aria-hidden="true" />
                    {table.name} has a recorded sitting from {clockTime(overlap.from)} to {clockTime(overlap.to)}. Check this is not billed twice.
                  </p>
                )}
              </div>
            )}

            {!frames && (
              <div className="mbBlock">
                <label className="cxField mbDiscount">
                  <span>Discount ₹</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={discountText}
                    placeholder="0"
                    onChange={(event) => setDiscountText(event.target.value)}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
              </div>
            )}
          </div>

          <section className="mbCafe" aria-label="Cafe">
            <h3 className="mbLabel">Cafe</h3>
            <div className="searchBox">
              <Search size={17} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    event.preventDefault();
                    setQuery("");
                  }
                }}
                placeholder="Search menu"
                aria-label="Search menu"
              />
              {query && (
                <button type="button" className="mpClear" onClick={() => setQuery("")} aria-label="Clear search">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="mbMenu">
              {q ? (
                results.length === 0 ? (
                  <p className="muted mbEmpty">No items match “{q}”.</p>
                ) : (
                  results.map((entry) => (
                    <div className="menuItem" key={entry.id}>
                      <span className="menuItemName">
                        {entry.name}
                        <em className="mbSmall">{entry.category}</em>
                      </span>
                      <div className="priceButtons">
                        {entry.prices.map((price) => {
                          const label = price.label === "Regular" ? formatMoney(price.price) : `${price.label} ${formatMoney(price.price)}`;
                          const line = findOrderLine(shell, entry, price);
                          if (line) {
                            return (
                              <div key={price.label} className="qtyStepper">
                                <button type="button" onClick={() => changeLine(line.lineId, -1)} aria-label={`Remove one ${entry.name}`}>
                                  <Minus size={12} />
                                </button>
                                <span>{line.quantity}</span>
                                <button type="button" onClick={() => changeLine(line.lineId, 1)} aria-label={`Add one ${entry.name}`}>
                                  <Plus size={12} />
                                </button>
                                <em>{label}</em>
                              </div>
                            );
                          }
                          return (
                            <button key={price.label} type="button" onClick={() => addItem(entry, price)}>
                              <Plus size={14} /> {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )
              ) : orders.length === 0 ? (
                <p className="muted mbEmpty">No cafe items. Search to add.</p>
              ) : (
                orders.map((line) => (
                  <div className="menuItem mbLine" key={line.lineId}>
                    <span className="menuItemName">
                      {line.name}
                      {line.variant !== "Regular" && <em className="mbSmall">{line.variant}</em>}
                    </span>
                    <div className="qtyStepper">
                      <button type="button" onClick={() => changeLine(line.lineId, -1)} aria-label={`Remove one ${line.name}`}>
                        <Minus size={12} />
                      </button>
                      <span>{line.quantity}</span>
                      <button type="button" onClick={() => changeLine(line.lineId, 1)} aria-label={`Add one ${line.name}`}>
                        <Plus size={12} />
                      </button>
                    </div>
                    <strong className="mbAmount">{formatMoney(line.unitPrice * line.quantity)}</strong>
                  </div>
                ))
              )}
            </div>
            {frames && orders.length > 0 && <p className="mbHint">The items go on the loser's tab with the frame.</p>}
          </section>
        </div>

        {/* The footer grows upward, so the tender row and Confirm stay under the finger. */}
        <footer className="cxPayFoot mbFoot">
          {usesPayer && (
            <div className="mbPayer">
              <div className="mbPayerHead">
                <span className="mbLabel">{frames ? "Loser" : "Whose tab"}</span>
                {picks.customers.length > 0 && <span className="mbHint">{picks.label}</span>}
                {picks.customers.map((customer) => (
                  <button key={customer.id} type="button" className="rowGhostBtn" onClick={() => setPayer({ customerId: customer.id })}>
                    {customer.name}
                  </button>
                ))}
              </div>
              {payerShown && payer ? (
                <div className="mbPicked">
                  <span>
                    <strong>{payerName}</strong>
                    {pickedCustomer?.guest && <span className="cxGuestTag">guest</span>}
                    {" · "}
                    {"customerId" in payer ? maskedPhone(pickedCustomer?.phone) : `new customer · ${maskedPhone(payer.phone)}`}
                    {pickedCustomer && tabTotal(state.charges, pickedCustomer.id) > 0 ? ` · Tab ${formatMoney(tabTotal(state.charges, pickedCustomer.id))}` : ""}
                  </span>
                  <button type="button" className="rowGhostBtn" onClick={() => setPayer(undefined)}>
                    Change
                  </button>
                </div>
              ) : (
                <PayerField state={state} label={frames ? "Loser: name or phone" : "Whose tab: name or phone"} text={payerText} onText={setPayerText} onPick={setPayer} />
              )}
            </div>
          )}
          {!frames && (
            <div className="cxTender mbTender" role="radiogroup" aria-label="Payment mode">
              {TENDER_CHOICES.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="radio"
                  aria-checked={tender === entry}
                  className={tender === entry ? "active" : ""}
                  onClick={() => setTender(entry)}
                >
                  {entry === "Tab" ? "Put on tab" : entry}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="settleAction cxConfirm" disabled={Boolean(whyNot)} onClick={record}>
            <CircleCheck size={17} aria-hidden="true" /> {confirmLabel}
          </button>
          {/* Always there (a blank line when the form is ready), so the footer
              keeps its height when the reason goes. */}
          <p className="cxWhy" aria-live="polite">
            {whyNot ?? "\u00a0"}
          </p>
        </footer>
      </div>
    </div>
  );
}
