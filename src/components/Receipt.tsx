import React from "react";
import { Printer, X } from "lucide-react";
import type { PaymentMode, Session, TableConfig } from "../types";
import { calculateSessionTotals } from "../lib/billing";
import { billNumber, formatDuration, formatMoney } from "../lib/format";

// The receipt content itself — reused by the dashboard modal and by the bill
// panel's pre-payment preview. Handles every bill shape: table session (with or
// without kitchen items, discount, round-off) and a kitchen/takeaway order.
export function ReceiptBody({
  session,
  tables,
  sessions,
  now,
  mode,
  paidLabel = "Paid"
}: {
  session: Session;
  tables: TableConfig[];
  sessions: Session[];
  now: number;
  mode?: PaymentMode;
  paidLabel?: string;
}) {
  const table = tables.find((entry) => entry.id === session.tableId);
  const isKitchen = session.tableId === "counter";
  const name = table?.name ?? (isKitchen ? "Cafe" : session.tableId);
  const totals = calculateSessionTotals(session, now);
  const effectiveDiscount = totals.subtotal - totals.afterDiscount; // = min(discount, subtotal)
  const payMode = mode ?? session.paymentMode;

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
            <span>Table time<em>{formatDuration(totals.minutes)} @ {formatMoney(session.ratePerHour)}/hr</em></span>
            <span>{formatMoney(totals.tableCharge)}</span>
          </div>
        )}
        {session.orders.map((line) => (
          <div className="receiptLine" key={line.lineId}>
            <span>
              {line.name}
              <em>{line.variant !== "Regular" ? `${line.variant} · ` : ""}{line.quantity} × {formatMoney(line.unitPrice)}</em>
            </span>
            <span>{formatMoney(line.unitPrice * line.quantity)}</span>
          </div>
        ))}
        {session.orders.length === 0 && !isKitchen && totals.tableCharge === 0 && (
          <div className="receiptLine"><span>No charges</span><span>{formatMoney(0)}</span></div>
        )}
      </div>

      <div className="receiptRule dashed" />

      <div className="receiptTotals">
        <div><span>Subtotal</span><span>{formatMoney(totals.subtotal)}</span></div>
        {effectiveDiscount > 0 && (
          <div><span>Discount</span><span>− {formatMoney(effectiveDiscount)}</span></div>
        )}
        {session.roundOffEnabled && totals.roundOff !== 0 && (
          <div>
            <span>Round off</span>
            <span>{totals.roundOff > 0 ? "+ " : "− "}{formatMoney(Math.abs(totals.roundOff))}</span>
          </div>
        )}
      </div>

      <div className="receiptRule" />

      <div className="receiptGrand">
        <span>Total</span>
        <span>{formatMoney(totals.total)}</span>
      </div>
      <div className="receiptPaid">
        <span>{paidLabel} · {payMode ?? "—"}</span>
        <span>{formatMoney(totals.total)}</span>
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
  onClose
}: {
  session: Session;
  tables: TableConfig[];
  sessions: Session[];
  now: number;
  onClose: () => void;
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
        <ReceiptBody session={session} tables={tables} sessions={sessions} now={now} />
        <button className="receiptPrint" onClick={() => window.print()}>
          <Printer size={15} /> Print
        </button>
      </div>
    </div>
  );
}
