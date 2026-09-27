import React from "react";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { awaitingFrame, isFrameBilled, runningFrame, tabChargeTargets, tableTabTotal } from "../lib/billing";
import { formatMoney } from "../lib/format";
import type { AppState, OrderLine, Seat, Session } from "../types";
import type { FloorActions } from "./contracts";

// The one editable list of a sitting's cafe lines, in the Table column: the
// table order on a loser-pays table, the bill items on a whole bill, or the
// counter order. "section" has a title (and, on loser pays, a foot with the
// total and Charge all to…); "rows" is only the lines, for the awaiting-frame
// breakdown.

const CONFIRM_MS = 3000;
const STATUS_MS = 3000;
// A chip tap this soon after its line opened, or after the last charge, does
// nothing: a row above can collapse and move another chip under the finger.
export const TAP_GUARD_MS = 600;

// The open line (one at a time), or the Charge all picker, and when it opened.
export type OpenLine = { kind: "line"; lineId: string; at: number } | { kind: "all"; at: number } | null;

// A tap on a row closes it when it is open, else opens it (and closes any other).
export function toggleLine(open: OpenLine, lineId: string, now: number): OpenLine {
  return open?.kind === "line" && open.lineId === lineId ? null : { kind: "line", lineId, at: now };
}

export function tapBlocked(open: OpenLine, lastChargeAt: number, now: number): boolean {
  return !open || now - open.at < TAP_GUARD_MS || now - lastChargeAt < TAP_GUARD_MS;
}

// Close an open line when its line is gone (charged or removed), and close the
// picker when nothing is left to charge.
export function openAfterChange(open: OpenLine, orders: OrderLine[]): OpenLine {
  if (open?.kind === "line" && !orders.some((line) => line.lineId === open.lineId)) return null;
  if (open?.kind === "all" && orders.length === 0) return null;
  return open;
}

// The list's words, shared with the one-line summary in the Cafe column.
export function orderWords(session: Session, isCounter: boolean): { title: string; empty: string } {
  if (isFrameBilled(session)) return { title: "Table order", empty: "Nothing on the table order yet" };
  if (isCounter) return { title: "Order", empty: "No items yet" };
  return { title: "Bill items", empty: "No cafe items on the bill yet" };
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

type Status = { text: string; at: number } | null;

export function OrderLines({
  state,
  session,
  isCounter,
  variant,
  onChangeQuantity,
  onChargeTabTo
}: {
  state: AppState;
  session: Session;
  isCounter: boolean;
  variant: "section" | "rows";
  onChangeQuantity: FloorActions["onChangeQuantity"];
  onChargeTabTo: FloorActions["onChargeTabTo"];
}) {
  const orders = session.orders;
  const frameMode = isFrameBilled(session);
  const words = orderWords(session, isCounter);
  const units = orders.reduce((sum, line) => sum + line.quantity, 0);
  const total = tableTabTotal(session);
  const { seated, left } = tabChargeTargets(session);
  const hasTargets = seated.length + left.length > 0;
  const frames = session.frames ?? [];
  const running = runningFrame(session);
  const frameOpen = running ?? awaitingFrame(session);
  // Charge all only between frames: that is when Close table needs it. While a
  // frame runs or waits, the order goes to that frame's loser.
  const canChargeAll = variant === "section" && frameMode && !frameOpen && orders.length > 0 && hasTargets;

  const [open, setOpen] = React.useState<OpenLine>(null);
  const [armed, setArmed] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<Status>(null);
  const lastChargeAt = React.useRef(0);
  const openRef = React.useRef<HTMLDivElement>(null);
  const baseId = React.useId();

  let current = openAfterChange(open, orders);
  if (current?.kind === "all" && !canChargeAll) current = null;

  React.useEffect(() => {
    if (current !== open) setOpen(current);
  }, [current, open]);

  React.useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  React.useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), STATUS_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  // Keep the open controls (or the picker) in view inside the scrolling column.
  React.useEffect(() => {
    openRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  const byId = React.useMemo(() => new Map(state.customers.map((customer) => [customer.id, customer])), [state.customers]);
  const nameOf = (seat: Seat) => byId.get(seat.customerId)?.name ?? "Unknown player";
  const targets = [...seated, ...left];
  const isLeft = (seat: Seat) => seat.leftAt != null;

  const chargeOne = (seat: Seat, line: OrderLine) => {
    const now = Date.now();
    if (tapBlocked(current, lastChargeAt.current, now)) return;
    lastChargeAt.current = now;
    onChargeTabTo(seat.id, line.lineId);
    setStatus({ text: `Charged 1 ${line.name} to ${nameOf(seat)}.`, at: now });
  };

  // Tap twice: the first tap arms the chip, a tap on another chip moves the arm.
  const chargeAll = (seat: Seat) => {
    if (armed !== seat.id) {
      setArmed(seat.id);
      return;
    }
    onChargeTabTo(seat.id);
    setOpen(null);
    setArmed(null);
    setStatus({ text: `Charged the table order (${formatMoney(total)}) to ${nameOf(seat)}.`, at: Date.now() });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !current) return;
    event.preventDefault();
    // Focus goes back to the row, so it does not drop to the page.
    const row = (event.target as HTMLElement).closest(".olLine")?.querySelector<HTMLButtonElement>(".olRow");
    setOpen(null);
    setArmed(null);
    row?.focus();
  };

  const lines = orders.map((line) => {
    const isOpen = current?.kind === "line" && current.lineId === line.lineId;
    const controlsId = `${baseId}-${line.lineId}`;
    return (
      <div key={line.lineId} className={`olLine${isOpen ? " open" : ""}`}>
        <button
          type="button"
          className="olRow"
          aria-expanded={isOpen}
          aria-controls={isOpen ? controlsId : undefined}
          title={line.name}
          onClick={() => {
            setOpen(toggleLine(current, line.lineId, Date.now()));
            setArmed(null);
          }}
        >
          <span className="olWhat">
            {line.name} <b>× {line.quantity}</b>
            <em>
              {line.variant !== "Regular" ? `${line.variant} · ` : ""}
              {formatMoney(line.unitPrice)}
            </em>
          </span>
          <strong className="olAmt">{formatMoney(line.unitPrice * line.quantity)}</strong>
          {isOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
        {isOpen && (
          <div className="olControls" id={controlsId} ref={openRef}>
            <div className="qtyControls">
              <button type="button" onClick={() => onChangeQuantity(line.lineId, -1)} aria-label={`Remove one ${line.name}`}>
                <Minus size={13} aria-hidden="true" />
              </button>
              <span>{line.quantity}</span>
              <button type="button" onClick={() => onChangeQuantity(line.lineId, 1)} aria-label={`Add one ${line.name}`}>
                <Plus size={13} aria-hidden="true" />
              </button>
            </div>
            {frameMode && hasTargets && (
              <>
                <span className="olChargeLabel">{line.quantity > 1 ? "Charge 1 to" : "Charge to"}</span>
                {targets.map((seat) => (
                  <button
                    key={seat.id}
                    type="button"
                    className={`olChip${isLeft(seat) ? " left" : ""}`}
                    title={nameOf(seat)}
                    onClick={() => chargeOne(seat, line)}
                  >
                    {nameOf(seat)}
                    {isLeft(seat) ? " · left" : ""}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    );
  });

  const statusLine = (
    <p className="olStatus" aria-live="polite">
      {status?.text ?? ""}
    </p>
  );

  if (variant === "rows") {
    return (
      <div className="olLines olRows" onKeyDown={onKeyDown}>
        {lines}
        {statusLine}
      </div>
    );
  }

  const frameNo = frameOpen ? frames.indexOf(frameOpen) + 1 : 0;
  // Nobody seated with a table order: no next frame can take it (the
  // "Charge table order" alert), so staff charge it to a player.
  const note = !hasTargets
    ? "Add a player to charge the table order."
    : frameOpen
      ? `Goes to frame ${frameNo}'s loser`
      : seated.length === 0 && orders.length > 0
        ? "Nobody at the table. Charge the table order to a player."
        : "Goes to the next frame's loser";
  const picking = current?.kind === "all";

  return (
    <div className="olSection" onKeyDown={onKeyDown}>
      <div className="olHead">
        <h3>{words.title}</h3>
        {units > 0 && <span>{plural(units, "item")}</span>}
      </div>
      {orders.length === 0 ? <p className="olEmpty">{words.empty}.</p> : <div className="olLines">{lines}</div>}
      {statusLine}
      {frameMode && (
        <div className="olFoot">
          {picking && (
            <div className="olPick" ref={openRef}>
              <div className="olPickHead">
                <span>Charge all ({formatMoney(total)}) to:</span>
                <button
                  type="button"
                  className="rowGhostBtn"
                  onClick={() => {
                    setOpen(null);
                    setArmed(null);
                  }}
                >
                  Cancel
                </button>
              </div>
              <div className="olChips">
                {targets.map((seat) => (
                  <button
                    key={seat.id}
                    type="button"
                    className={`olChip${isLeft(seat) ? " left" : ""}${armed === seat.id ? " confirming" : ""}`}
                    title={nameOf(seat)}
                    onClick={() => chargeAll(seat)}
                  >
                    {nameOf(seat)}
                    {armed === seat.id ? " · tap again" : isLeft(seat) ? " · left" : ""}
                  </button>
                ))}
              </div>
            </div>
          )}
          {canChargeAll && !picking && (
            <button
              type="button"
              className="ghostAction olAllBtn"
              onClick={() => {
                setOpen({ kind: "all", at: Date.now() });
                setArmed(null);
              }}
            >
              Charge all to…
            </button>
          )}
          <span className="olNote">{note}</span>
          <strong>{formatMoney(total)}</strong>
        </div>
      )}
    </div>
  );
}
