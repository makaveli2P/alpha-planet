import { Circle, Eye, EyeOff, LayoutDashboard, Settings, Timer } from "lucide-react";
import type { AppView, Metrics } from "../types";
import { formatMoney } from "../lib/format";

export function TopBar({
  view,
  setView,
  metrics,
  liveTotals,
  hideMoney,
  onToggleMoney
}: {
  view: AppView;
  setView: (view: AppView) => void;
  metrics: Metrics;
  liveTotals: { revenue: number; running: number; billing: number };
  hideMoney: boolean;
  onToggleMoney: () => void;
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
        <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
          <LayoutDashboard size={18} /> Dashboard
        </button>
        <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
          <Settings size={18} /> Rates
        </button>
      </nav>

      <button
        className="privacyToggle"
        onClick={onToggleMoney}
        aria-label={hideMoney ? "Show amounts" : "Hide amounts"}
        title={hideMoney ? "Show amounts" : "Hide amounts"}
      >
        {hideMoney ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>

      <div className="daySnapshot">
        <p className="eyebrow">Today</p>
        <strong>{money(metrics.totalRevenue)}</strong>
        <span>{metrics.settledSessions} settled</span>
      </div>

      <div className="liveSnapshot">
        <p className="eyebrow">Live</p>
        <strong>{money(liveTotals.revenue)}</strong>
        <span>
          <em className={liveTotals.running > 0 ? "active" : ""}>{liveTotals.running} running</em>
          {" · "}
          <em className={liveTotals.billing > 0 ? "billing" : ""}>{liveTotals.billing} billing</em>
        </span>
      </div>
    </header>
  );
}
