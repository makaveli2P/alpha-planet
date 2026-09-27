import React from "react";
import {
  ArrowLeft,
  Banknote,
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  Flag,
  NotebookPen,
  Pencil,
  Play,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingBag,
  Timer,
  Undo2,
  WalletCards,
  X
} from "lucide-react";
import { BASE_PLAYERS, EXTRA_PLAYER_RATE_PER_HOUR } from "../data/tables";
import { closeSittingError, type CustomerInput } from "../lib/appActions";
import {
  awaitingFrame,
  calculateSessionTotals,
  chargeCafeTotal,
  frameCandidates,
  frameHeadcountAt,
  frameTableCharge,
  frameViews,
  getTableHistory,
  idleSince,
  isFrameBilled,
  isOpenCharge,
  playersDuring,
  ratePerHourFor,
  runningFrame,
  seatedNow,
  sittingAlert,
  tabTotal,
  tableTabTotal
} from "../lib/billing";
import { searchCustomers, splitNameAndPhone } from "../lib/customers";
import { businessDayStart, formatClock, formatDuration, formatMoney, formatRatePerMinute, timeValue } from "../lib/format";
import { CANCEL_FRAME_WINDOW_MS, MIN_FRAME_PLAYERS } from "../lib/sessionActions";
import type { AppState, Customer, Frame, FrameView, PaymentMode, Seat, Session, TableConfig } from "../types";
import { TENDERS, type FloorActions, type FloorProps, type SettledInfo } from "./contracts";
import { OrderLines } from "./OrderLines";
import { ReceiptBody } from "./Receipt";

export type TablePanelProps = FloorProps & FloorActions & { isCounter: boolean; settledInfo?: SettledInfo };

const CONFIRM_MS = 3000;
const DAY_MS = 86400000;

// ====== Small helpers ======

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

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

// Clicks on a loser button this soon after End frame, or after the table order
// above the buttons changed or moved, are ignored.
const LOSER_PICK_GUARD_MS = 600;

// Re-stamp a timestamp with a typed "HH:MM". Of that time yesterday, today and
// tomorrow, the one nearest the old value wins, so a late-night frame that
// crosses midnight keeps its day.
function withTime(ms: number, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  const date = new Date(ms);
  date.setHours(h, m, 0, 0);
  const base = date.getTime();
  return [base - DAY_MS, base, base + DAY_MS].reduce((best, cur) => (Math.abs(cur - ms) < Math.abs(best - ms) ? cur : best));
}

// A time field that commits on blur or Enter, never on each keystroke: a
// half-typed time must not re-price a frame or a bill (the clamp would then
// rewrite the field under the fingers).
function DraftTime({ ms, onCommit, label }: { ms: number; onCommit: (at: number) => void; label: string }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    if (draft && draft !== timeValue(ms)) onCommit(withTime(ms, draft));
    setDraft(null);
  };
  return (
    <input
      type="time"
      value={draft ?? timeValue(ms)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(null);
        }
      }}
      aria-label={label}
    />
  );
}

// The whole-table clock as "h:mm".
function clockHM(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function clockTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function maskPhone(phone?: string) {
  return phone ? `••••${phone.slice(-4)}` : "no phone";
}

function lineCount(session: Session) {
  return session.orders.reduce((sum, line) => sum + line.quantity, 0);
}

// One seat per customer (a player who left and came back has two seats); a
// seat still at the table wins over one that left.
function uniqueByCustomer(seats: Seat[]): Seat[] {
  const byCustomer = new Map<string, Seat>();
  for (const seat of seats) {
    const seen = byCustomer.get(seat.customerId);
    if (!seen || (seen.leftAt != null && seat.leftAt == null)) byCustomer.set(seat.customerId, seat);
  }
  return Array.from(byCustomer.values());
}

type CustomerLookup = (customerId: string) => Customer | undefined;

function useCustomerLookup(state: AppState): CustomerLookup {
  const byId = React.useMemo(() => new Map(state.customers.map((customer) => [customer.id, customer])), [state.customers]);
  return (customerId) => byId.get(customerId);
}

// ====== Status pill ======

type Pill = { label: string; tone: "free" | "seated" | "running" | "awaiting" | "billing"; title?: string };

// The status words shared with the tables list (SPEC-v2 "Words").
function statusPill(session: Session | undefined, isCounter: boolean, now: number): Pill {
  if (!session) return { label: "Free", tone: "free" };
  if (isCounter) {
    // An empty order has nothing to take payment for: the seated tone, as in
    // the tables list.
    const items = lineCount(session);
    return { label: `Order · ${plural(items, "item")}`, tone: items > 0 ? "billing" : "seated" };
  }
  if (isFrameBilled(session)) {
    const frames = session.frames ?? [];
    const waiting = awaitingFrame(session);
    if (waiting) return { label: `Pick loser · Frame ${frames.indexOf(waiting) + 1}`, tone: "awaiting" };
    const running = runningFrame(session);
    if (running) return { label: `Frame ${frames.indexOf(running) + 1} · ${formatClock(now - running.startedAt)}`, tone: "running" };
    // Same words and tone as the tables list: "Between frames · 3", the
    // headcount in the title; yellow when the table needs staff.
    const seated = seatedNow(session).length;
    const title = `${plural(seated, "player")} at the table`;
    const alert = sittingAlert(session, now);
    if (alert === "order") return { label: `Charge table order · ${formatMoney(tableTabTotal(session))}`, tone: "awaiting", title: "Nobody at the table" };
    if (alert === "idle") return { label: `Idle ${formatDuration(Math.floor((now - idleSince(session)) / 60000))} · ${seated}`, tone: "awaiting", title };
    return { label: `${frames.length === 0 ? "Seated" : "Between frames"} · ${seated}`, tone: "seated", title };
  }
  if (!session.endedAt) return { label: `Clock ${clockHM(now - session.startedAt)}`, tone: "running" };
  return { label: `Take payment ${formatMoney(calculateSessionTotals(session, now).total)}`, tone: "billing" };
}

// ====== Panel ======

export function TablePanel(props: TablePanelProps) {
  const { table, session, now, isCounter, settledInfo } = props;
  const pill = statusPill(session, isCounter, now);
  const frameMode = Boolean(session && isFrameBilled(session));
  const modeChip = session && !isCounter ? (frameMode ? "Loser pays" : "Whole table") : undefined;

  let body: React.ReactNode;
  if (settledInfo) body = <SettledConfirm info={settledInfo} />;
  else if (!session) body = isCounter ? <CounterEmpty onStart={props.onStartCounterOrder} /> : <FreeTable {...props} />;
  else if (frameMode) body = <FramesSitting {...props} session={session} />;
  else body = <WholeBill {...props} session={session} />;

  return (
    <section className="billPanel tablePanel">
      <header className="billHeader tpHeader">
        <div>
          <p className="eyebrow">{table.type}</p>
          <h2>{table.name}</h2>
        </div>
        <div className="tpBadges">
          <span className={`tpPill ${pill.tone}`} title={pill.title}>
            {pill.label}
          </span>
          {modeChip && <span className="tpMode">{modeChip}</span>}
        </div>
      </header>
      {body}
    </section>
  );
}

// ====== Confirmation after a whole bill is paid or put on a tab ======

function SettledConfirm({ info }: { info: SettledInfo }) {
  const onTab = info.mode === "Tab";
  return (
    <div className="settleConfirm" role="status">
      <CheckCircle2 size={40} aria-hidden="true" />
      <h3>{onTab ? "Put on tab" : "Payment recorded"}</h3>
      <p className="settleConfirmWho">
        {info.label} · {onTab ? "pays later" : info.mode}
      </p>
      <strong className="settleConfirmTotal">{formatMoney(info.total)}</strong>
    </div>
  );
}

// ====== Free table / counter ======

function CounterEmpty({ onStart }: { onStart: () => void }) {
  return (
    <div className="emptyState">
      <ShoppingBag size={26} aria-hidden="true" />
      <h3>New cafe order</h3>
      <p>Ring up cafe items to go. No table needed.</p>
      <button type="button" className="primaryAction" onClick={onStart}>
        <Plus size={18} aria-hidden="true" /> Start order
      </button>
    </div>
  );
}

function FreeTable(props: TablePanelProps) {
  const { state, table, now } = props;
  const snooker = table.game === "snooker";
  return (
    <div className="emptyState tpFree">
      <Clock3 size={26} aria-hidden="true" />
      <h3>Table is free</h3>
      <p>
        {snooker
          ? `${formatMoney(table.ratePerHour)}/hr for ${BASE_PLAYERS} · +${formatMoney(EXTRA_PLAYER_RATE_PER_HOUR)}/hr per extra player. Add players on the left, then start a frame.`
          : `${formatMoney(table.ratePerHour)}/hr flat. Start the clock for one bill, or add players for loser-pays frames.`}
      </p>
      <StartActions table={table} onStartFrame={props.onStartFrame} onStartClock={props.onStartClock} onFelt />
      <TodayStrip state={state} tableId={table.id} now={now} />
    </div>
  );
}

// "Today on this table", from getTableHistory.
function TodayStrip({ state, tableId, now }: { state: AppState; tableId: string; now: number }) {
  const history = getTableHistory(state, tableId, now);
  const { sittings, frames, minutes, revenue } = history.today;
  const lastAt = history.lastAt;
  // Business days (they turn at 6 AM): a 3 AM close belongs to yesterday.
  const dayStart = businessDayStart(now);
  const lastDay =
    lastAt == null || lastAt >= dayStart
      ? "Today"
      : lastAt >= dayStart - DAY_MS
        ? "Yesterday"
        : new Date(lastAt).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return (
    <div className="tableHistoryStrip">
      <div>
        <span>Last sitting</span>
        {lastAt != null ? <strong>Closed {clockTime(lastAt)}</strong> : <strong className="empty">—</strong>}
        <em>{lastAt != null ? lastDay : "No sittings yet"}</em>
      </div>
      <div>
        <span>Today on this table</span>
        <strong>
          {plural(sittings, "sitting")}
          {frames > 0 ? ` · ${plural(frames, "frame")}` : ""}
        </strong>
        <em>
          {minutes > 0 ? `${formatDuration(minutes)} · ` : ""}
          {formatMoney(revenue)}
        </em>
      </div>
    </div>
  );
}

// The start buttons for a free table or a table between frames. Snooker leads
// with Start frame; pool leads with the clock. The whole-table clock is only
// offered before any frame is played in the sitting.
function StartActions({
  table,
  session,
  onStartFrame,
  onStartClock,
  onFelt = false
}: {
  table: TableConfig;
  session?: Session;
  onStartFrame: () => void;
  onStartClock: () => void;
  onFelt?: boolean;
}) {
  const seated = session ? seatedNow(session).length : 0;
  const played = session?.frames?.length ?? 0;
  const nextNo = played + 1;
  const canClock = played === 0;
  const frameRate = session ? ratePerHourFor(session, seated) : table.ratePerHour;
  const clockRate = session?.ratePerHour ?? table.ratePerHour;
  const short = MIN_FRAME_PLAYERS - seated;
  const frameHint =
    short <= 0
      ? undefined
      : seated === 0
        ? `Add ${MIN_FRAME_PLAYERS} players to start a frame`
        : `Add ${plural(short, "more player")} to start a frame`;
  const clockFirst = table.game !== "snooker" && canClock;

  const frameButton = (primary: boolean) => (
    <button
      type="button"
      className={primary ? "primaryAction" : "ghostAction"}
      disabled={short > 0}
      title={frameHint}
      onClick={onStartFrame}
    >
      <Play size={16} aria-hidden="true" />
      {primary ? (
        <span>
          Start frame {nextNo} <em>· {plural(seated, "player")} · {formatMoney(frameRate)}/hr</em>
        </span>
      ) : (
        "Frames (loser pays)"
      )}
    </button>
  );
  const clockButton = (primary: boolean) => (
    <button type="button" className={primary ? "primaryAction" : "ghostAction"} onClick={onStartClock}>
      <Timer size={16} aria-hidden="true" />
      {primary ? (
        <span>
          Start clock <em>· {formatMoney(clockRate)}/hr · one bill</em>
        </span>
      ) : (
        "Whole-table clock"
      )}
    </button>
  );

  return (
    <div className={`tpStart${onFelt ? " onFelt" : ""}`}>
      {clockFirst ? clockButton(true) : frameButton(true)}
      {clockFirst ? frameButton(false) : canClock ? clockButton(false) : null}
      {frameHint && <p className="tpHint">{frameHint}</p>}
    </div>
  );
}

// ====== Loser-pays sitting ======

function FramesSitting(props: TablePanelProps & { session: Session }) {
  const { state, table, session, now } = props;
  const customerOf = useCustomerLookup(state);
  const nameOf = (customerId: string) => customerOf(customerId)?.name ?? "Unknown player";
  const frames = session.frames ?? [];
  const waiting = awaitingFrame(session);
  const running = runningFrame(session);
  const idle = !waiting && !running;
  const seated = seatedNow(session).length;
  const billed = frameViews(session, state.charges, now)
    .filter((view) => view.state === "billed")
    .reverse();

  return (
    <>
      <div className="tpBody">
        {waiting && (
          <AwaitingFrame
            state={state}
            session={session}
            frame={waiting}
            no={frames.indexOf(waiting) + 1}
            now={now}
            nameOf={nameOf}
            canKeepPlaying={!running && seated > 0}
            onBillFrame={props.onBillFrame}
            onSetFrameStart={props.onSetFrameStart}
            onSetFrameEnd={props.onSetFrameEnd}
            onKeepPlaying={props.onKeepPlaying}
            onChangeQuantity={props.onChangeQuantity}
            onChargeTabTo={props.onChargeTabTo}
          />
        )}
        {running && (
          <RunningFrame
            key={running.id}
            session={session}
            frame={running}
            no={frames.indexOf(running) + 1}
            now={now}
            nameOf={nameOf}
            blockedBy={waiting ? `Pick the loser of frame ${frames.indexOf(waiting) + 1} first.` : undefined}
            onEndFrame={props.onEndFrame}
            onCancelFrame={props.onCancelFrame}
            onSetFrameStart={props.onSetFrameStart}
          />
        )}
        {idle && (
          <div className="tpBetween">
            <p className="eyebrow">
              {seated === 0
                ? "Nobody seated"
                : `${frames.length === 0 ? "Seated" : "Between frames"} · idle ${formatClock(now - idleSince(session))}`}
            </p>
            <StartActions table={table} session={session} onStartFrame={props.onStartFrame} onStartClock={props.onStartClock} />
            {frames.length === 0 && <p className="tpHint">A frame starts only when you tap Start frame.</p>}
          </div>
        )}
        {/* The table order. While a frame waits for its loser, the lines are in
            that frame's breakdown instead, so each line shows once. */}
        {!waiting && (
          <OrderLines
            state={state}
            session={session}
            isCounter={props.isCounter}
            variant="section"
            onChangeQuantity={props.onChangeQuantity}
            onChargeTabTo={props.onChargeTabTo}
          />
        )}
        <FramesGrid session={session} views={billed} now={now} nameOf={nameOf} onReassignFrame={props.onReassignFrame} />
      </div>
      {idle && <CloseTable state={state} session={session} customerOf={customerOf} onCloseTable={props.onCloseTable} />}
    </>
  );
}

function RunningFrame({
  session,
  frame,
  no,
  now,
  nameOf,
  blockedBy,
  onEndFrame,
  onCancelFrame,
  onSetFrameStart
}: {
  session: Session;
  frame: Frame;
  no: number;
  now: number;
  nameOf: (customerId: string) => string;
  blockedBy?: string;
  onEndFrame: () => void;
  onCancelFrame: () => void;
  onSetFrameStart: (frameId: string, at: number) => void;
}) {
  const [confirmingCancel, setConfirmingCancel] = useConfirming();
  const elapsed = now - frame.startedAt;
  const tableCharge = frameTableCharge(session, frame, now);
  // The frame's headcount: everyone in it so far (a player who left still
  // counts until the frame ends).
  const headcount = frameHeadcountAt(session, frame.startedAt, now);
  const rate = ratePerHourFor(session, headcount);
  // Everyone in the frame so far: seated now, or left after it started.
  const inFrame = uniqueByCustomer(
    (session.seats ?? []).filter((seat) => seat.joinedAt <= now && (seat.leftAt == null || seat.leftAt > frame.startedAt))
  );
  const canCancel = elapsed <= CANCEL_FRAME_WINDOW_MS;

  return (
    <div className="tpFrame running">
      <div className="tpFrameTop">
        <div>
          <p className="eyebrow">Frame {no} · running</p>
          <strong className="tpClock">{formatClock(elapsed)}</strong>
        </div>
        <div className="tpFrameMoney">
          <span>
            Table <strong>{formatMoney(tableCharge)}</strong>
          </span>
          <span>
            Rate <strong>{formatRatePerMinute(rate)}/min</strong>
            <em>
              {formatMoney(rate)}/hr · {plural(headcount, "player")}
            </em>
          </span>
        </div>
      </div>

      {inFrame.length > 0 && (
        <div className="tpChips" aria-label={`Players in frame ${no}`}>
          {inFrame.map((seat) => (
            <span key={seat.id} className={`tpChip${seat.leftAt != null ? " left" : ""}`}>
              {nameOf(seat.customerId)}
              {seat.leftAt != null ? " · left" : ""}
            </span>
          ))}
        </div>
      )}

      <div className="tpFrameActions">
        <button type="button" className="tpEndBtn" onClick={onEndFrame} disabled={Boolean(blockedBy)} title={blockedBy}>
          <Flag size={16} aria-hidden="true" /> End frame {no}
        </button>
        {canCancel && (
          <button
            type="button"
            className={`ghostAction danger${confirmingCancel ? " confirming" : ""}`}
            title="Discard this frame. Nothing is billed."
            onClick={() => {
              if (confirmingCancel) {
                onCancelFrame();
                setConfirmingCancel(false);
              } else {
                setConfirmingCancel(true);
              }
            }}
          >
            {confirmingCancel ? "Tap again to cancel" : "Cancel frame"}
          </button>
        )}
        <label className="timeField tpTime">
          <span>Started</span>
          <DraftTime ms={frame.startedAt} onCommit={(at) => onSetFrameStart(frame.id, at)} label={`Frame ${no} start time`} />
        </label>
      </div>
      {blockedBy && <p className="tpHint warn">{blockedBy}</p>}
    </div>
  );
}

function AwaitingFrame({
  state,
  session,
  frame,
  no,
  now,
  nameOf,
  canKeepPlaying,
  onBillFrame,
  onSetFrameStart,
  onSetFrameEnd,
  onKeepPlaying,
  onChangeQuantity,
  onChargeTabTo
}: {
  state: AppState;
  session: Session;
  frame: Frame;
  no: number;
  now: number;
  nameOf: (customerId: string) => string;
  canKeepPlaying: boolean;
  onBillFrame: (seatId: string) => void;
  onSetFrameStart: (frameId: string, at: number) => void;
  onSetFrameEnd: (frameId: string, at: number) => void;
  onKeepPlaying: () => void;
  onChangeQuantity: (lineId: string, delta: number) => void;
  onChargeTabTo: (seatId: string, lineId?: string) => void;
}) {
  const end = frame.endedAt ?? now;
  const tableCharge = frameTableCharge(session, frame, now);
  const minutes = Math.floor((end - frame.startedAt) / 60000);
  const players = playersDuring(session, frame.startedAt, end);
  const tab = tableTabTotal(session);
  const candidates = uniqueByCustomer(frameCandidates(session, frame, now));

  // The table order sits above the loser buttons. A tap there can move them
  // under the finger: a line that goes (its last "−" or its last unit
  // charged), a line that opens or closes, the status line. So the second tap
  // of a double tap must not bill the frame. Loser taps wait
  // LOSER_PICK_GUARD_MS after any tap in the breakdown, any change of the
  // order and any change of the breakdown height.
  const breakdownRef = React.useRef<HTMLDivElement>(null);
  const shiftedAt = React.useRef(0);
  const orderSig = session.orders.map((line) => `${line.lineId}:${line.quantity}`).join();
  // A layout effect runs in the commit of the change, before the browser
  // paints the moved buttons. It also runs on mount, like the End-frame guard.
  React.useLayoutEffect(() => {
    shiftedAt.current = Date.now();
  }, [orderSig]);
  React.useLayoutEffect(() => {
    const box = breakdownRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    let height = box.offsetHeight;
    const observer = new ResizeObserver(() => {
      if (box.offsetHeight === height) return;
      height = box.offsetHeight;
      shiftedAt.current = Date.now();
    });
    // The border box, so a padding or border change also counts.
    observer.observe(box, { box: "border-box" });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="tpFrame awaiting">
      <div className="tpFrameTop">
        <div>
          <h3 className="tpAsk">Frame {no} ended — pick the loser</h3>
        </div>
        <strong className="tpClock stopped">{formatClock(end - frame.startedAt)}</strong>
      </div>

      <div
        className="tpBreakdown"
        ref={breakdownRef}
        onClickCapture={() => {
          shiftedAt.current = Date.now();
        }}
      >
        <div className="tpBdRow">
          <span>
            Table time
            <em>
              {formatDuration(minutes)} · {plural(players, "player")} · priced by headcount
            </em>
          </span>
          <strong>{formatMoney(tableCharge)}</strong>
        </div>
        {/* The table order, editable: a unit can still go to its owner before
            the frame bills. The total below updates live. */}
        <OrderLines
          state={state}
          session={session}
          isCounter={false}
          variant="rows"
          onChangeQuantity={onChangeQuantity}
          onChargeTabTo={onChargeTabTo}
        />
        <div className="tpBdRow tpBreakdownTotal">
          <span>Goes on the loser's tab</span>
          <strong>{formatMoney(tableCharge + tab)}</strong>
        </div>
      </div>

      {candidates.length === 0 ? (
        <p className="tpHint warn">
          No player was at the table when frame {no} ended. Move the end time back{canKeepPlaying ? ", or tap Keep playing" : ""}.
        </p>
      ) : (
        <div className="tpLosers">
          {candidates.map((seat) => (
            <button
              key={seat.id}
              type="button"
              className="tpLoserBtn"
              onClick={() => {
                // The second click of a double-click on End frame, or on a
                // table-order control that moved these buttons, lands here:
                // ignore clicks in the first moment after either.
                const t = Date.now();
                if (t - (frame.endedAt ?? 0) < LOSER_PICK_GUARD_MS || t - shiftedAt.current < LOSER_PICK_GUARD_MS) return;
                onBillFrame(seat.id);
              }}
            >
              <Flag size={14} aria-hidden="true" /> {nameOf(seat.customerId)}
              {seat.leftAt != null ? " · left" : ""}
            </button>
          ))}
        </div>
      )}

      <div className="tpFrameActions">
        {canKeepPlaying && (
          <button type="button" className="ghostAction" onClick={onKeepPlaying} title="End frame was tapped by mistake: the frame runs on.">
            <Undo2 size={16} aria-hidden="true" /> Keep playing
          </button>
        )}
        <label className="timeField tpTime">
          <span>Started</span>
          <DraftTime ms={frame.startedAt} onCommit={(at) => onSetFrameStart(frame.id, at)} label={`Frame ${no} start time`} />
        </label>
        <label className="timeField tpTime">
          <span>Ended</span>
          <DraftTime ms={end} onCommit={(at) => onSetFrameEnd(frame.id, at)} label={`Frame ${no} end time`} />
        </label>
      </div>
    </div>
  );
}

// Billed frames of this sitting, newest first. The lowest scorer can change
// while the charge is still open (not paid, not voided).
function FramesGrid({
  session,
  views,
  now,
  nameOf,
  onReassignFrame
}: {
  session: Session;
  views: FrameView[];
  now: number;
  nameOf: (customerId: string) => string;
  onReassignFrame: (frameId: string, seatId: string) => void;
}) {
  if (views.length === 0) return null;
  const billedTotal = views.reduce((sum, view) => sum + (view.charge && !view.charge.voidedAt ? view.charge.total : 0), 0);
  return (
    <div className="tpGrid">
      <div className="tpGridTitle">
        <h3>Frames</h3>
        <span>
          {plural(views.length, "frame")} billed · {formatMoney(billedTotal)}
        </span>
      </div>
      <div className="tpGridRow head">
        <span>#</span>
        <span>Players</span>
        <span>Amount</span>
        <span>Loser</span>
      </div>
      {views.map((view) => {
        const charge = view.charge;
        const cafe = charge ? chargeCafeTotal(charge) : 0;
        const voided = Boolean(charge?.voidedAt);
        const candidates = uniqueByCustomer(frameCandidates(session, view.frame, now));
        const current = charge ? candidates.find((seat) => seat.customerId === charge.customerId) : undefined;
        return (
          <div key={view.frame.id} className={`tpGridRow${voided ? " voided" : ""}`}>
            <span className="tpGridNo">{view.no}</span>
            <span>
              {plural(view.players, "player")}
              <em>{formatDuration(view.minutes)}</em>
            </span>
            <span className="tpGridAmt">
              {charge ? formatMoney(charge.total) : "—"}
              {cafe > 0 && <em>incl. cafe {formatMoney(cafe)}</em>}
            </span>
            <span className="tpWho">
              {!charge ? (
                "—"
              ) : isOpenCharge(charge) ? (
                <select
                  className="orderAssign"
                  value={current?.id ?? ""}
                  onChange={(event) => event.target.value && onReassignFrame(view.frame.id, event.target.value)}
                  aria-label={`Loser of frame ${view.no}`}
                >
                  {!current && (
                    <option value="" disabled>
                      {nameOf(charge.customerId)}
                    </option>
                  )}
                  {candidates.map((seat) => (
                    <option key={seat.id} value={seat.id}>
                      {nameOf(seat.customerId)}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <span className="tpWhoName">{nameOf(charge.customerId)}</span>
                  <span className={`tpTag ${voided ? "void" : "paid"}`}>{voided ? "void" : "paid"}</span>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Close a loser-pays table (tap twice). The first tap names anyone from this
// sitting (still seated, or already left) who owes money and has no phone, so
// staff can take payment or add a phone.
function CloseTable({
  state,
  session,
  customerOf,
  onCloseTable
}: {
  state: AppState;
  session: Session;
  customerOf: CustomerLookup;
  onCloseTable: () => void;
}) {
  const [confirming, setConfirming] = useConfirming();
  const error = closeSittingError(session);
  const owing = uniqueByCustomer(session.seats ?? [])
    .map((seat) => customerOf(seat.customerId))
    .filter((customer): customer is Customer => Boolean(customer && (customer.guest || !customer.phone)))
    .map((customer) => ({ customer, tab: tabTotal(state.charges, customer.id) }))
    .filter((entry) => entry.tab > 0);
  const first = owing[0];
  const armedText = first
    ? `${first.customer.name} owes ${formatMoney(first.tab)}, ${first.customer.phone ? "guest" : "no phone"}${owing.length > 1 ? ` (+${owing.length - 1} more)` : ""} — tap again to close`
    : "Tap again to close the table";

  return (
    <footer className="tpFoot">
      <button
        type="button"
        className={`ghostAction danger tpClose${confirming ? " confirming" : ""}`}
        disabled={Boolean(error)}
        title={error}
        onClick={() => {
          if (confirming) {
            onCloseTable();
            setConfirming(false);
          } else {
            setConfirming(true);
          }
        }}
      >
        <X size={16} aria-hidden="true" /> {confirming ? armedText : "Close table"}
      </button>
      <p className={`tpHint${error ? " warn" : ""}`}>{error ?? "Everyone leaves the table. Their tabs stay open to pay later."}</p>
    </footer>
  );
}

// ====== Whole bill (whole-table clock, and the counter) ======

type TabStep = { customerId?: string };

function WholeBill(props: TablePanelProps & { session: Session }) {
  const { state, session, now, isCounter } = props;
  const customerOf = useCustomerLookup(state);
  const totals = calculateSessionTotals(session, now);
  const items = lineCount(session);
  const ended = session.endedAt != null;
  // An empty counter order has nothing to take payment for: Void it instead.
  const emptyOrder = isCounter && items === 0;
  // A discount at or above the whole bill leaves nothing to pay.
  const discountTooBig = ended && totals.subtotal > 0 && session.discount >= totals.subtotal;
  const [confirmingEnd, setConfirmingEnd] = useConfirming();
  const [confirmingVoid, setConfirmingVoid] = useConfirming();
  // The tender under review (receipt preview), or the Put on tab step.
  const [pendingMode, setPendingMode] = React.useState<PaymentMode | null>(null);
  const [tabStep, setTabStep] = React.useState<TabStep | null>(null);
  React.useEffect(() => {
    setPendingMode(null);
    setTabStep(null);
  }, [session.id, session.endedAt]);
  // "Add name" and the pencil open these fields; a new bill or a Reopen closes them.
  const [nameOpen, setNameOpen] = React.useState(false);
  const [fixTimes, setFixTimes] = React.useState(false);
  React.useEffect(() => {
    setNameOpen(false);
    setFixTimes(false);
  }, [session.id, ended]);

  if (pendingMode) {
    return (
      <>
        <div className="receiptScroll">
          <div className="receiptInline">
            <ReceiptBody
              session={session}
              tables={state.tables}
              sessions={state.sessions}
              charges={state.charges}
              customers={state.customers}
              now={now}
              mode={pendingMode}
              paidLabel="Pay"
            />
          </div>
        </div>
        <div className="previewActions">
          <button type="button" className="ghostAction" onClick={() => setPendingMode(null)}>
            <ArrowLeft size={16} aria-hidden="true" /> Back
          </button>
          <button type="button" className="primaryAction" onClick={() => props.onSettle(pendingMode)}>
            <Check size={17} aria-hidden="true" /> Confirm {formatMoney(totals.total)} · {pendingMode}
          </button>
        </div>
      </>
    );
  }

  const hero = (
    <div className="totalHero">
      <div>
        <p className="eyebrow">Total</p>
        <strong className="heroFigure">{formatMoney(totals.total)}</strong>
      </div>
      <div className="totalHeroSub">
        {isCounter ? (
          <span>{plural(items, "item")}</span>
        ) : (
          <>
            <span>
              {formatDuration(totals.minutes)} {ended ? "played" : "elapsed"} · {formatMoney(session.ratePerHour)}/hr
            </span>
            <span>
              Table <strong>{formatMoney(totals.tableCharge)}</strong>
            </span>
            <span>
              Cafe <strong>{formatMoney(totals.kitchenTotal)}</strong>
            </span>
          </>
        )}
      </div>
    </div>
  );

  if (tabStep) {
    const picked = tabStep.customerId ? customerOf(tabStep.customerId) : undefined;
    return (
      <>
        {hero}
        {picked ? (
          <TabConfirm
            customer={picked}
            total={totals.total}
            currentTab={tabTotal(state.charges, picked.id)}
            onBack={() => setTabStep({})}
            onEdit={() => props.onEditCustomer(picked.id)}
            onConfirm={() => props.onPutOnTab(picked.id)}
          />
        ) : (
          <TabPicker
            state={state}
            session={session}
            total={totals.total}
            customerOf={customerOf}
            onPick={(customerId) => setTabStep({ customerId })}
            onPickNew={props.onPutOnTabNew}
            onBack={() => setTabStep(null)}
          />
        )}
      </>
    );
  }

  // Everything under the total scrolls as one area, so nothing clips in a
  // short window.
  return (
    <>
      {hero}
      <div className="tpBody">
        {nameOpen || session.customerName ? (
          <label className="nameField">
            <span>Name</span>
            <input
              type="text"
              value={session.customerName ?? ""}
              onChange={(event) => props.onSetName(event.target.value)}
              // Once staff edit the field it stays open, so deleting the last
              // character of a saved name does not unmount it mid-edit.
              onFocus={() => setNameOpen(true)}
              onBlur={() => {
                if (!session.customerName) setNameOpen(false);
              }}
              placeholder="Add a name (optional)"
              maxLength={40}
              autoFocus={nameOpen && !session.customerName}
            />
          </label>
        ) : (
          <div className="nameField">
            <span>Name</span>
            <button type="button" className="rowGhostBtn" onClick={() => setNameOpen(true)}>
              <Plus size={13} aria-hidden="true" /> Add name
            </button>
          </div>
        )}

        {ended && !isCounter && (
          <>
            <div className="tpTimesLine">
              <span>
                In <strong>{clockTime(session.startedAt)}</strong> · Out <strong>{clockTime(session.endedAt as number)}</strong> ·{" "}
                {formatDuration(totals.minutes)}
              </span>
              <button
                type="button"
                className={`rowGhostBtn tpPencil${fixTimes ? " active" : ""}`}
                aria-label="Fix start and end times"
                aria-expanded={fixTimes}
                onClick={() => setFixTimes((value) => !value)}
              >
                <Pencil size={13} aria-hidden="true" />
              </button>
            </div>
            {fixTimes && (
              <div className="timesRow tpFixTimes">
                <label className="timeField">
                  <span>Started</span>
                  <DraftTime ms={session.startedAt} onCommit={props.onSetStartTime} label="Start time" />
                </label>
                <label className="timeField">
                  <span>Ended</span>
                  <DraftTime ms={session.endedAt as number} onCommit={props.onSetEndTime} label="End time" />
                </label>
              </div>
            )}
          </>
        )}

        {ended && emptyOrder && <p className="tpHint tpEmptyHint">Add items from the menu.</p>}

        {ended && !emptyOrder && (
          <div className="adjustments">
            <label className="adjustmentField">
              <span>Discount</span>
              <input
                type="number"
                min="0"
                value={session.discount || ""}
                placeholder="0"
                onChange={(event) => props.onSetDiscount(Number(event.target.value))}
              />
            </label>
            <button
              type="button"
              className={`adjustmentField roundOff${session.roundOffEnabled ? " active" : ""}`}
              onClick={props.onToggleRoundOff}
            >
              <span>Round off</span>
              <strong>
                {session.roundOffEnabled
                  ? totals.roundOff !== 0
                    ? `${totals.roundOff > 0 ? "+" : "−"} ${formatMoney(Math.abs(totals.roundOff))}`
                    : "On"
                  : "Apply"}
              </strong>
            </button>
          </div>
        )}
        {discountTooBig && !emptyOrder && <p className="tpHint tpDiscountWarn">Discount is more than the bill.</p>}

        {ended && !emptyOrder && (
          <div className="tpPay">
            <p className="eyebrow">Take payment</p>
            <div className="tpTenders">
              {TENDERS.map((mode) => (
                <button key={mode} type="button" className="settleAction" onClick={() => setPendingMode(mode)}>
                  {mode === "Cash" ? <Banknote size={16} aria-hidden="true" /> : mode === "Card" ? <CreditCard size={16} aria-hidden="true" /> : <WalletCards size={16} aria-hidden="true" />}
                  {mode}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ghostAction tpTabBtn"
              disabled={totals.total <= 0}
              title={totals.total <= 0 ? "Nothing to put on a tab." : "Pay later: the bill goes on a customer's tab."}
              onClick={() => setTabStep({})}
            >
              <NotebookPen size={16} aria-hidden="true" /> Put on tab
            </button>
          </div>
        )}

        <div className="billActions">
          {!isCounter && !ended && (
            <button
              type="button"
              className={`warningAction${confirmingEnd ? " confirming" : ""}`}
              onClick={() => {
                if (confirmingEnd) {
                  props.onEndSession();
                  setConfirmingEnd(false);
                } else {
                  setConfirmingEnd(true);
                }
              }}
            >
              <ReceiptText size={17} aria-hidden="true" /> {confirmingEnd ? "Tap again to stop" : "Stop clock"}
            </button>
          )}
          {!isCounter && ended && (
            <button type="button" className="ghostAction" onClick={props.onReopen}>
              <RotateCcw size={17} aria-hidden="true" /> Reopen
            </button>
          )}
          <button
            type="button"
            className={`ghostAction danger${confirmingVoid ? " confirming" : ""}${isCounter ? " tpSolo" : ""}`}
            onClick={() => {
              if (confirmingVoid) {
                props.onVoid();
                setConfirmingVoid(false);
              } else {
                setConfirmingVoid(true);
              }
            }}
          >
            {confirmingVoid ? "Tap again to void" : isCounter ? "Void order" : "Void bill"}
          </button>
        </div>

        <OrderLines
          state={state}
          session={session}
          isCounter={isCounter}
          variant="section"
          onChangeQuantity={props.onChangeQuantity}
          onChargeTabTo={props.onChargeTabTo}
        />
      </div>
    </>
  );
}

// Put on tab, step 1: this sitting's players first, then a registry search.
function TabPicker({
  state,
  session,
  total,
  customerOf,
  onPick,
  onPickNew,
  onBack
}: {
  state: AppState;
  session: Session;
  total: number;
  customerOf: CustomerLookup;
  onPick: (customerId: string) => void;
  onPickNew: (input: CustomerInput) => string | undefined;
  onBack: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const seats = session.seats ?? [];
  const seatCustomerIds = Array.from(new Set(seats.map((seat) => seat.customerId)));
  const atTable = seatCustomerIds.map(customerOf).filter((customer): customer is Customer => Boolean(customer));
  const hasLeft = (customerId: string) => !seats.some((seat) => seat.customerId === customerId && seat.leftAt == null);
  const results = query.trim() ? searchCustomers(state.customers, query) : [];

  const row = (customer: Customer, highlight = false) => {
    const tab = tabTotal(state.charges, customer.id);
    return (
      <button key={customer.id} type="button" className={`tpPickRow${highlight ? " active" : ""}`} onClick={() => onPick(customer.id)}>
        <strong>
          {customer.name}
          {customer.guest && <span className="tpGuest">guest</span>}
        </strong>
        <span>
          {maskPhone(customer.phone)}
          {seatCustomerIds.includes(customer.id) && hasLeft(customer.id) ? " · left" : ""}
        </span>
        <em>{tab > 0 ? `Tab ${formatMoney(tab)}` : ""}</em>
      </button>
    );
  };

  return (
    <div className="tpTabPick">
      <div className="tpPickHead">
        <h3>Put {formatMoney(total)} on a tab</h3>
        <button type="button" className="rowGhostBtn" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" /> Back
        </button>
      </div>
      {atTable.length > 0 && (
        <>
          <p className="eyebrow">At this table</p>
          <div className="tpPickList">{atTable.map((customer) => row(customer))}</div>
        </>
      )}
      <p className="eyebrow">{atTable.length > 0 ? "Someone else" : "Find the customer"}</p>
      <label className="tpSearch">
        <Search size={15} aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results.length > 0) {
              event.preventDefault();
              onPick(results[0].id);
            } else if (event.key === "Escape") {
              event.preventDefault();
              if (query) setQuery("");
              else onBack();
            }
          }}
          placeholder="Search customers by name or phone"
          aria-label="Search customers"
          autoFocus={atTable.length === 0}
        />
      </label>
      {query.trim() && (
        <>
          {results.length > 0 && <div className="tpPickList">{results.map((customer, index) => row(customer, index === 0))}</div>}
          <NewTabCustomer text={query} total={total} matched={results.length > 0} onPickNew={onPickNew} />
        </>
      )}
    </div>
  );
}

// Put the bill on a new customer's tab ("Rahul 98765 43210" gives a name and a
// phone). They join the registry. It shows under the matches too, so a walk-in
// who shares a name with a customer still gets their own tab.
function NewTabCustomer({
  text,
  total,
  matched,
  onPickNew
}: {
  text: string;
  total: number;
  matched: boolean;
  onPickNew: (input: CustomerInput) => string | undefined;
}) {
  const [error, setError] = React.useState<string | undefined>();
  const input = splitNameAndPhone(text);
  React.useEffect(() => setError(undefined), [text]);
  return (
    <div className="tpNewTab">
      {!matched && <p className="muted">No customer matches “{text.trim()}”.</p>}
      {input.name ? (
        // Under matching customers it is a secondary button, so it never
        // competes with the rows; alone it is the filled action.
        <button type="button" className={matched ? "ghostAction" : "settleAction"} onClick={() => setError(onPickNew(input))}>
          Put {formatMoney(total)} on a new tab: {input.name}
          {input.phone ? ` · ${input.phone}` : ""}
        </button>
      ) : (
        <p className="muted">Type a name (and phone) to start a new tab.</p>
      )}
      {error && <p className="settleBlocked">{error}</p>}
    </div>
  );
}

// Put on tab, step 2: confirm who takes the bill.
function TabConfirm({
  customer,
  total,
  currentTab,
  onBack,
  onEdit,
  onConfirm
}: {
  customer: Customer;
  total: number;
  currentTab: number;
  onBack: () => void;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="tpTabConfirm">
      <p className="eyebrow">Put on tab</p>
      <h3>
        Put {formatMoney(total)} on {customer.name}'s tab
      </h3>
      <p className="muted">
        {currentTab > 0
          ? `Their tab goes from ${formatMoney(currentTab)} to ${formatMoney(currentTab + total)}.`
          : "This opens a tab for them."}{" "}
        They pay it later on the Customers page.
      </p>
      {!customer.phone && (
        <div className="tpWarnRow">
          <p className="tpWarn">{customer.name} has no phone number.</p>
          <button type="button" className="rowGhostBtn" onClick={onEdit}>
            <Pencil size={13} aria-hidden="true" /> Add phone
          </button>
        </div>
      )}
      <div className="previewActions">
        <button type="button" className="ghostAction" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <button type="button" className="primaryAction" onClick={onConfirm}>
          <Check size={17} aria-hidden="true" /> Put on {customer.name}'s tab
        </button>
      </div>
    </div>
  );
}
