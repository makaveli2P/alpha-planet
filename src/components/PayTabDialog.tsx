import React from "react";
import { ArrowRightLeft, CircleCheck, Printer, ReceiptText, Undo2, X } from "lucide-react";
import { payBlockedReason } from "../lib/appActions";
import { openCharges, tabTotal } from "../lib/billing";
import { searchCustomers } from "../lib/customers";
import { businessDayStart, formatMoney } from "../lib/format";
import type { AppState, Charge, Customer, Payment, PaymentMode } from "../types";
import { TENDERS, type PayActions } from "./contracts";
import { Receipt, chargeTimeLine, chargeTitle, dayLabel, formatPhone, itemLabel, maskedPhone } from "./Receipt";

export type PayTabDialogProps = PayActions & {
  state: AppState;
  customerId: string;
  now: number;
  onClose: () => void;
};

const CONFIRM_MS = 3000;
const PAST_SHOWN = 6;

// Tap-twice confirm keyed by id: the first tap arms it, a second tap within
// 3 s acts, and it disarms by itself.
function useArmed(): [string | null, (id: string | null) => void] {
  const [armed, setArmed] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return [armed, setArmed];
}

type Snapshot = { customerId: string; ids: string[]; totals: Record<string, number> };

// The customer's open charges right now, oldest first, with their amounts.
function takeSnapshot(state: AppState, customerId: string): Snapshot {
  const open = openCharges(state.charges, customerId).sort((a, b) => a.createdAt - b.createdAt);
  return { customerId, ids: open.map((charge) => charge.id), totals: Object.fromEntries(open.map((charge) => [charge.id, charge.total])) };
}

function toAmount(text: string): number {
  const value = Math.floor(Number(text));
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

type Row = { charge: Charge; gone?: string }; // gone = paid, voided or moved since the dialog opened

export function PayTabDialog({ state, customerId, now, onClose, onPayTab, onVoidCharge, onMoveCharge, onUndoPayment }: PayTabDialogProps) {
  // The charges staff see are fixed when the dialog opens: a charge added
  // later is not paid by mistake. "Reload list" takes a fresh snapshot.
  const [snapshot, setSnapshot] = React.useState<Snapshot>(() => takeSnapshot(state, customerId));
  const [unchecked, setUnchecked] = React.useState<Set<string>>(() => new Set());
  const [discountText, setDiscountText] = React.useState("");
  const [receivedText, setReceivedText] = React.useState<string | null>(null); // null = the full amount due
  const [mode, setMode] = React.useState<PaymentMode | null>(null);
  const [done, setDone] = React.useState<{ paymentId: string } | null>(null);
  const [receiptFor, setReceiptFor] = React.useState<string | null>(null);
  const [moving, setMoving] = React.useState<string | null>(null);
  const [moveQuery, setMoveQuery] = React.useState("");
  const [showAllPast, setShowAllPast] = React.useState(false);
  const [armedVoid, setArmedVoid] = useArmed();
  const [armedUndo, setArmedUndo] = useArmed();

  const [reloadAfterUpdate, setReloadAfterUpdate] = React.useState(false);
  React.useEffect(() => {
    if (!reloadAfterUpdate) return;
    setSnapshot(takeSnapshot(state, customerId));
    setReloadAfterUpdate(false);
  }, [state, reloadAfterUpdate, customerId]);

  function reload(id = customerId) {
    setSnapshot(takeSnapshot(state, id));
    setUnchecked(new Set());
    setDiscountText("");
    setReceivedText(null);
    setMode(null);
    setDone(null);
    setMoving(null);
  }

  // A different customer in the same mounted dialog starts over.
  if (snapshot.customerId !== customerId) reload();

  // Escape closes the move search first, then the dialog. The receipt overlay
  // handles its own Escape while it is open.
  const escapeRef = React.useRef({ receiptFor, moving, onClose });
  escapeRef.current = { receiptFor, moving, onClose };
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const current = escapeRef.current;
      if (current.receiptFor) return;
      if (current.moving) setMoving(null);
      else current.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (receiptFor) {
    return <Receipt state={state} now={now} paymentId={receiptFor} onClose={() => setReceiptFor(null)} />;
  }

  const customer = state.customers.find((entry) => entry.id === customerId);
  if (!customer) {
    return (
      <div className="receiptOverlay" role="dialog" aria-modal="true" aria-label="Pay tab">
        <div className="receiptPaper cxPaper cxEditPaper">
          <button className="receiptClose" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
          <h2 className="cxDialogTitle">Customer not found</h2>
          <p className="cxHint">This record was merged or removed.</p>
          <div className="cxDialogActions">
            <button className="ghostAction" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  const nameOf = (id: string) => state.customers.find((entry) => entry.id === id)?.name ?? "someone else";
  const byId = new Map(state.charges.map((charge) => [charge.id, charge]));
  const rows: Row[] = [];
  for (const id of snapshot.ids) {
    const charge = byId.get(id);
    if (!charge) continue; // removed (a carry charge whose payment was undone)
    let gone: string | undefined;
    if (charge.voidedAt) gone = "Voided";
    else if (charge.paymentId) gone = "Paid";
    else if (charge.customerId !== customerId) gone = `Moved to ${nameOf(charge.customerId)}`;
    rows.push({ charge, gone });
  }
  const days: { start: number; rows: Row[] }[] = [];
  for (const row of rows) {
    const start = businessDayStart(row.charge.createdAt);
    const last = days[days.length - 1];
    if (last && last.start === start) last.rows.push(row);
    else days.push({ start, rows: [row] });
  }

  const selectable = rows.filter((row) => !row.gone);
  const selected = selectable.filter((row) => !unchecked.has(row.charge.id));
  const selectedTotal = selected.reduce((sum, row) => sum + row.charge.total, 0);
  const discount = Math.min(selectedTotal, toAmount(discountText));
  const due = selectedTotal - discount;
  const received = receivedText == null ? due : toAmount(receivedText);
  const kept = Math.min(received, due);
  const carry = due - kept;
  const change = Math.max(0, received - due);
  const blocked = payBlockedReason(state, customerId, now);
  const whyNot =
    selected.length === 0
      ? "Tick at least one charge."
      : kept + discount <= 0
        ? "Enter the amount received."
        : blocked ?? (mode ? undefined : "Pick Cash, UPI or Card.");

  const inSnapshot = new Set(snapshot.ids);
  const added = openCharges(state.charges, customerId).filter((charge) => !inSnapshot.has(charge.id));
  const addedTotal = added.reduce((sum, charge) => sum + charge.total, 0);
  const openTab = tabTotal(state.charges, customerId);
  const payment = done ? state.payments.find((entry) => entry.id === done.paymentId) : undefined;
  const past = state.payments.filter((entry) => entry.customerId === customerId).sort((a, b) => b.at - a.at);
  const pastShown = showAllPast ? past : past.slice(0, PAST_SHOWN);

  function toggle(ids: string[], on: boolean) {
    setUnchecked((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function confirm() {
    if (whyNot || !mode) return;
    const paymentId = onPayTab(
      customerId,
      selected.map((row) => row.charge.id),
      { mode, discount, received: kept }
    );
    setDone({ paymentId });
    setMoving(null);
  }

  // Quick picks for Move to…: the other players of the charge's sitting.
  function tableMates(charge: Charge): Customer[] {
    const session = charge.sessionId ? state.sessions.find((entry) => entry.id === charge.sessionId) : undefined;
    const ids = new Set((session?.seats ?? []).map((seat) => seat.customerId).filter((id) => id !== customerId));
    return state.customers.filter((entry) => ids.has(entry.id));
  }

  const allOn = selectable.length > 0 && selected.length === selectable.length;

  return (
    <div className="receiptOverlay" role="dialog" aria-modal="true" aria-label={`Pay tab · ${customer.name}`}>
      <div className="receiptPaper cxPaper cxPay">
        <header className="cxPayHead">
          <div className="cxPayWho">
            <p className="eyebrow">Pay tab</p>
            <h2 className="cxDialogTitle">
              {customer.name}
              {customer.guest && <span className="cxGuestTag">guest</span>}
            </h2>
            <span className={customer.phone ? "" : "cxFaint"}>{customer.phone ? formatPhone(customer.phone) : "No phone"}</span>
          </div>
          <div className="cxPayOpen">
            <span>Open tab</span>
            <strong>{formatMoney(openTab)}</strong>
          </div>
          <button className="receiptClose" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="cxPayScroll">
          {done ? (
            payment ? (
              <div className="settleConfirm cxPayDone" role="status">
                <CircleCheck size={30} />
                <h3>Payment recorded</h3>
                <div className="settleConfirmTotal">{formatMoney(payment.amount)}</div>
                <p className="settleConfirmWho">
                  {customer.name} · {payment.mode}
                  {payment.discount > 0 ? ` · ${formatMoney(payment.discount)} discount` : ""}
                </p>
                {payment.carryChargeId && (
                  <p className="settleConfirmWho">{formatMoney(Math.max(0, (byId.get(payment.carryChargeId)?.total ?? 0)))} stays on the tab</p>
                )}
                <div className="cxDoneActions">
                  <button className="ghostAction" onClick={() => setReceiptFor(payment.id)}>
                    <Printer size={16} /> Print receipt
                  </button>
                  <button className="primaryAction" onClick={onClose}>Done</button>
                </div>
              </div>
            ) : (
              <div className="cxEmpty">
                <strong>This payment is not on record.</strong>
                <span>It was undone, or its charges changed before it went through. Reload the list to see the tab again.</span>
                <button className="rowGhostBtn" onClick={() => reload()}>Reload list</button>
              </div>
            )
          ) : rows.length === 0 ? (
            <div className="cxEmpty">
              <strong>Nothing on the tab.</strong>
              <span>{customer.name} owes nothing{past.length > 0 ? ". Past payments are below." : "."}</span>
            </div>
          ) : (
            <>
              <div className="cxListHead">
                <label className="cxCheck">
                  <input
                    type="checkbox"
                    checked={allOn}
                    disabled={selectable.length === 0}
                    onChange={() => toggle(selectable.map((row) => row.charge.id), !allOn)}
                  />
                  <span>{allOn ? "All charges" : `${selected.length} of ${selectable.length} charges`}</span>
                </label>
                {added.length > 0 && (
                  <span className="cxNote">
                    {formatMoney(addedTotal)} more went on the tab after this opened.{" "}
                    <button className="cxLink" onClick={() => reload()}>Reload list</button>
                  </span>
                )}
              </div>

              {days.map((day) => {
                const open = day.rows.filter((row) => !row.gone);
                const dayOn = open.length > 0 && open.every((row) => !unchecked.has(row.charge.id));
                const dayTotal = open.reduce((sum, row) => sum + row.charge.total, 0);
                return (
                  <section className="cxDay" key={day.start}>
                    <div className="cxDayHead">
                      <label className="cxCheck">
                        <input
                          type="checkbox"
                          checked={dayOn}
                          disabled={open.length === 0}
                          onChange={() => toggle(open.map((row) => row.charge.id), !dayOn)}
                        />
                        <span>{dayLabel(day.start, now)}</span>
                      </label>
                      {open.length > 0 && <span>{formatMoney(dayTotal)}</span>}
                    </div>
                    {day.rows.map((row) => {
                      const { charge } = row;
                      const on = !row.gone && !unchecked.has(charge.id);
                      const timeLine = chargeTimeLine(charge, formatMoney);
                      const isMoving = moving === charge.id;
                      const mates = isMoving && !moveQuery.trim() ? tableMates(charge) : [];
                      const found = isMoving && moveQuery.trim()
                        ? searchCustomers(state.customers.filter((entry) => entry.id !== customerId), moveQuery, 6)
                        : [];
                      const picks = moveQuery.trim() ? found : mates;
                      const from = charge.fromPaymentId ? state.payments.find((entry) => entry.id === charge.fromPaymentId) : undefined;
                      return (
                        <div className={`cxCharge${row.gone ? " gone" : ""}${on ? " on" : ""}`} key={charge.id}>
                          <label className="cxChargeMain">
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={Boolean(row.gone)}
                              onChange={() => toggle([charge.id], !on)}
                              aria-label={chargeTitle(charge)}
                            />
                            <span className="cxChargeBody">
                              <strong>{chargeTitle(charge)}</strong>
                              {timeLine && <span>{timeLine}</span>}
                              {charge.items.length > 0 && <span>{charge.items.map(itemLabel).join(", ")}</span>}
                              {charge.kind === "bill" && charge.adjust ? (
                                <span>Discount / round off {charge.adjust < 0 ? "−" : "+"} {formatMoney(Math.abs(charge.adjust))}</span>
                              ) : null}
                              {charge.kind === "carry" && (
                                <span>Left from a part payment{from ? ` · ${dayLabel(from.at, now)}` : ""}</span>
                              )}
                              {!row.gone && snapshot.totals[charge.id] != null && snapshot.totals[charge.id] !== charge.total && (
                                <span className="cxChanged">Changed since this opened: was {formatMoney(snapshot.totals[charge.id])}</span>
                              )}
                            </span>
                            <span className="cxChargeAmt">{formatMoney(charge.total)}</span>
                          </label>
                          {row.gone ? (
                            <span className="cxGoneTag">{row.gone}</span>
                          ) : isMoving ? (
                            <div className="cxMove">
                              <div className="cxMoveBar">
                                <input
                                  className="cxInput"
                                  autoFocus
                                  value={moveQuery}
                                  onChange={(event) => setMoveQuery(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                      event.preventDefault();
                                      setMoving(null);
                                    } else if (event.key === "Enter" && moveQuery.trim() && picks.length > 0) {
                                      onMoveCharge(charge.id, picks[0].id);
                                      setMoving(null);
                                    }
                                  }}
                                  placeholder="Move to… name or phone"
                                  aria-label="Move this charge to"
                                />
                                <button className="rowGhostBtn" onClick={() => setMoving(null)}>Cancel</button>
                              </div>
                              {!moveQuery.trim() && mates.length > 0 && <span className="cxHint">Players from this table</span>}
                              {picks.length > 0 && (
                                <div className="cxSuggest">
                                  {picks.map((entry) => (
                                    <button
                                      key={entry.id}
                                      onClick={() => {
                                        onMoveCharge(charge.id, entry.id);
                                        setMoving(null);
                                      }}
                                    >
                                      <strong>
                                        {entry.name}
                                        {entry.guest && <span className="cxGuestTag">guest</span>}
                                      </strong>
                                      <span>{maskedPhone(entry.phone)}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {moveQuery.trim() && found.length === 0 && <span className="cxHint">No one matches “{moveQuery.trim()}”.</span>}
                            </div>
                          ) : (
                            <div className="cxChargeActions">
                              <button
                                className="rowGhostBtn"
                                onClick={() => {
                                  setMoving(charge.id);
                                  setMoveQuery("");
                                }}
                              >
                                <ArrowRightLeft size={13} /> Move to…
                              </button>
                              {charge.kind !== "carry" && (
                                <button
                                  className={`rowGhostBtn cxVoid${armedVoid === charge.id ? " confirming" : ""}`}
                                  onClick={() => {
                                    if (armedVoid !== charge.id) {
                                      setArmedVoid(charge.id);
                                      return;
                                    }
                                    setArmedVoid(null);
                                    onVoidCharge(charge.id);
                                  }}
                                >
                                  {armedVoid === charge.id
                                    ? charge.kind === "bill"
                                      ? "Tap again to void bill"
                                      : "Tap again to void"
                                    : charge.kind === "bill"
                                      ? "Void bill (removes it from sales)"
                                      : "Void"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </>
          )}

          {past.length > 0 && (
            <section className="cxPast">
              <h3>Past payments</h3>
              {pastShown.map((entry: Payment) => {
                const carryCharge = entry.carryChargeId ? byId.get(entry.carryChargeId) : undefined;
                const undoBlocked = carryCharge?.paymentId ? "Its carried-over amount was paid later. Undo that payment first." : undefined;
                return (
                  <div className="cxPastRow" key={entry.id}>
                    <div>
                      <strong>
                        {dayLabel(entry.at, now)} · {new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </strong>
                      <span>
                        {entry.mode} · {entry.chargeIds.length} charge{entry.chargeIds.length === 1 ? "" : "s"}
                        {entry.discount > 0 ? ` · ${formatMoney(entry.discount)} off` : ""}
                        {carryCharge ? ` · ${formatMoney(carryCharge.total)} carried` : ""}
                      </span>
                    </div>
                    <span className="cxPastAmt">{formatMoney(entry.amount)}</span>
                    <button className="rowGhostBtn" onClick={() => setReceiptFor(entry.id)}>
                      <ReceiptText size={13} /> Receipt
                    </button>
                    <button
                      className={`rowGhostBtn cxVoid${armedUndo === entry.id ? " confirming" : ""}`}
                      disabled={Boolean(undoBlocked)}
                      title={undoBlocked}
                      onClick={() => {
                        if (armedUndo !== entry.id) {
                          setArmedUndo(entry.id);
                          return;
                        }
                        setArmedUndo(null);
                        onUndoPayment(entry.id);
                        // The charges are back on the tab: list them again once the update lands.
                        setReloadAfterUpdate(true);
                      }}
                    >
                      <Undo2 size={13} /> {armedUndo === entry.id ? "Tap again to undo" : "Undo payment"}
                    </button>
                  </div>
                );
              })}
              {past.length > PAST_SHOWN && (
                <button className="cxLink" onClick={() => setShowAllPast((value) => !value)}>
                  {showAllPast ? "Show fewer" : `Show all ${past.length} payments`}
                </button>
              )}
            </section>
          )}
        </div>

        {!done && rows.length > 0 && (
          <footer className="cxPayFoot">
            <div className="cxSums">
              <div className="cxSum">
                <span>Selected</span>
                <strong>{formatMoney(selectedTotal)}</strong>
              </div>
              <label className="cxSum cxSumInput">
                <span>Discount ₹</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={discountText}
                  onChange={(event) => setDiscountText(event.target.value)}
                  onFocus={(event) => event.target.select()}
                  placeholder="0"
                />
              </label>
              <label className="cxSum cxSumInput">
                <span>Received ₹</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={receivedText ?? String(due)}
                  onChange={(event) => setReceivedText(event.target.value)}
                  onFocus={(event) => event.target.select()}
                />
              </label>
            </div>
            {(carry > 0 || change > 0 || receivedText != null) && (
              <p className="cxPayNote">
                {carry > 0 && <span className="cxCarry">{formatMoney(carry)} stays on the tab</span>}
                {change > 0 && <span>Give back {formatMoney(change)} change</span>}
                {receivedText != null && received !== due && (
                  <button className="cxLink" onClick={() => setReceivedText(null)}>Take the full {formatMoney(due)}</button>
                )}
              </p>
            )}
            <div className="cxTender" role="radiogroup" aria-label="Payment mode">
              {TENDERS.map((entry) => (
                <button
                  key={entry}
                  role="radio"
                  aria-checked={mode === entry}
                  className={mode === entry ? "active" : ""}
                  onClick={() => setMode(entry)}
                >
                  {entry}
                </button>
              ))}
            </div>
            <button className="settleAction cxConfirm" disabled={Boolean(whyNot)} title={whyNot} onClick={confirm}>
              <CircleCheck size={17} /> Confirm payment · {formatMoney(kept)}
              {mode ? ` · ${mode}` : ""}
            </button>
            {whyNot && <p className={`cxWhy${blocked && whyNot === blocked ? " blocked" : ""}`}>{whyNot}</p>}
          </footer>
        )}
      </div>
    </div>
  );
}
