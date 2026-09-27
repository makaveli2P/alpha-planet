import React from "react";
import { Printer, X } from "lucide-react";
import type { AppState, Charge, ChargeItem, Customer, Payment, PaymentMode, Session, TableConfig } from "../types";
import { calculateSessionTotals } from "../lib/billing";
import { billNumber, businessDayName, businessDayStart, formatDuration, formatMoney } from "../lib/format";

// The receipt content itself — reused by the dashboard modal and by the bill
// panel's pre-payment preview. Handles every bill shape: table session (with or
// without kitchen items, discount, round-off) and a kitchen/takeaway order.
export function ReceiptBody({
  session,
  tables,
  sessions,
  charges,
  customers,
  now,
  mode,
  paidLabel = "Paid",
  hideMoney = false
}: {
  session: Session;
  tables: TableConfig[];
  sessions: Session[];
  charges?: Charge[];
  customers?: Customer[];
  now: number;
  mode?: PaymentMode;
  paidLabel?: string;
  hideMoney?: boolean;
}) {
  const table = tables.find((entry) => entry.id === session.tableId);
  const isKitchen = session.tableId === "counter";
  const name = table?.name ?? (isKitchen ? "Cafe" : session.tableId);
  const totals = calculateSessionTotals(session, now);
  const effectiveDiscount = totals.subtotal - totals.afterDiscount; // = min(discount, subtotal)
  const payMode = mode ?? session.paymentMode;
  // Honor the counter's "hide amounts" privacy toggle here too, so drilling into
  // a bill from the dashboard while amounts are hidden doesn't reveal them.
  const money = (value: number) => (hideMoney ? "₹ •••" : formatMoney(value));

  const started = new Date(session.startedAt);
  const ended = new Date(session.endedAt ?? session.settledAt ?? session.startedAt);
  const settled = new Date(session.settledAt ?? session.endedAt ?? session.startedAt);
  const clock = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = settled.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
  const billNo = billNumber(session, sessions, now);
  const tabCharge = session.tabChargeId ? charges?.find((charge) => charge.id === session.tabChargeId) : undefined;
  const tabCustomer = tabCharge ? customers?.find((customer) => customer.id === tabCharge.customerId) : undefined;
  // A manual bill was entered after the play, maybe on a later business day.
  const playedOn =
    session.manual && businessDayStart(session.startedAt) !== businessDayStart(settled.getTime())
      ? ` · played ${businessDayName(session.startedAt, settled.getTime())}`
      : "";

  return (
    <>
      <div className="receiptHead">
        <span className="receiptCue" aria-hidden="true" />
        <strong>The Alpha Planet</strong>
        <span>Snooker · Pool · Cafe</span>
      </div>

      <div className="receiptRule" />

      <div className="receiptMeta">
        <div><span>Bill no.</span><span>{billNo}</span></div>
        <div><span>Date</span><span>{dateStr}</span></div>
        <div><span>{isKitchen ? "Order" : "Table"}</span><span>{name}{session.customerName ? ` · ${session.customerName}` : ""}</span></div>
        {session.manual && <div><span>Entry</span><span>Manual{playedOn}</span></div>}
        {isKitchen ? (
          <div><span>Type</span><span>Takeaway</span></div>
        ) : (
          <>
            <div><span>In / Out</span><span>{clock(started)} – {clock(ended)}</span></div>
            <div><span>Duration</span><span>{formatDuration(totals.minutes)}</span></div>
          </>
        )}
      </div>

      <div className="receiptRule dashed" />

      <div className="receiptLines">
        {!isKitchen && totals.tableCharge > 0 && (
          <div className="receiptLine">
            <span>Table time<em>{formatDuration(totals.minutes)} @ {money(session.ratePerHour)}/hr</em></span>
            <span>{money(totals.tableCharge)}</span>
          </div>
        )}
        {session.orders.map((line) => (
          <div className="receiptLine" key={line.lineId}>
            <span>
              {line.name}
              <em>{line.variant !== "Regular" ? `${line.variant} · ` : ""}{line.quantity} × {money(line.unitPrice)}</em>
            </span>
            <span>{money(line.unitPrice * line.quantity)}</span>
          </div>
        ))}
        {session.orders.length === 0 && !isKitchen && totals.tableCharge === 0 && (
          <div className="receiptLine"><span>No charges</span><span>{money(0)}</span></div>
        )}
      </div>

      <div className="receiptRule dashed" />

      <div className="receiptTotals">
        <div><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
        {effectiveDiscount > 0 && (
          <div><span>Discount</span><span>− {money(effectiveDiscount)}</span></div>
        )}
        {session.roundOffEnabled && totals.roundOff !== 0 && (
          <div>
            <span>Round off</span>
            <span>{totals.roundOff > 0 ? "+ " : "− "}{money(Math.abs(totals.roundOff))}</span>
          </div>
        )}
      </div>

      <div className="receiptRule" />

      <div className="receiptGrand">
        <span>Total</span>
        <span>{money(totals.total)}</span>
      </div>
      <div className="receiptPaid">
        <span>
          {tabCharge
            ? `On tab · ${tabCustomer?.name ?? "a customer"}`
            : `${paidLabel} · ${session.splitMode === "per-player" && !payMode ? "Split" : payMode ?? "—"}`}
        </span>
        <span>{money(totals.total)}</span>
      </div>

      <div className="receiptRule dashed" />

      <div className="receiptThanks">
        <strong>Thank you!</strong>
        <span>Please visit again.</span>
      </div>
    </>
  );
}

// ====== Tab helpers (shared by the pay dialog, the customers page and the tab receipt) ======

// "Today", "Yesterday", or "Sat 20 Sep" (business days).
export function dayLabel(ts: number, now: number): string {
  const today = businessDayStart(now);
  const day = businessDayStart(ts);
  if (day === today) return "Today";
  if (day === businessDayStart(today - 1)) return "Yesterday";
  return businessDayName(ts, now);
}

// "98765 43210" for a 10-digit phone; other lengths stay as digits.
export function formatPhone(phone?: string): string {
  if (!phone) return "";
  return phone.length === 10 ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone;
}

// "••••3210", or "no phone".
export function maskedPhone(phone?: string): string {
  return phone ? `••••${phone.slice(-4)}` : "no phone";
}

// What a tab line is: "Snooker 1 · Frame 3 · lost", "Snooker 1 · Manual frame
// · lost", "Cafe · Snooker 1", "Whole bill · Pool 2", "Takeaway order", "Carried
// over". A manual bill's charge says so.
export function chargeTitle(charge: Charge, lostTag = true): string {
  const lost = lostTag ? " · lost" : "";
  const manual = charge.manual ? " · manual" : "";
  switch (charge.kind) {
    case "frame":
      // A manual frame is one frame on its own entry: its number says nothing.
      return charge.manual ? `${charge.tableName} · Manual frame${lost}` : `${charge.tableName} · Frame ${charge.frameNo ?? "?"}${lost}`;
    case "cafe":
      return charge.tableId && charge.tableId !== "counter" ? `Cafe · ${charge.tableName}` : "Cafe";
    case "bill":
      return charge.tableId === "counter" ? `Takeaway order${manual}` : `Whole bill · ${charge.tableName}${manual}`;
    default:
      return "Carried over";
  }
}

// The table-time line of a frame or a whole bill: "42m · 3 players · table ₹280".
export function chargeTimeLine(charge: Charge, money: (value: number) => string): string | undefined {
  if (charge.kind === "frame") {
    const players = charge.players != null ? ` · ${charge.players} player${charge.players === 1 ? "" : "s"}` : "";
    return `${formatDuration(charge.minutes ?? 0)}${players} · table ${money(charge.tableCharge)}`;
  }
  if (charge.kind === "bill" && charge.tableCharge > 0) {
    return `${charge.minutes != null ? `${formatDuration(charge.minutes)} · ` : ""}table ${money(charge.tableCharge)}`;
  }
  return undefined;
}

// "Masala Chai × 2", with the variant when it is not "Regular".
export function itemLabel(item: ChargeItem): string {
  return `${item.name}${item.variant && item.variant !== "Regular" ? ` (${item.variant})` : ""} × ${item.quantity}`;
}

// Receipt number of a tab payment: business date + "T" + its place among that
// day's tab payments, e.g. 20260927-T002.
export function paymentNumber(payment: Payment, payments: Payment[]): string {
  const start = businessDayStart(payment.at);
  const sameDay = payments
    .filter((entry) => entry.at >= start && entry.at < start + 86400000)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const seq = sameDay.findIndex((entry) => entry.id === payment.id) + 1 || sameDay.length + 1;
  const day = new Date(start);
  const yyyy = day.getFullYear();
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  const dd = String(day.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-T${String(seq).padStart(3, "0")}`;
}

// A tab payment's receipt: the customer, the charges it paid (grouped by day:
// table · frame, table time, cafe items), discount, received, and anything
// carried over. Rendered from state by payment id.
export function TabReceiptBody({ state, paymentId, hideMoney = false }: { state: AppState; paymentId: string; hideMoney?: boolean }) {
  const payment = state.payments.find((entry) => entry.id === paymentId);
  const money = (value: number) => (hideMoney ? "₹ •••" : formatMoney(value));
  if (!payment) return <p className="muted">This payment is not on record (it was undone).</p>;

  const customer = state.customers.find((entry) => entry.id === payment.customerId);
  const byId = new Map(state.charges.map((charge) => [charge.id, charge]));
  const paid = payment.chargeIds
    .map((id) => byId.get(id))
    .filter((charge): charge is Charge => Boolean(charge))
    .sort((a, b) => a.createdAt - b.createdAt);
  const days: { start: number; charges: Charge[] }[] = [];
  for (const charge of paid) {
    const start = businessDayStart(charge.createdAt);
    const last = days[days.length - 1];
    if (last && last.start === start) last.charges.push(charge);
    else days.push({ start, charges: [charge] });
  }
  const chargesTotal = paid.reduce((sum, charge) => sum + charge.total, 0);
  const discount = payment.discount ?? 0;
  // What stayed on the tab: worked out from the amounts, so the receipt still
  // reads right if the carry charge was later paid or voided.
  const carried = Math.max(0, chargesTotal - discount - payment.amount);
  const at = new Date(payment.at);
  const dateStr = at.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const fromPayment = (charge: Charge) => state.payments.find((entry) => entry.id === charge.fromPaymentId);

  return (
    <>
      <div className="receiptHead">
        <span className="receiptCue" aria-hidden="true" />
        <strong>The Alpha Planet</strong>
        <span>Snooker · Pool · Cafe</span>
      </div>

      <div className="receiptRule" />

      <div className="receiptMeta">
        <div><span>Receipt no.</span><span>{paymentNumber(payment, state.payments)}</span></div>
        <div><span>Date</span><span>{dateStr} · {timeStr}</span></div>
        <div><span>Type</span><span>Tab payment</span></div>
        <div><span>Customer</span><span>{customer?.name ?? "—"}</span></div>
        {customer?.phone && <div><span>Phone</span><span>{formatPhone(customer.phone)}</span></div>}
      </div>

      <div className="receiptRule dashed" />

      <div className="receiptLines">
        {days.map((day) => (
          <React.Fragment key={day.start}>
            <div className="cxReceiptDay">{businessDayName(day.start, payment.at)}</div>
            {day.charges.map((charge) => {
              const timeLine = chargeTimeLine(charge, money);
              const from = charge.kind === "carry" ? fromPayment(charge) : undefined;
              return (
                <div className="receiptLine" key={charge.id}>
                  <span>
                    {chargeTitle(charge, false)}
                    {timeLine && <em>{timeLine}</em>}
                    {charge.items.map((item, index) => (
                      <em key={index}>{itemLabel(item)} · {money(item.unitPrice * item.quantity)}</em>
                    ))}
                    {charge.kind === "bill" && charge.adjust ? (
                      <em>Discount / round off {charge.adjust < 0 ? "−" : "+"} {money(Math.abs(charge.adjust))}</em>
                    ) : null}
                    {charge.kind === "carry" && <em>Left from a part payment{from ? ` on ${businessDayName(from.at, payment.at)}` : ""}</em>}
                  </span>
                  <span>{money(charge.total)}</span>
                </div>
              );
            })}
          </React.Fragment>
        ))}
        {paid.length === 0 && <div className="receiptLine"><span>No charges on record</span><span>{money(0)}</span></div>}
      </div>

      <div className="receiptRule dashed" />

      <div className="receiptTotals">
        <div><span>Charges</span><span>{money(chargesTotal)}</span></div>
        {discount > 0 && <div><span>Discount</span><span>− {money(discount)}</span></div>}
        {carried > 0 && <div><span>Left on tab</span><span>− {money(carried)}</span></div>}
      </div>

      <div className="receiptRule" />

      <div className="receiptGrand">
        <span>Received</span>
        <span>{money(payment.amount)}</span>
      </div>
      <div className="receiptPaid">
        <span>Paid · {payment.mode}</span>
        <span>{money(payment.amount)}</span>
      </div>

      <div className="receiptRule dashed" />

      <div className="receiptThanks">
        <strong>Thank you!</strong>
        <span>Please visit again.</span>
      </div>
    </>
  );
}

// The receipt overlay: a settled whole bill (`session`) or a tab payment (`paymentId`).
export function Receipt({
  state,
  now,
  onClose,
  hideMoney = false,
  session,
  paymentId
}: {
  state: AppState;
  now: number;
  onClose: () => void;
  hideMoney?: boolean;
  session?: Session;
  paymentId?: string;
}) {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="receiptOverlay" role="dialog" aria-modal="true" aria-label="Receipt" onClick={onClose}>
      <div className="receiptPaper" onClick={(event) => event.stopPropagation()}>
        <button className="receiptClose" onClick={onClose} aria-label="Close receipt">
          <X size={16} />
        </button>
        {session ? (
          <ReceiptBody
            session={session}
            tables={state.tables}
            sessions={state.sessions}
            charges={state.charges}
            customers={state.customers}
            now={now}
            hideMoney={hideMoney}
          />
        ) : paymentId ? (
          <TabReceiptBody state={state} paymentId={paymentId} hideMoney={hideMoney} />
        ) : null}
        <button className="receiptPrint" onClick={() => window.print()}>
          <Printer size={15} /> Print
        </button>
      </div>
    </div>
  );
}
