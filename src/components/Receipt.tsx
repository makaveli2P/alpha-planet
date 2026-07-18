import React from "react";
import { Printer, X } from "lucide-react";
import type { PaymentMode, PlayerTotals, Session, TableConfig } from "../types";
import { calculatePlayerBills, calculateSessionTotals, isPerPlayer } from "../lib/billing";
import { billNumber, formatDuration, formatMoney } from "../lib/format";
import { playerLabel } from "./PlayerBilling";

// The receipt content itself — reused by the dashboard modal and by the bill
// panel's pre-payment preview. Handles every bill shape: table session (with or
// without kitchen items, discount, round-off) and a kitchen/takeaway order.
export function ReceiptBody({
  session,
  tables,
  sessions,
  now,
  mode,
  paidLabel = "Paid",
  hideMoney = false
}: {
  session: Session;
  tables: TableConfig[];
  sessions: Session[];
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
        <span>{paidLabel} · {isPerPlayer(session) && !payMode ? "Split" : payMode ?? "—"}</span>
        <span>{money(totals.total)}</span>
      </div>

      {isPerPlayer(session) && (
        <>
          <div className="receiptRule dashed" />
          <div className="receiptSplitHead">Split · per player</div>
          <div className="receiptLines">
            {calculatePlayerBills(session, now).map((bill) => (
              <div className="receiptLine" key={bill.player.id}>
                <span>
                  {playerLabel(bill.player, bill.index)}
                  <em>
                    {session.frameCount ? `${bill.framesPlayed}/${session.frameCount} frames · ` : ""}
                    {bill.player.paymentMode ?? "unpaid"}
                  </em>
                </span>
                <span>{money(bill.total)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="receiptRule dashed" />

      <div className="receiptThanks">
        <strong>Thank you!</strong>
        <span>Please visit again.</span>
      </div>
    </>
  );
}

// A single player's receipt — their frame-share of the table time plus their
// own and shared cafe items. Bill number carries the session number with a
// player suffix (…-001-A). Used in the bill panel's per-player pay preview.
export function PlayerReceiptBody({
  session,
  tables,
  sessions,
  now,
  bill,
  mode,
  paidLabel = "Paid"
}: {
  session: Session;
  tables: TableConfig[];
  sessions: Session[];
  now: number;
  bill: PlayerTotals;
  mode?: PaymentMode;
  paidLabel?: string;
}) {
  const table = tables.find((entry) => entry.id === session.tableId);
  const name = table?.name ?? session.tableId;
  const totals = calculateSessionTotals(session, now);
  const payMode = mode ?? bill.player.paymentMode;
  const frameCount = Math.max(0, Math.floor(session.frameCount ?? 0));
  // A player who checked out early is billed to their leave time, not the table's.
  const leftEarly = Boolean(bill.player.leftAt);
  const minutes = leftEarly ? Math.max(0, Math.floor(bill.player.frozenMinutes ?? totals.minutes)) : totals.minutes;

  const started = new Date(bill.player.joinedAt ?? session.startedAt);
  // For an active player being checked out (not frozen yet), "out" is now.
  const ended = new Date(bill.player.leftAt ?? session.endedAt ?? session.settledAt ?? now);
  const settled = new Date(session.settledAt ?? bill.player.leftAt ?? session.endedAt ?? now);
  const clock = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = settled.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
  const billNo = `${billNumber(session, sessions, now)}-${String.fromCharCode(65 + bill.index)}`;
  const ownLines = session.orders.filter((line) => line.playerId === bill.player.id);

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
        <div><span>Table</span><span>{name} · {playerLabel(bill.player, bill.index)}</span></div>
        <div><span>In / Out</span><span>{clock(started)} – {clock(ended)}</span></div>
        <div><span>Duration</span><span>{formatDuration(minutes)}{leftEarly ? " · left early" : ""}</span></div>
      </div>

      <div className="receiptRule dashed" />

      <div className="receiptLines">
        {bill.tableShare > 0 && (
          <div className="receiptLine">
            <span>Table time<em>{frameCount > 0 ? `${bill.framesPlayed} of ${frameCount} frames` : "even split"}</em></span>
            <span>{formatMoney(bill.tableShare)}</span>
          </div>
        )}
        {ownLines.map((line) => (
          <div className="receiptLine" key={line.lineId}>
            <span>
              {line.name}
              <em>{line.variant !== "Regular" ? `${line.variant} · ` : ""}{line.quantity} × {formatMoney(line.unitPrice)}</em>
            </span>
            <span>{formatMoney(line.unitPrice * line.quantity)}</span>
          </div>
        ))}
        {bill.sharedCafeShare > 0 && (
          <div className="receiptLine">
            <span>Shared cafe<em>split share</em></span>
            <span>{formatMoney(bill.sharedCafeShare)}</span>
          </div>
        )}
        {bill.total === 0 && (
          <div className="receiptLine"><span>No charges</span><span>{formatMoney(0)}</span></div>
        )}
      </div>

      <div className="receiptRule" />

      <div className="receiptGrand">
        <span>Total</span>
        <span>{formatMoney(bill.total)}</span>
      </div>
      <div className="receiptPaid">
        <span>{paidLabel} · {payMode ?? "—"}</span>
        <span>{formatMoney(bill.total)}</span>
      </div>

      <div className="receiptRule dashed" />

      <div className="receiptThanks">
        <strong>Thank you!</strong>
        <span>Please visit again.</span>
      </div>
    </>
  );
}

// The dashboard modal wrapper around a settled bill's receipt.
export function Receipt({
  session,
  tables,
  sessions,
  now,
  onClose,
  hideMoney = false
}: {
  session: Session;
  tables: TableConfig[];
  sessions: Session[];
  now: number;
  onClose: () => void;
  hideMoney?: boolean;
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
        <ReceiptBody session={session} tables={tables} sessions={sessions} now={now} hideMoney={hideMoney} />
        <button className="receiptPrint" onClick={() => window.print()}>
          <Printer size={15} /> Print
        </button>
      </div>
    </div>
  );
}
