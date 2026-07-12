import React from "react";
import type { Metrics, Session, TableConfig } from "../types";
import { calculateSessionTotals } from "../lib/billing";
import { formatDuration, formatMoney } from "../lib/format";
import { Receipt } from "./Receipt";

export function Dashboard({
  metrics,
  sessions,
  tables,
  now
}: {
  metrics: Metrics;
  sessions: Session[];
  tables: TableConfig[];
  now: number;
}) {
  const [receiptSession, setReceiptSession] = React.useState<Session | null>(null);
  const recentBills = sessions
    .filter((session) => session.settledAt && !session.voidedAt)
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
    .slice(0, 8);

  return (
    <section className="dashboardPanel">
      <header className="sectionHeader">
        <div>
          <p className="eyebrow">Owner dashboard</p>
          <h2>Today’s performance</h2>
        </div>
      </header>

      <div className="dashboardMain">
        <div className="metricGrid">
          <Metric title="Total sales" value={formatMoney(metrics.totalRevenue)} />
          <Metric title="Table revenue" value={formatMoney(metrics.tableRevenue)} />
          <Metric title="Cafe revenue" value={formatMoney(metrics.kitchenRevenue)} />
          <Metric
            title="Takeaway"
            value={formatMoney(metrics.takeawayRevenue)}
            sub={`${metrics.takeawayOrders} ${metrics.takeawayOrders === 1 ? "order" : "orders"}`}
          />
          <Metric title="Discounts" value={formatMoney(metrics.discounts)} />
        </div>

        <div className="insightGrid">
          <InsightList title="Most sought tables" rows={metrics.tableRankings} valueSuffix="min" />
          <InsightList title="Famous cafe items" rows={metrics.itemRankings} valuePrefix="x" />
          <InsightList title="Peak hours" rows={metrics.peakHours} valueSuffix="sessions" />
          <InsightList title="Payment modes" rows={metrics.paymentModes} />
        </div>
      </div>

      <div className="historyPanel">
        <div className="sectionHeader compact">
          <div>
            <p className="eyebrow">Receipts</p>
            <h2>Recent settled bills</h2>
          </div>
          <span>{formatDuration(metrics.averageMinutes)} avg session</span>
        </div>
        {recentBills.length === 0 ? (
          <p className="muted">Settled bills will appear here.</p>
        ) : (
          <div className="receiptList">
            {recentBills.map((session) => {
              const table = tables.find((entry) => entry.id === session.tableId);
              const totals = calculateSessionTotals(session, now);
              const isKitchen = session.tableId === "counter";
              const name = table?.name ?? (isKitchen ? "Cafe" : session.tableId);
              return (
                <button className="receiptRow" key={session.id} onClick={() => setReceiptSession(session)}>
                  <div>
                    <strong>{session.customerName ? `${name} · ${session.customerName}` : name}</strong>
                    <span>{session.paymentMode} · {new Date(session.settledAt ?? 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <span>{isKitchen ? "Takeaway" : formatDuration(totals.minutes)}</span>
                  <strong>{formatMoney(totals.total)}</strong>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {receiptSession && (
        <Receipt session={receiptSession} tables={tables} sessions={sessions} now={now} onClose={() => setReceiptSession(null)} />
      )}
    </section>
  );
}

function Metric({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="metricCard">
      <p>{title}</p>
      <strong>{value}</strong>
      {sub && <span className="metricSub">{sub}</span>}
    </div>
  );
}

function InsightList({
  title,
  rows,
  valuePrefix = "",
  valueSuffix = ""
}: {
  title: string;
  rows: { name: string; value: number | string }[];
  valuePrefix?: string;
  valueSuffix?: string;
}) {
  return (
    <div className="insightCard">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">No settled sales yet.</p>
      ) : (
        rows.map((row) => {
          const unit =
            valueSuffix && row.value === 1 && valueSuffix.endsWith("s")
              ? valueSuffix.slice(0, -1)
              : valueSuffix;
          return (
            <div className="rankRow" key={row.name}>
              <span>{row.name}</span>
              <strong>
                {valuePrefix}
                {row.value}
                {unit ? ` ${unit}` : ""}
              </strong>
            </div>
          );
        })
      )}
    </div>
  );
}
