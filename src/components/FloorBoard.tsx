import type { CSSProperties } from "react";
import { ShoppingBag } from "lucide-react";
import type { BallSpec, Session, TableConfig, TableStatus, TableSummary } from "../types";
import { calculateSessionTotals } from "../lib/billing";
import { getBalls } from "../lib/balls";
import { formatDuration, formatMoney } from "../lib/format";

export function FloorBoard({
  tableSummaries,
  selectedTableId,
  now,
  onSelectTable,
  counterSession,
  counterSelected,
  onSelectCounter
}: {
  tableSummaries: TableSummary[];
  selectedTableId: string;
  now: number;
  onSelectTable: (table: TableConfig) => void;
  counterSession?: Session;
  counterSelected: boolean;
  onSelectCounter: () => void;
}) {
  return (
    <div className="layoutBoard">
      {tableSummaries.map(({ table, session, status }) => (
        <TableVisual
          key={table.id}
          now={now}
          selected={selectedTableId === table.id}
          session={session}
          status={status}
          table={table}
          onSelectTable={onSelectTable}
        />
      ))}
      <CounterStation
        now={now}
        session={counterSession}
        selected={counterSelected}
        onSelect={onSelectCounter}
      />
    </div>
  );
}

function CounterStation({
  session,
  selected,
  now,
  onSelect
}: {
  session?: Session;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  const totals = session ? calculateSessionTotals(session, now) : undefined;
  const items = session ? session.orders.reduce((sum, line) => sum + line.quantity, 0) : 0;

  return (
    <button
      className={`counterTile${selected ? " selected" : ""}${session ? " active" : ""}`}
      onClick={onSelect}
      onTouchEnd={(event) => {
        event.preventDefault();
        onSelect();
      }}
      aria-label="Cafe takeaway order"
    >
      <ShoppingBag size={20} aria-hidden="true" />
      <span className="counterName">Cafe</span>
      <span className="counterMeta">
        {totals ? `${formatMoney(totals.total)} · ${items} ${items === 1 ? "item" : "items"}` : "Takeaway"}
      </span>
    </button>
  );
}

function TableVisual({
  table,
  session,
  status,
  selected,
  now,
  onSelectTable
}: {
  table: TableConfig;
  session?: Session;
  status: TableStatus;
  selected: boolean;
  now: number;
  onSelectTable: (table: TableConfig) => void;
}) {
  const totals = session ? calculateSessionTotals(session, now) : undefined;
  const tier = table.ratePerHour >= 1200 ? "premium" : table.ratePerHour >= 800 ? "high" : "standard";
  const code = tableCode(table.name);

  return (
    <button
      className={`tableTile ${table.game} ${table.orientation} ${table.felt} ${table.rail}-rail tier-${tier} ${status} ${selected ? "selected" : ""}`}
      style={{ left: `${table.x}%`, top: `${table.y}%`, width: `${table.w}%`, height: `${table.h}%` }}
      onClick={() => onSelectTable(table)}
      onTouchEnd={(event) => {
        event.preventDefault();
        onSelectTable(table);
      }}
      aria-label={session ? `Open ${table.name} bill` : `Select ${table.name}`}
    >
      <span className="pocket p1" />
      <span className="pocket p2" />
      <span className="pocket p3" />
      <span className="pocket p4" />
      <span className="pocket p5" />
      <span className="pocket p6" />
      {table.game === "american-pool" && <RailDiamonds />}
      <BallLayer status={status} table={table} />
      <span className="tableNumber" aria-hidden="true">{code}</span>
      {totals && (
        <span className="liveChip">
          <strong>{formatDuration(totals.minutes)}</strong>
          <em>{formatMoney(totals.total)}</em>
        </span>
      )}
      <span className="tableInfo">
        <strong>{table.name}</strong>
        <em>{formatMoney(table.ratePerHour)}/hr</em>
      </span>
    </button>
  );
}

function tableCode(name: string) {
  const [word, num] = name.split(" ");
  return word && num ? `${word[0].toUpperCase()}${num}` : name;
}

function RailDiamonds() {
  return (
    <span className="diamondLayer" aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => (
        <span key={index} className={`diamond d${index + 1}`} />
      ))}
    </span>
  );
}

function BallLayer({ table, status }: { table: TableConfig; status: TableStatus }) {
  const balls = getBalls(table, status);
  return (
    <span className="ballLayer" aria-hidden="true">
      {balls.map((ball: BallSpec) => (
        <span
          key={ball.id}
          className={`ball ${ball.size ?? "normal"} ${ball.kind ?? "snooker"}`}
          style={{
            left: `${ball.x}%`,
            top: `${ball.y}%`,
            background: ball.color,
            "--stripe-color": ball.stripeColor
          } as CSSProperties}
        >
          {ball.label}
        </span>
      ))}
    </span>
  );
}
