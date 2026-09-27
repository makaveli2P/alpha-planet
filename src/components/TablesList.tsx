import { FilePlus, ShoppingBag } from "lucide-react";
import type { Session, TableConfig } from "../types";
import {
  COUNTER_ID,
  awaitingFrame,
  calculateSessionTotals,
  getActiveSession,
  getTableStatus,
  idleSince,
  isFrameBilled,
  liveHeadcount,
  ratePerHourFor,
  runningFrame,
  seatedNow,
  sittingAlert
} from "../lib/billing";
import { formatClock, formatDuration, formatMoney, shortTableName } from "../lib/format";

export type TablesListProps = {
  tables: TableConfig[];
  sessions: Session[];
  now: number;
  selectedId: string; // a table id, or "counter" for Cafe · Takeaway
  onSelect: (tableId: string) => void;
  onManualBill: () => void; // opens the manual bill dialog
};

type Tone = "free" | "seated" | "running" | "awaiting" | "billing";
type RowStatus = { tone: Tone; label: string; live?: number };

// Whole-table clock as h:mm ("0:42", "2:05").
function hoursMinutes(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

// The status pill words for one table (SPEC-v2 "Words").
function tableStatus(session: Session | undefined, now: number): RowStatus {
  if (!session) return { tone: "free", label: "Free" };
  const status = getTableStatus(session);
  const frames = session.frames ?? [];
  const total = calculateSessionTotals(session, now).total;
  if (isFrameBilled(session)) {
    const waiting = awaitingFrame(session);
    if (status === "awaiting" && waiting) {
      return { tone: "awaiting", label: `Pick loser · Frame ${frames.indexOf(waiting) + 1}`, live: total };
    }
    const frame = runningFrame(session);
    if (status === "running" && frame) {
      return { tone: "running", label: `Frame ${frames.indexOf(frame) + 1} · ${formatClock(now - frame.startedAt)}`, live: total };
    }
    // Between frames: the same words and tone as the table panel pill.
    const live = total > 0 ? total : undefined;
    const seated = seatedNow(session).length;
    const alert = sittingAlert(session, now);
    if (alert === "order") return { tone: "awaiting", label: "Charge table order", live };
    if (alert === "idle") return { tone: "awaiting", label: `Idle ${formatDuration(Math.floor((now - idleSince(session)) / 60000))} · ${seated}`, live };
    return { tone: "seated", label: `${frames.length === 0 ? "Seated" : "Between frames"} · ${seated}`, live };
  }
  if (status === "billing") return { tone: "billing", label: `Take payment ${formatMoney(total)}` };
  return { tone: "running", label: `Clock ${hoursMinutes(now - session.startedAt)}`, live: total };
}

function counterStatus(session: Session | undefined, now: number): RowStatus {
  if (!session) return { tone: "free", label: "Free" };
  const items = session.orders.reduce((sum, line) => sum + line.quantity, 0);
  const total = calculateSessionTotals(session, now).total;
  return {
    tone: items > 0 ? "billing" : "seated",
    label: `Order · ${items} ${items === 1 ? "item" : "items"}`,
    live: total > 0 ? total : undefined
  };
}

function StatusLine({ status }: { status: RowStatus }) {
  return (
    <span className="flRowStatus">
      <span className={`flPill is-${status.tone}`}>{status.label}</span>
      {status.live != null && <span className="flLive">{formatMoney(status.live)}</span>}
    </span>
  );
}

// The floor as a vertical list: one row per table (tiny felt glyph, short and
// full name, rate, status pill, live ₹), and the cafe counter at the bottom.
// Below 1200px the column narrows to a rail: glyph, short name, status dot.
// The head holds the one entry to the manual bill dialog (icon only in the rail).
export function TablesList({ tables, sessions, now, selectedId, onSelect, onManualBill }: TablesListProps) {
  const inUse = tables.filter((table) => getActiveSession(sessions, table.id)).length;
  const counter = counterStatus(getActiveSession(sessions, COUNTER_ID), now);
  const counterSelected = selectedId === COUNTER_ID;

  return (
    <section className="tablesPanel flTables" aria-label="Tables">
      <header className="flTablesHead">
        <div>
          <p className="eyebrow">{inUse === 0 ? "All free" : `${inUse} in use`}</p>
          <h2>Tables</h2>
        </div>
        <button type="button" className="flManualBtn" aria-label="Manual bill" title="Add a bill that the floor did not record" onClick={onManualBill}>
          <FilePlus size={15} aria-hidden="true" />
          <span>Manual bill</span>
        </button>
      </header>

      <div className="flTablesList">
        {tables.map((table) => {
          const active = getActiveSession(sessions, table.id);
          const status = tableStatus(active, now);
          const selected = table.id === selectedId;
          // The rate this sitting bills right now (snapshotted, and raised for
          // extra players on a loser-pays table — during a frame, for everyone
          // in the frame so far); the configured rate when free.
          const rate = !active ? table.ratePerHour : isFrameBilled(active) ? ratePerHourFor(active, liveHeadcount(active, now)) : active.ratePerHour;
          const short = shortTableName(table.name);
          return (
            <button
              key={table.id}
              type="button"
              className={`flRow is-${status.tone}${selected ? " selected" : ""}`}
              onClick={() => onSelect(table.id)}
              aria-current={selected ? "true" : undefined}
              aria-label={`${table.name} · ${status.label}`}
              title={`${table.name} · ${status.label}`}
            >
              <span className={`flGlyph ${table.orientation} felt-${table.felt} rail-${table.rail} game-${table.game}`} aria-hidden="true" />
              <span className="flRowTitle">
                <b className="flShort">{short}</b>
                <span className="flFull">{table.name}</span>
              </span>
              <span className="flRate">{formatMoney(rate)}/hr</span>
              <StatusLine status={status} />
              <span className={`flDot is-${status.tone}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={`flRow flCafeRow is-${counter.tone}${counterSelected ? " selected" : ""}`}
        onClick={() => onSelect(COUNTER_ID)}
        aria-current={counterSelected ? "true" : undefined}
        aria-label={`Cafe · Takeaway · ${counter.label}`}
        title={`Cafe · Takeaway · ${counter.label}`}
      >
        <span className="flGlyph flCafeGlyph" aria-hidden="true">
          <ShoppingBag size={14} />
        </span>
        <span className="flRowTitle">
          <b className="flShort">Cafe</b>
          <span className="flFull">· Takeaway</span>
        </span>
        <StatusLine status={counter} />
        <span className={`flDot is-${counter.tone}`} aria-hidden="true" />
      </button>
    </section>
  );
}
