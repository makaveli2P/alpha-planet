import React from "react";
import type { HourRevenue, Metrics, RevenueMix, Session, TableConfig, TablePerformance, TenderTotals } from "../types";
import { calculateSessionTotals, isPerPlayer } from "../lib/billing";
import { formatDuration, formatMoney } from "../lib/format";
import { Receipt } from "./Receipt";

// Chart series colors — a validated, on-brand slice of the ball-accent set.
// Payment (green/blue/orange) and mix (blue/orange/purple) both clear the CVD
// and contrast gates on the cream surface; every mark is also direct-labeled.
const C = {
  table: "#1b4a86",
  cafe: "#b5601a",
  takeaway: "#5a3680",
  cash: "#2f7a48",
  upi: "#1b4a86",
  card: "#b5601a",
  unknown: "#8a7a5f",
  bar: "#1b4a86",
  areaLine: "#f0d072",
  areaFill: "#e2b431",
  peak: "#e08a2c"
};

export function Dashboard({
  metrics,
  sessions,
  tables,
  now,
  hideMoney = false
}: {
  metrics: Metrics;
  sessions: Session[];
  tables: TableConfig[];
  now: number;
  hideMoney?: boolean;
}) {
  const [receiptSession, setReceiptSession] = React.useState<Session | null>(null);
  const money = (value: number) => (hideMoney ? "₹ •••" : formatMoney(value));

  const recentBills = sessions
    .filter((session) => session.settledAt && !session.voidedAt)
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
    .slice(0, 8);

  const { revenueMix: mix, tenderTotals: tender } = metrics;
  const grossGap = mix.gross - metrics.totalRevenue; // discount + round-off given away
  const peak = metrics.peakHour != null ? metrics.revenueByHour.find((h) => h.hour === metrics.peakHour) : undefined;

  return (
    <section className="dashboardPanel">
      <header className="sectionHeader compact dashTop">
        <div>
          <p className="eyebrow">Owner dashboard</p>
          <h2>Today’s performance</h2>
        </div>
        <span>
          {metrics.settledSessions} {metrics.settledSessions === 1 ? "bill" : "bills"} · as of{" "}
          {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </header>

      {/* Hero — the day's takings and its shape, the one loud moment. */}
      <div className="dashHero">
        <div className="dashHeroFig">
          <p className="eyebrow onDark">Total sales</p>
          <strong className="display heroTotal">{money(metrics.totalRevenue)}</strong>
          <p className="heroCaption">
            {metrics.settledSessions} {metrics.settledSessions === 1 ? "bill" : "bills"}
            {mix.gross > 0 && ` · ${money(mix.gross)} gross`}
            {grossGap > 0 && ` · ${money(grossGap)} off`}
          </p>
        </div>
        <div className="dashHeroChart">
          <div className="chartCap onDark">
            <span>Money through the day</span>
            {peak && (
              <span className="chartCapPeak">
                Peak {peak.label} · {money(peak.total)}
              </span>
            )}
          </div>
          <RevenueArea data={metrics.revenueByHour} peakHour={metrics.peakHour} money={money} />
        </div>
      </div>

      {/* Operational counts — the units the new per-player flow unlocks. */}
      <div className="statStrip">
        <Stat label="Avg session" value={metrics.averageMinutes ? formatDuration(metrics.averageMinutes) : "—"} />
        <Stat label="Frames played" value={`${metrics.totalFrames}`} sub={metrics.avgFrames ? `${metrics.avgFrames} avg` : undefined} />
        <Stat label="Players" value={`${metrics.playersServed}`} sub="snooker" />
        <Stat label="Discounts" value={money(metrics.discounts)} />
        <Stat label="Takeaway" value={`${metrics.takeawayOrders}`} sub={metrics.takeawayOrders === 1 ? "order" : "orders"} />
      </div>

      <div className="chartRow">
        <div className="chartBlock">
          <h3>Where the money came from</h3>
          <MixDonut mix={mix} money={money} />
        </div>
        <div className="chartBlock">
          <h3>How today was paid</h3>
          <TenderRibbon tender={tender} splitBills={metrics.splitBillCount} money={money} />
        </div>
      </div>

      <div className="chartBlock">
        <h3>How hard each table worked</h3>
        <TableMeters rows={metrics.tablePerformance} money={money} />
      </div>

      <div className="chartRow bottomRow">
        <div className="chartBlock">
          <h3>Famous cafe items</h3>
          <InsightList rows={metrics.itemRankings} valuePrefix="×" />
        </div>
        <div className="historyPanel">
          <h3>Recent settled bills</h3>
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
                      <span>
                        {session.paymentMode ?? (isPerPlayer(session) ? "Split" : "—")} ·{" "}
                        {new Date(session.settledAt ?? 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <span>{isKitchen ? "Takeaway" : formatDuration(totals.minutes)}</span>
                    <strong>{money(totals.total)}</strong>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {receiptSession && (
        <Receipt session={receiptSession} tables={tables} sessions={sessions} now={now} hideMoney={hideMoney} onClose={() => setReceiptSession(null)} />
      )}
    </section>
  );
}

// ====== Money-through-the-day (single-series area, on the felt band) ======

function RevenueArea({
  data,
  peakHour,
  money
}: {
  data: HourRevenue[];
  peakHour?: number;
  money: (value: number) => string;
}) {
  if (data.length === 0) {
    return <div className="chartEmpty onDark">No takings yet today.</div>;
  }
  const W = 720;
  const H = 168;
  const padX = 14;
  const padTop = 30;
  const padBottom = 24;
  const plotW = W - padX * 2;
  const plotH = H - padTop - padBottom;
  const baseY = padTop + plotH;
  const max = Math.max(...data.map((d) => d.total), 1);
  const n = data.length;
  const xAt = (i: number) => (n === 1 ? W / 2 : padX + (i / (n - 1)) * plotW);
  const yAt = (v: number) => padTop + (1 - v / max) * plotH;

  const pts = data.map((d, i) => [xAt(i), yAt(d.total)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `M${xAt(0).toFixed(1)},${baseY} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")} L${xAt(n - 1).toFixed(1)},${baseY} Z`;
  const peakIdx = peakHour != null ? data.findIndex((d) => d.hour === peakHour) : -1;

  // Orient with a few hour ticks: first, peak, last (deduped).
  const tickIdx = Array.from(new Set([0, peakIdx, n - 1].filter((i) => i >= 0))).sort((a, b) => a - b);

  return (
    <svg className="revArea" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Revenue by hour, peaking at ${peakIdx >= 0 ? data[peakIdx].label : ""}`}>
      <defs>
        <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.areaFill} stopOpacity="0.36" />
          <stop offset="1" stopColor={C.areaFill} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <line x1={padX} y1={baseY} x2={W - padX} y2={baseY} className="revAxis" />
      <path d={area} fill="url(#revFill)" />
      <path d={line} className="revLine" style={{ stroke: C.areaLine }} />
      {peakIdx >= 0 && (
        <>
          <line x1={pts[peakIdx][0]} y1={pts[peakIdx][1]} x2={pts[peakIdx][0]} y2={baseY} className="revPeakStem" />
          <circle cx={pts[peakIdx][0]} cy={pts[peakIdx][1]} r="4.5" className="revPeakDot" style={{ fill: C.peak }} />
          <text x={pts[peakIdx][0]} y={pts[peakIdx][1] - 10} className="revPeakLabel" textAnchor={n === 1 ? "middle" : peakIdx === 0 ? "start" : peakIdx === n - 1 ? "end" : "middle"}>
            {money(data[peakIdx].total)}
          </text>
        </>
      )}
      {tickIdx.map((i) => (
        <text key={i} x={xAt(i)} y={H - 6} className="revTick" textAnchor={n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
          {data[i].label}
        </text>
      ))}
    </svg>
  );
}

// ====== Revenue mix (part-to-whole donut) ======

function MixDonut({ mix, money }: { mix: RevenueMix; money: (value: number) => string }) {
  const segs = [
    { key: "table", label: "Table time", value: mix.tableTime, color: C.table },
    { key: "cafe", label: "Cafe", value: mix.dineInCafe, color: C.cafe },
    { key: "takeaway", label: "Takeaway", value: mix.takeaway, color: C.takeaway }
  ].filter((s) => s.value > 0);
  const total = mix.gross;

  if (total <= 0) {
    return <div className="chartEmpty">No sales settled yet.</div>;
  }

  const R = 46;
  const CIRC = 2 * Math.PI * R;
  const GAP = segs.length > 1 ? 3 : 0; // circumference units of surface between arcs
  let offset = 0;

  return (
    <div className="donutWrap">
      <svg className="mixDonut" viewBox="0 0 120 120" role="img" aria-label="Revenue by channel">
        <g transform="rotate(-90 60 60)">
          <circle cx="60" cy="60" r={R} className="donutTrack" />
          {segs.map((s) => {
            const len = (s.value / total) * CIRC;
            const draw = Math.max(0.5, len - GAP);
            const dash = `${draw} ${CIRC - draw}`;
            const el = (
              <circle
                key={s.key}
                cx="60"
                cy="60"
                r={R}
                className="donutArc"
                style={{ stroke: s.color, strokeDasharray: dash, strokeDashoffset: -offset }}
              />
            );
            offset += len;
            return el;
          })}
        </g>
        <text x="60" y="55" className="donutCenterTop">
          GROSS
        </text>
        <text x="60" y="72" className="donutCenterNum">
          {money(total)}
        </text>
      </svg>
      <div className="donutLegend">
        {segs.map((s) => (
          <div className="legendRow" key={s.key}>
            <span className="legendDot" style={{ background: s.color }} />
            <span className="legendLabel">{s.label}</span>
            <span className="legendPct">{Math.round((s.value / total) * 100)}%</span>
            <strong className="legendVal">{money(s.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

// ====== Tender split (the cash-drawer reconciliation ribbon) ======

function TenderRibbon({
  tender,
  splitBills,
  money
}: {
  tender: TenderTotals;
  splitBills: number;
  money: (value: number) => string;
}) {
  const segs = [
    { key: "Cash", label: "Cash", value: tender.Cash, color: C.cash },
    { key: "UPI", label: "UPI", value: tender.UPI, color: C.upi },
    { key: "Card", label: "Card", value: tender.Card, color: C.card },
    { key: "Unknown", label: "Unmarked", value: tender.Unknown, color: C.unknown }
  ].filter((s) => s.value > 0);
  const total = segs.reduce((sum, s) => sum + s.value, 0);

  if (total <= 0) {
    return <div className="chartEmpty">No payments settled yet.</div>;
  }

  return (
    <div className="tenderWrap">
      <div className="drawerLine">
        <span>Expected in drawer</span>
        <strong>{money(tender.Cash)}</strong>
      </div>
      <div className="tenderRibbon" role="img" aria-label="Payment split by tender">
        {segs.map((s) => (
          <span
            key={s.key}
            className="tenderSeg"
            style={{ flexGrow: s.value, background: s.color }}
            title={`${s.label} ${money(s.value)} · ${Math.round((s.value / total) * 100)}%`}
          />
        ))}
      </div>
      <div className="tenderLegend">
        {segs.map((s) => (
          <div className="legendRow" key={s.key}>
            <span className="legendDot" style={{ background: s.color }} />
            <span className="legendLabel">{s.label}</span>
            <span className="legendPct">{Math.round((s.value / total) * 100)}%</span>
            <strong className="legendVal">{money(s.value)}</strong>
          </div>
        ))}
      </div>
      {splitBills > 0 && (
        <p className="tenderNote">
          {splitBills} {splitBills === 1 ? "bill" : "bills"} split across tenders
        </p>
      )}
    </div>
  );
}

// ====== Per-table utilization meters (fuel gauges) ======

function TableMeters({ rows, money }: { rows: TablePerformance[]; money: (value: number) => string }) {
  const active = rows.filter((row) => row.sessions > 0);
  if (active.length === 0) {
    return <div className="chartEmpty">No table sessions settled yet.</div>;
  }
  return (
    <div className="tableMeters">
      {rows.map((row) => {
        const idle = row.sessions === 0;
        return (
          <div className={`meterRow${idle ? " idle" : ""}`} key={row.id}>
            <div className="meterWho">
              <span className={`gameDot ${row.game}`} aria-hidden="true" />
              <span className="meterName">{row.name}</span>
            </div>
            <div className="meterGauge" title={`${Math.round(row.utilization * 100)}% occupied`}>
              <div className="meterTrack">
                <div className="meterFill" style={{ width: `${Math.max(idle ? 0 : 2, row.utilization * 100)}%`, background: C.bar }} />
              </div>
              <span className="meterPct">{idle ? "idle" : `${Math.round(row.utilization * 100)}%`}</span>
            </div>
            <div className="meterMeta">
              {idle ? (
                <span className="meterIdle">no play today</span>
              ) : (
                <>
                  <span>{formatDuration(row.minutes)}</span>
                  {row.game === "snooker" && row.frames > 0 && <span>{row.frames} frames</span>}
                  <span>
                    {row.sessions} {row.sessions === 1 ? "session" : "sessions"}
                  </span>
                </>
              )}
            </div>
            <strong className="meterRev">{money(row.revenue)}</strong>
          </div>
        );
      })}
    </div>
  );
}

// ====== Small pieces ======

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="statCell">
      <p>{label}</p>
      <strong>{value}</strong>
      {sub && <span className="statSub">{sub}</span>}
    </div>
  );
}

function InsightList({ rows, valuePrefix = "" }: { rows: { name: string; value: number | string }[]; valuePrefix?: string }) {
  if (rows.length === 0) {
    return <p className="muted">No settled sales yet.</p>;
  }
  return (
    <>
      {rows.map((row) => (
        <div className="rankRow" key={row.name}>
          <span>{row.name}</span>
          <strong>
            {valuePrefix}
            {row.value}
          </strong>
        </div>
      ))}
    </>
  );
}
