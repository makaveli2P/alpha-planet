import React from "react";
import { AlertTriangle, Pencil, Plus, UserPlus, X } from "lucide-react";
import { BASE_PLAYERS, EXTRA_PLAYER_RATE_PER_HOUR } from "../data/tables";
import { leaveError, movableFrom, nextGuestName, payBlockedReason, seatError } from "../lib/appActions";
import {
  COUNTER_ID,
  awaitingFrame,
  isFrameBilled,
  leftSeats,
  liveHeadcount,
  presentSeats,
  ratePerHourFor,
  runningFrame,
  seatOf,
  seatedNow,
  tabTotal,
  tableTabTotal
} from "../lib/billing";
import { findByPhone, initials, searchCustomers, splitNameAndPhone } from "../lib/customers";
import { formatMoney, formatRatePerMinute } from "../lib/format";
import type { AppState, Customer, Seat, Session, TableConfig } from "../types";
import type { FloorActions, FloorProps } from "./contracts";

export type PlayersPanelProps = FloorProps &
  Pick<FloorActions, "onSeatCustomer" | "onSeatNew" | "onSeatGuest" | "onLeave" | "onPay" | "onEditCustomer">;

const CONFIRM_MS = 3000;
const MAX_SUGGESTIONS = 6;
const MAX_INPUT = 60;

// "9876543210" → "••••3210".
function maskedPhone(phone?: string): string {
  return phone ? `••••${phone.slice(-4)}` : "no phone";
}

function tableNameOf(state: AppState, tableId: string): string {
  return state.tables.find((table) => table.id === tableId)?.name ?? "Cafe";
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ====== Add a player: suggestions ======

type CustomerOption = { customer: Customer; tab: number; note?: string; blocked: boolean };
type NewRow = { label: string; name: string; phone?: string; blocked: boolean };
type AddModel = { options: CustomerOption[]; last: NewRow; defaultIndex: number };

// The suggestion rows for the typed text: registry matches (not the players
// already at this table), then the "add as new" row. The default highlight is
// an exact match only (the typed phone, or the one customer with exactly this
// name). With other matches nothing is highlighted, so Enter never makes a new
// customer from a partial match; with no matches it is the last row.
function buildAddModel(state: AppState, table: TableConfig, session: Session | undefined, text: string): AddModel {
  const q = text.trim();
  const here = new Set(session ? seatedNow(session).map((seat) => seat.customerId) : []);
  const parsed = splitNameAndPhone(q);
  const digitsOnly = /^[\d\s+()-]+$/.test(q);
  const phoneText = parsed.phone ?? (digitsOnly ? q : undefined);
  const phoneOwner = phoneText ? findByPhone(state.customers, phoneText) : undefined;
  const sameName = state.customers.filter((customer) => customer.name.toLowerCase() === q.toLowerCase());
  const exact = phoneOwner ?? (sameName.length === 1 ? sameName[0] : undefined);

  let matches = q ? searchCustomers(state.customers, q, 24).filter((customer) => !here.has(customer.id)) : [];
  if (exact && !here.has(exact.id)) matches = [exact, ...matches.filter((customer) => customer.id !== exact.id)];

  const options = matches.slice(0, MAX_SUGGESTIONS).map((customer): CustomerOption => {
    const error = seatError(state, table, customer.id);
    const from = error ? undefined : movableFrom(state, customer.id);
    return {
      customer,
      tab: tabTotal(state.charges, customer.id),
      note: error ? error.replace(/\.$/, "") : from ? `Moves from ${tableNameOf(state, from.session.tableId)}` : undefined,
      blocked: Boolean(error)
    };
  });

  const name = parsed.name;
  const phone = parsed.phone;
  let last: NewRow;
  if (phoneOwner) {
    const label = here.has(phoneOwner.id) ? `Phone belongs to ${phoneOwner.name} — already at this table` : `Phone belongs to ${phoneOwner.name}`;
    last = { label, name, phone, blocked: true };
  } else if (digitsOnly || !name) {
    last = { label: phone ? "New number — type a name before it" : "Type a name, or the whole phone number", name, phone, blocked: true };
  } else if (exact && here.has(exact.id)) {
    // That exact name is already at this table: Enter does nothing; a real
    // namesake can still be added from this row with a tap.
    last = { label: `${exact.name} is already at this table — add another "${name}"`, name, phone, blocked: false };
  } else if (state.customers.some((customer) => customer.name.toLowerCase() === name.toLowerCase())) {
    last = { label: `Add another "${name}"`, name, phone, blocked: false };
  } else {
    last = { label: `Add "${name}" as new`, name, phone, blocked: false };
  }

  const exactIndex = exact ? options.findIndex((option) => option.customer.id === exact.id) : -1;
  const exactHere = Boolean(exact && here.has(exact.id));
  const defaultIndex = exactIndex >= 0 ? exactIndex : last.blocked || exactHere || options.length > 0 ? -1 : options.length;
  return { options, last, defaultIndex };
}

// One field, pinned to the panel: type a name or phone, Enter picks the
// highlighted row. The field never unmounts and takes focus back after every
// add, so staff can type the next player straight away.
function AddPlayerField({
  state,
  table,
  session,
  onSeatCustomer,
  onSeatNew,
  onSeatGuest
}: {
  state: AppState;
  table: TableConfig;
  session?: Session;
  onSeatCustomer: FloorActions["onSeatCustomer"];
  onSeatNew: FloorActions["onSeatNew"];
  onSeatGuest: FloorActions["onSeatGuest"];
}) {
  const [text, setText] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [cursor, setCursor] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const blurTimer = React.useRef<number | undefined>(undefined);
  const listId = React.useId();

  React.useEffect(() => () => window.clearTimeout(blurTimer.current), []);

  // Table-level checks only (the bill ended, the table is full): no customer
  // is seated under an empty id.
  const blocked = seatError(state, table, "");
  const model = buildAddModel(state, table, session, text);
  const count = model.options.length + 1;
  const active = cursor ?? model.defaultIndex;
  const open = focused && !blocked && text.trim() !== "";
  const optionId = (index: number) => `${listId}-opt-${index}`;

  // Keep the highlighted row in view as ↑/↓ move it.
  React.useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  function isSelectable(index: number): boolean {
    if (index < 0 || index >= count) return false;
    return index < model.options.length ? !model.options[index].blocked : !model.last.blocked;
  }

  function reset() {
    setText("");
    setCursor(null);
    setError(undefined);
  }

  function refocus() {
    inputRef.current?.focus();
  }

  function pick(index: number) {
    if (!isSelectable(index)) return;
    if (index < model.options.length) {
      onSeatCustomer(model.options[index].customer.id);
    } else {
      const message = onSeatNew({ name: model.last.name, phone: model.last.phone });
      if (message) {
        setError(message);
        refocus();
        return;
      }
    }
    reset();
    refocus();
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
      // Empty Enter does nothing: only the Guest button adds a guest.
      if (text.trim()) pick(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      reset();
    }
  }

  // A tap on a row or button keeps the focus in the field.
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();

  return (
    <div className={`flAdd${open ? " is-open" : ""}`}>
      {open && (
        <ul className="flSuggest" id={listId} role="listbox" aria-label="Matching customers">
          {model.options.map((option, index) => (
            <li
              key={option.customer.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              aria-disabled={option.blocked ? true : undefined}
              className={`flOption${index === active ? " is-active" : ""}${option.blocked ? " is-blocked" : ""}`}
              onMouseDown={keepFocus}
              onMouseEnter={() => (option.blocked ? undefined : setCursor(index))}
              onClick={() => pick(index)}
            >
              <span className="flOptName">
                <strong>{option.customer.name}</strong>
                {option.customer.guest && <em className="flGuestTag">guest</em>}
              </span>
              {option.tab > 0 && <span className="flOptTab">{formatMoney(option.tab)}</span>}
              <span className="flOptMeta">
                {maskedPhone(option.customer.phone)}
                {option.note && <b className={option.blocked ? "is-blocked" : "is-move"}> · {option.note}</b>}
              </span>
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
            {/* Nothing is highlighted on a partial match: ↑ from the field reaches the add-new row, just above this hint. */}
            {active < 0 && model.options.length > 0 && !model.last.blocked ? "Tap a name, or ↑ to add new" : "↑ ↓ to choose · Enter to add · Esc to clear"}
          </li>
        </ul>
      )}

      <div className="flAddRow">
        <div className={`flField${blocked ? " is-disabled" : ""}`}>
          <UserPlus size={15} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Add a player: name or phone"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
            placeholder={blocked ?? "Name or phone"}
            value={text}
            maxLength={MAX_INPUT}
            disabled={Boolean(blocked)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(event) => {
              setText(event.target.value);
              setCursor(null);
              setError(undefined);
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
          {text && (
            <button
              type="button"
              className="flClear"
              aria-label="Clear"
              onMouseDown={keepFocus}
              onClick={() => {
                reset();
                refocus();
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          type="button"
          className="ghostAction flGuestBtn"
          disabled={Boolean(blocked)}
          title={blocked ?? `Adds ${nextGuestName(state, table.id)}`}
          onMouseDown={keepFocus}
          onClick={() => {
            // Focus the field again only when it had the focus (the laptop
            // flow): on the iPad a focus opens the keyboard over the table.
            const hadFocus = document.activeElement === inputRef.current;
            onSeatGuest();
            reset();
            if (hadFocus) refocus();
          }}
        >
          <Plus size={14} aria-hidden="true" /> Guest
        </button>
      </div>
      {error && (
        <p className="flAddError" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ====== Seat rows ======

// What the ✕ says on its first tap. The last player out while the table order
// is not charged, or a player who owes money and can't be reached (a guest, or
// no phone), gets the danger colour, so staff can charge, Pay or ✎ first.
function leaveArmText(customer: Customer | undefined, tab: number, orderTotal: number): { text: string; danger: boolean } {
  if (orderTotal > 0) return { text: `Last player — table order ${formatMoney(orderTotal)} not charged — tap again`, danger: true };
  if (tab > 0 && (!customer || customer.guest || !customer.phone)) {
    return { text: `Owes ${formatMoney(tab)}, no phone — tap again`, danger: true };
  }
  if (tab > 0) return { text: `Leaves owing ${formatMoney(tab)} — tap again`, danger: false };
  return { text: "Tap again to leave table", danger: false };
}

function SeatName({ customer, fallback, children }: { customer?: Customer; fallback: string; children?: React.ReactNode }) {
  return (
    <span className="flSeatName">
      <strong>{customer?.name ?? fallback}</strong>
      {customer?.guest && <em className="flGuestTag">guest</em>}
      {children}
    </span>
  );
}

// Never disabled: the iPad shows no titles, so a blocked Pay still opens the
// pay dialog, which shows the reason and holds back Confirm.
function PayButton({ state, customerId, name, now, onPay }: { state: AppState; customerId: string; name: string; now: number; onPay: (customerId: string) => void }) {
  const reason = payBlockedReason(state, customerId, now);
  return (
    <button type="button" className="flPay" title={reason ?? `Pay ${name}'s tab`} onClick={() => onPay(customerId)}>
      Pay
    </button>
  );
}

function SeatRow({
  state,
  session,
  seat,
  customer,
  now,
  inFrame,
  frameNo,
  confirming,
  showBlock,
  onArm,
  onBlocked,
  onLeave,
  onPay,
  onEditCustomer
}: {
  state: AppState;
  session: Session;
  seat: Seat;
  customer?: Customer;
  now: number;
  inFrame: boolean;
  frameNo: number;
  confirming: boolean;
  showBlock: boolean;
  onArm: (seatId: string) => void;
  onBlocked: (seatId: string) => void;
  onLeave: (seatId: string) => void;
  onPay: (customerId: string) => void;
  onEditCustomer: (customerId: string) => void;
}) {
  const name = customer?.name ?? "Unknown player";
  const tab = tabTotal(state.charges, seat.customerId);
  const leaveBlock = leaveError(session, seat.id);
  // The last player out between frames leaves the table order with nobody to
  // charge. (While a frame waits, the order still goes to its loser.)
  const lastOut = seatedNow(session).every((entry) => entry.id === seat.id);
  const orderTotal = isFrameBilled(session) && lastOut && !awaitingFrame(session) ? tableTabTotal(session) : 0;
  const arm = leaveArmText(customer, tab, orderTotal);
  // A blocked ✕ still takes the tap (the iPad shows no titles): it shows why
  // in the meta line for 3 s and does not arm.
  const blockText = showBlock ? leaveBlock : undefined;
  return (
    <li className={`flSeat${confirming ? " is-arming" : ""}`}>
      <span className="flBadge" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="flSeatHead">
        <SeatName customer={customer} fallback={name}>
          {inFrame && <span className="flInFrame" role="img" aria-label={`Playing frame ${frameNo}`} title={`Playing frame ${frameNo}`} />}
        </SeatName>
        <span className="flSeatTab">{tab > 0 ? formatMoney(tab) : ""}</span>
      </span>
      <span className={`flSeatMeta${blockText ? " is-warn" : confirming ? (arm.danger ? " is-danger" : " is-warn") : ""}`} aria-live="polite">
        {blockText ? (
          blockText
        ) : confirming ? (
          <>
            {arm.danger && <AlertTriangle size={12} aria-hidden="true" />}
            {arm.text}
          </>
        ) : (
          maskedPhone(customer?.phone)
        )}
      </span>
      <span className="flSeatActions">
        {tab > 0 && <PayButton state={state} customerId={seat.customerId} name={name} now={now} onPay={onPay} />}
        <button
          type="button"
          className="flIconBtn"
          aria-label={`Edit ${name}`}
          title="Edit name and phone"
          onClick={() => onEditCustomer(seat.customerId)}
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          className={`flIconBtn flLeave${confirming ? " confirming" : ""}`}
          aria-disabled={leaveBlock ? true : undefined}
          aria-label={confirming ? `${name}: ${arm.text}` : `${name}: leave table`}
          title={leaveBlock ?? "Leave table"}
          onClick={() => (leaveBlock ? onBlocked(seat.id) : confirming ? onLeave(seat.id) : onArm(seat.id))}
        >
          <X size={14} />
        </button>
      </span>
    </li>
  );
}

// A player who left this sitting: dimmed, with their tab, Pay, ✎ and Rejoin
// (no ✕). Rejoin sits where the ✕ sits on a seated row. It shows only when
// seatCustomer would seat them: a hidden button says more than a disabled one
// on the iPad, and the meta line (or the add field) gives the reason.
function LeftRow({
  state,
  table,
  seat,
  customer,
  now,
  frameNo,
  onPay,
  onEditCustomer,
  onRejoin
}: {
  state: AppState;
  table: TableConfig;
  seat: Seat;
  customer?: Customer;
  now: number;
  frameNo: number;
  onPay: (customerId: string) => void;
  onEditCustomer: (customerId: string) => void;
  onRejoin: (customerId: string) => void;
}) {
  const name = customer?.name ?? "Unknown player";
  const tab = tabTotal(state.charges, seat.customerId);
  const where = seatOf(state.sessions, seat.customerId);
  const from = movableFrom(state, seat.customerId);
  const canRejoin = Boolean(customer) && !seatError(state, table, seat.customerId);
  const whereName = where ? tableNameOf(state, where.session.tableId) : "";
  let meta = `Left ${clockTime(seat.leftAt ?? now)}`;
  if (where) meta = from ? `At ${whereName}` : `Playing at ${whereName}`;
  const rejoinTitle = from ? `Rejoin — moves from ${whereName}` : frameNo > 0 ? `Rejoin — joins frame ${frameNo} now` : "Rejoin table";
  return (
    <li className="flSeat is-left">
      <span className="flBadge" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="flSeatHead">
        <SeatName customer={customer} fallback={name} />
        <span className="flSeatTab">{tab > 0 ? formatMoney(tab) : ""}</span>
      </span>
      <span className="flSeatMeta">{meta}</span>
      <span className="flSeatActions">
        {tab > 0 && <PayButton state={state} customerId={seat.customerId} name={name} now={now} onPay={onPay} />}
        <button
          type="button"
          className="flIconBtn"
          aria-label={`Edit ${name}`}
          title="Edit name and phone"
          onClick={() => onEditCustomer(seat.customerId)}
        >
          <Pencil size={13} />
        </button>
        {canRejoin && (
          <button type="button" className="flRejoin" aria-label={`${name}: rejoin table`} title={rejoinTitle} onClick={() => onRejoin(seat.customerId)}>
            Rejoin
          </button>
        )}
      </span>
    </li>
  );
}

// ====== Rate footer ======

function RateFooter({ table, session, now }: { table: TableConfig; session?: Session; now: number }) {
  if (session && !isFrameBilled(session)) {
    return (
      <footer className="flRateFoot">
        <span className="flRateRule">
          Whole-table clock
          <em>{formatMoney(session.ratePerHour)}/hr flat — players don't change the rate</em>
        </span>
        <strong>
          {formatRatePerMinute(session.ratePerHour)}
          <small>/min</small>
        </strong>
      </footer>
    );
  }
  // Before the first player the sitting does not exist yet: show the table's
  // own rate and the extra-player rule a new sitting will snapshot.
  const base = session ? session.ratePerHour : table.ratePerHour;
  const extra = session ? Math.max(0, session.extraPlayerRatePerHour ?? 0) : table.game === "snooker" ? EXTRA_PLAYER_RATE_PER_HOUR : 0;
  // During a frame, everyone in the frame so far (a player who left still counts).
  const headcount = session ? liveHeadcount(session, now) : 0;
  const rate = session ? ratePerHourFor(session, headcount) : base;
  const over = Math.max(0, headcount - BASE_PLAYERS);
  let rule: string;
  if (extra === 0) rule = `${formatMoney(base)}/hr flat`;
  else if (over > 0) rule = `${formatMoney(base)}/hr for ${BASE_PLAYERS} + ${formatMoney(extra)} × ${over}`;
  else rule = `${formatMoney(base)}/hr for ${BASE_PLAYERS} · +${formatMoney(extra)} each extra`;
  return (
    <footer className="flRateFoot">
      <span className="flRateRule">
        Rate
        <em>{rule}</em>
      </span>
      <strong>
        {formatRatePerMinute(rate)}
        <small>/min</small>
      </strong>
    </footer>
  );
}

// ====== Panel ======

// Who is at the selected table: seat rows (tab, Pay, ✎, Leave table), players
// who left this sitting (Rejoin), the add field pinned at the bottom, and the
// live rate.
export function PlayersPanel({ state, table, session, now, onSeatCustomer, onSeatNew, onSeatGuest, onLeave, onPay, onEditCustomer }: PlayersPanelProps) {
  // The last ✕ tap: it armed that seat's leave, or (blocked) shows why. Both
  // reset after 3 s.
  const [leaveTap, setLeaveTap] = React.useState<{ seatId: string; blocked: boolean } | null>(null);
  React.useEffect(() => {
    if (!leaveTap) return;
    const timer = window.setTimeout(() => setLeaveTap(null), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [leaveTap]);

  if (table.id === COUNTER_ID) {
    return (
      <section className="playersPanel flPlayers" aria-label="Players">
        <header className="flPlHead">
          <div>
            <p className="eyebrow">Cafe · Takeaway</p>
            <h2>Players</h2>
          </div>
        </header>
        <p className="flCounterNote">Takeaway orders have no players — put the order on a tab from the bill if needed.</p>
      </section>
    );
  }

  const customersById = new Map(state.customers.map((customer) => [customer.id, customer]));
  const seated = session ? seatedNow(session) : [];
  const frame = session ? runningFrame(session) : undefined;
  const frameNo = frame && session ? (session.frames ?? []).indexOf(frame) + 1 : 0;
  const inFrame = new Set(frame && session ? presentSeats(session, now).map((seat) => seat.id) : []);

  // One row per customer who left and is not back at this table, latest first.
  const left = session ? leftSeats(session) : [];
  const wholeTable = Boolean(session && !isFrameBilled(session));

  return (
    <section className="playersPanel flPlayers" aria-label={`Players at ${table.name}`}>
      <header className="flPlHead">
        <div>
          <p className="eyebrow">{table.name}</p>
          <h2>Players</h2>
        </div>
        <span className="flPlCount">{seated.length === 0 ? "Nobody seated" : `${seated.length} at the table`}</span>
      </header>

      <div className="flPlList">
        {seated.length === 0 && left.length === 0 && (
          <div className="flPlEmpty">
            <p>{wholeTable ? "Players are optional on a whole-table bill." : "No players yet."}</p>
            <span>
              {wholeTable
                ? session?.endedAt
                  ? "Put on tab (in the bill) can use anyone in the registry, or a new customer."
                  : "Add them to put the bill on a player's tab later."
                : "Type a name or phone, then press Enter — or tap Guest."}
            </span>
          </div>
        )}
        {seated.length > 0 && session && (
          <ul className="flSeats">
            {seated.map((seat) => (
              <SeatRow
                key={seat.id}
                state={state}
                session={session}
                seat={seat}
                customer={customersById.get(seat.customerId)}
                now={now}
                inFrame={inFrame.has(seat.id)}
                frameNo={frameNo}
                confirming={leaveTap?.seatId === seat.id && !leaveTap.blocked}
                showBlock={leaveTap?.seatId === seat.id && leaveTap.blocked}
                onArm={(seatId) => setLeaveTap({ seatId, blocked: false })}
                onBlocked={(seatId) => setLeaveTap({ seatId, blocked: true })}
                onLeave={(seatId) => {
                  setLeaveTap(null);
                  onLeave(seatId);
                }}
                onPay={onPay}
                onEditCustomer={onEditCustomer}
              />
            ))}
          </ul>
        )}
        {left.length > 0 && (
          <>
            <p className="flSubhead">Left the table</p>
            <ul className="flSeats">
              {left.map((seat) => (
                <LeftRow
                  key={seat.id}
                  state={state}
                  table={table}
                  seat={seat}
                  customer={customersById.get(seat.customerId)}
                  now={now}
                  frameNo={frameNo}
                  onPay={onPay}
                  onEditCustomer={onEditCustomer}
                  onRejoin={onSeatCustomer}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      <AddPlayerField
        state={state}
        table={table}
        session={session}
        onSeatCustomer={onSeatCustomer}
        onSeatNew={onSeatNew}
        onSeatGuest={onSeatGuest}
      />
      <RateFooter table={table} session={session} now={now} />
    </section>
  );
}
