import { AlertTriangle, Circle, Eye, EyeOff, LayoutDashboard, Settings, Timer, Users } from "lucide-react";
import type { AppView, Metrics } from "../types";
import { formatMoney } from "../lib/format";

export function TopBar({
  view,
  setView,
  metrics,
  liveTotals,
  hideMoney,
  onToggleMoney,
  saveFailed = false
}: {
  view: AppView;
  setView: (view: AppView) => void;
  metrics: Metrics;
  liveTotals: { revenue: number; running: number; billing: number };
  hideMoney: boolean;
  onToggleMoney: () => void;
  saveFailed?: boolean;
}) {
  const money = (value: number) => (hideMoney ? "₹ •••" : formatMoney(value));
  return (
    <header className="topBar">
      <div className="brandBlock">
        <div className="brandMark">
          <Circle size={18} fill="currentColor" strokeWidth={0} />
        </div>
        <div>
          <p className="eyebrow">Counter System</p>
          <h1>The Alpha Planet</h1>
        </div>
      </div>

      <nav className="navTabs" aria-label="Main navigation">
        <button className={view === "floor" ? "active" : ""} onClick={() => setView("floor")}>
          <Timer size={18} /> Floor
        </button>
        <button className={view === "customers" ? "active" : ""} onClick={() => setView("customers")}>
          <Users size={18} /> Customers
        </button>
        <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
          <LayoutDashboard size={18} /> Dashboard
        </button>
        <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
          <Settings size={18} /> Rates
        </button>
      </nav>

      {/* The browser refused the last save (storage full or blocked): say so
          until a save works again, and lead staff to the backup. */}
      {saveFailed && (
        <button
          type="button"
          className="tbSavePill"
          onClick={() => setView("settings")}
          title="Not saved — export a backup (Rates)"
          role="alert"
        >
          <AlertTriangle size={15} />
          <span>
            <strong>Not saved</strong>
            <em>Export a backup (Rates)</em>
          </span>
        </button>
      )}

      <button
        className="privacyToggle"
        onClick={onToggleMoney}
        aria-label={hideMoney ? "Show amounts" : "Hide amounts"}
        title={hideMoney ? "Show amounts" : "Hide amounts"}
      >
        {hideMoney ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>

      <div className="daySnapshot" title="Money taken today: bills paid at the counter and tab payments">
        <p className="eyebrow">Collected today</p>
        <strong>{money(metrics.collected)}</strong>
        <span>{money(metrics.toTabs)} to tabs</span>
      </div>

      <div className="liveSnapshot" title="Money on the tables now that is not on a tab yet">
        <p className="eyebrow">Live</p>
        <strong>{money(liveTotals.revenue)}</strong>
        <span>
          <em className={liveTotals.running > 0 ? "active" : ""}>{liveTotals.running} running</em>
          {" · "}
          <em className={liveTotals.billing > 0 ? "billing" : ""} title="Frames waiting for a loser, bills waiting for payment, idle tables, table orders to charge">
            {liveTotals.billing} waiting
          </em>
        </span>
      </div>
    </header>
  );
}
