import React from "react";
import { createRoot } from "react-dom/client";
import { BillPanel } from "./components/BillPanel";
import { Dashboard } from "./components/Dashboard";
import { FloorBoard } from "./components/FloorBoard";
import { MenuPanel } from "./components/MenuPanel";
import { SettingsView } from "./components/SettingsView";
import { TopBar } from "./components/TopBar";
import { tables as defaultTables } from "./data/tables";
import {
  calculateMetrics,
  calculateSessionTotals,
  getActiveSession,
  getTableHistory,
  getTableStatus
} from "./lib/billing";
import {
  addMenuItem,
  deleteMenuItem,
  setMenuItemPrice,
  setTableName,
  setTableRate,
  updateMenuItem
} from "./lib/configActions";
import { createId } from "./lib/format";
import { filterMenu, getMenuCategories } from "./lib/menu";
import {
  addOrderToSession,
  assignOrderToPlayer,
  changeOrderQuantity,
  createCounterOrder,
  createSession,
  endPlayerSession,
  markSessionEnded,
  reopenEndedSession,
  rejoinAsNewStint,
  rejoinPlayer,
  setPlayerFramesPlayed,
  setPlayerName,
  setSessionDiscount,
  setSessionEnd,
  setSessionFrameCount,
  setSessionName,
  setSessionPlayerCount,
  setSessionSplitMode,
  setSessionStart,
  settleEndedSession,
  settlePlayer,
  toggleSessionRoundOff,
  unsettlePlayer,
  voidCurrentSession
} from "./lib/sessionActions";
import { loadAppState, saveAppState } from "./lib/storage";
import type { AppState, AppView, MenuItem, PaymentMode, Session, SplitMode, TableConfig } from "./types";
import "./styles.css";

// The cafe/takeaway station — a cafe-only order with no physical table.
const COUNTER_TABLE: TableConfig = {
  id: "counter",
  name: "Cafe",
  type: "Takeaway",
  game: "snooker",
  orientation: "portrait",
  ratePerHour: 0,
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  felt: "green",
  rail: "brown"
};

function App() {
  const [state, setState] = React.useState<AppState>(() => loadAppState());
  // Rates and menu are editable at runtime (persisted in state).
  const tables = state.tables;
  const menu = state.menu;
  const [selectedTableId, setSelectedTableId] = React.useState(defaultTables[0].id);
  const [view, setView] = React.useState<AppView>("floor");
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState("All");
  const [now, setNow] = React.useState(Date.now());
  const [hideMoney, setHideMoney] = React.useState(false);
  const [confirmingEnd, setConfirmingEnd] = React.useState(false);
  const [confirmingVoid, setConfirmingVoid] = React.useState(false);
  const [settledToast, setSettledToast] = React.useState<{ label: string; total: number; mode: PaymentMode; tableId: string } | null>(null);

  React.useEffect(() => {
    saveAppState(state);
  }, [state]);

  React.useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  React.useEffect(() => {
    const sync = () => setNow(Date.now());
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "1") {
        event.preventDefault();
        setView("floor");
      } else if (event.key === "2") {
        event.preventDefault();
        setView("dashboard");
      } else if (event.key === "3") {
        event.preventDefault();
        setView("settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (!confirmingEnd) return;
    const timer = window.setTimeout(() => setConfirmingEnd(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingEnd]);

  React.useEffect(() => {
    if (!confirmingVoid) return;
    const timer = window.setTimeout(() => setConfirmingVoid(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingVoid]);

  React.useEffect(() => {
    setConfirmingEnd(false);
    setConfirmingVoid(false);
  }, [selectedTableId]);

  React.useEffect(() => {
    if (!settledToast) return;
    const timer = window.setTimeout(() => setSettledToast(null), 1700);
    return () => window.clearTimeout(timer);
  }, [settledToast]);

  const isCounter = selectedTableId === COUNTER_TABLE.id;
  const selectedTable = isCounter ? COUNTER_TABLE : tables.find((table) => table.id === selectedTableId) ?? tables[0];
  const activeSession = getActiveSession(state.sessions, selectedTable.id);
  const counterSession = getActiveSession(state.sessions, COUNTER_TABLE.id);
  const tableSummaries = tables.map((table) => {
    const session = getActiveSession(state.sessions, table.id);
    return { table, session, status: getTableStatus(session) };
  });

  const metrics = calculateMetrics(state.sessions, now, tables);
  const liveTotals = tableSummaries.reduce(
    (acc, { session, status }) => {
      if (!session) return acc;
      const totals = calculateSessionTotals(session, now);
      return {
        revenue: acc.revenue + totals.total,
        running: acc.running + (status === "running" ? 1 : 0),
        billing: acc.billing + (status === "billing" ? 1 : 0)
      };
    },
    { revenue: 0, running: 0, billing: 0 }
  );
  // An open counter order is live money too, even though it isn't a table.
  if (counterSession) {
    liveTotals.revenue += calculateSessionTotals(counterSession, now).total;
  }
  const categories = getMenuCategories(menu, state.sessions, now);
  const filteredMenu = filterMenu(menu, category, search);
  const tableHistory = !activeSession && !isCounter ? getTableHistory(state.sessions, selectedTable.id, now) : undefined;

  function updateSession(sessionId: string, updater: (session: Session) => Session) {
    setState((current) => ({
      ...current,
      sessions: current.sessions.map((session) => (session.id === sessionId ? updater(session) : session))
    }));
  }

  function startSession(table: TableConfig) {
    const session = createSession(table, Date.now(), createId(), createId);

    setState((current) => {
      if (getActiveSession(current.sessions, table.id)) return current;
      return { ...current, sessions: [session, ...current.sessions] };
    });
    setSelectedTableId(table.id);
    setConfirmingEnd(false);
    setConfirmingVoid(false);
  }

  function startCounterOrder() {
    setState((current) => {
      if (getActiveSession(current.sessions, COUNTER_TABLE.id)) return current;
      const session = createCounterOrder(COUNTER_TABLE.id, Date.now(), createId());
      return { ...current, sessions: [session, ...current.sessions] };
    });
    setSelectedTableId(COUNTER_TABLE.id);
    setConfirmingEnd(false);
    setConfirmingVoid(false);
  }

  function selectTable(table: TableConfig) {
    setSelectedTableId(table.id);
  }

  function addOrder(menuItem: MenuItem, price: MenuItem["prices"][number]) {
    const session = activeSession;
    if (!session) return;
    updateSession(session.id, (current) => addOrderToSession(current, menuItem, price, createId));
  }

  function changeQuantity(lineId: string, delta: number) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => changeOrderQuantity(session, lineId, delta));
  }

  function endSession() {
    if (!activeSession || activeSession.endedAt) return;
    updateSession(activeSession.id, (session) => markSessionEnded(session, Date.now()));
  }

  function reopenSession() {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => reopenEndedSession(session, Date.now()));
  }

  function settleSession(paymentMode: PaymentMode) {
    if (!activeSession || !activeSession.endedAt) return;
    const totals = calculateSessionTotals(activeSession, Date.now());
    const label = activeSession.customerName
      ? `${selectedTable.name} · ${activeSession.customerName}`
      : selectedTable.name;
    updateSession(activeSession.id, (session) => settleEndedSession(session, paymentMode, Date.now()));
    setConfirmingEnd(false);
    setConfirmingVoid(false);
    setSettledToast({ label, total: totals.total, mode: paymentMode, tableId: selectedTable.id });
  }

  // ====== Per-player snooker billing handlers ======

  function changeSplitMode(mode: SplitMode) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => setSessionSplitMode(session, mode, createId));
  }

  function changePlayerCount(count: number) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => setSessionPlayerCount(session, count, createId, Date.now()));
  }

  function changePlayerName(playerId: string, name: string) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => setPlayerName(session, playerId, name));
  }

  function changePlayerFramesPlayed(playerId: string, framesPlayed: number) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => setPlayerFramesPlayed(session, playerId, framesPlayed));
  }

  function changeFrameCount(count: number) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => setSessionFrameCount(session, count));
  }

  function assignOrder(lineId: string, playerId?: string) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => assignOrderToPlayer(session, lineId, playerId));
  }

  function settlePlayerBill(playerId: string, mode: PaymentMode) {
    if (!activeSession || !activeSession.endedAt) return;
    const when = Date.now();
    const updated = settlePlayer(activeSession, playerId, mode, when);
    updateSession(activeSession.id, () => updated);
    // When the last player pays, the whole table closes — confirm like a settle.
    if (updated.settledAt) {
      const totals = calculateSessionTotals(activeSession, when);
      const label = activeSession.customerName
        ? `${selectedTable.name} · ${activeSession.customerName}`
        : selectedTable.name;
      setConfirmingEnd(false);
      setConfirmingVoid(false);
      setSettledToast({ label, total: totals.total, mode, tableId: selectedTable.id });
    }
  }

  function undoPlayerSettle(playerId: string) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => unsettlePlayer(session, playerId));
  }

  // Checking a player out = they leave AND pay in one step (freeze their share of
  // the time so far, then record the tender). The table keeps running for the rest.
  function leaveAndSettle(playerId: string, mode: PaymentMode) {
    if (!activeSession || activeSession.endedAt) return;
    const when = Date.now();
    const left = endPlayerSession(activeSession, playerId, when);
    const updated = settlePlayer(left, playerId, mode, when);
    updateSession(activeSession.id, () => updated);
    if (updated.settledAt) {
      // That was the last person — the whole table is now closed.
      const totals = calculateSessionTotals(activeSession, when);
      const label = activeSession.customerName
        ? `${selectedTable.name} · ${activeSession.customerName}`
        : selectedTable.name;
      setConfirmingEnd(false);
      setConfirmingVoid(false);
      setSettledToast({ label, total: totals.total, mode, tableId: selectedTable.id });
    }
  }

  function rejoinPlayerBill(playerId: string) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => rejoinPlayer(session, playerId));
  }

  function rejoinPlayerStint(playerId: string) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => rejoinAsNewStint(session, playerId, createId, Date.now()));
  }

  function setName(value: string) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => setSessionName(session, value));
  }

  function setStartTime(startedAt: number) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => setSessionStart(session, startedAt, Date.now()));
  }

  function setEndTime(endedAt: number) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => setSessionEnd(session, endedAt, Date.now()));
  }

  function voidSession() {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => voidCurrentSession(session, Date.now()));
  }

  function setDiscount(value: number) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => setSessionDiscount(session, value));
  }

  function toggleRoundOff() {
    if (!activeSession) return;
    updateSession(activeSession.id, toggleSessionRoundOff);
  }

  function clearDemoData() {
    setState((current) => ({ ...current, sessions: [] }));
  }

  function editTableRate(id: string, rate: number) {
    setState((current) => ({ ...current, tables: setTableRate(current.tables, id, rate) }));
  }

  function editTableName(id: string, name: string) {
    setState((current) => ({ ...current, tables: setTableName(current.tables, id, name) }));
  }

  function createMenuItem(name: string, categoryName: string, price: number) {
    const item: MenuItem = {
      id: createId(),
      name: name.trim(),
      category: categoryName.trim() || "Cafe",
      prices: [{ label: "Regular", price: Math.max(0, Math.round(price) || 0) }]
    };
    if (!item.name) return;
    setState((current) => ({ ...current, menu: addMenuItem(current.menu, item) }));
  }

  function editMenuItem(id: string, patch: Partial<MenuItem>) {
    setState((current) => ({ ...current, menu: updateMenuItem(current.menu, id, patch) }));
  }

  function editMenuItemPrice(id: string, index: number, price: number) {
    setState((current) => ({ ...current, menu: setMenuItemPrice(current.menu, id, index, price) }));
  }

  function removeMenuItem(id: string) {
    setState((current) => ({ ...current, menu: deleteMenuItem(current.menu, id) }));
  }

  return (
    <div className="appShell">
      <TopBar
        view={view}
        setView={setView}
        metrics={metrics}
        liveTotals={liveTotals}
        hideMoney={hideMoney}
        onToggleMoney={() => setHideMoney((value) => !value)}
      />

      <main className="workspace">
        {view === "floor" && (
          <div className="floorGrid">
            <section className="floorPanel">
              <header className="sectionHeader">
                <div>
                  <p className="eyebrow">Live floor</p>
                  <h2>Tables</h2>
                </div>
                <div className="legend">
                  <span><i className="dot available" /> Free</span>
                  <span><i className="dot running" /> Running</span>
                  <span><i className="dot billing" /> Billing</span>
                </div>
              </header>

              <FloorBoard
                now={now}
                selectedTableId={selectedTableId}
                tableSummaries={tableSummaries}
                onSelectTable={selectTable}
                counterSession={counterSession}
                counterSelected={isCounter}
                onSelectCounter={() => setSelectedTableId(COUNTER_TABLE.id)}
              />
            </section>

            <BillPanel
              selectedTable={selectedTable}
              activeSession={activeSession}
              now={now}
              tables={tables}
              sessions={state.sessions}
              tableHistory={tableHistory}
              isCounter={isCounter}
              startCounterOrder={startCounterOrder}
              setName={setName}
              setStartTime={setStartTime}
              setEndTime={setEndTime}
              settledInfo={settledToast && settledToast.tableId === selectedTable.id ? settledToast : undefined}
              confirmingEnd={confirmingEnd}
              setConfirmingEnd={setConfirmingEnd}
              confirmingVoid={confirmingVoid}
              setConfirmingVoid={setConfirmingVoid}
              startSession={startSession}
              endSession={endSession}
              reopenSession={reopenSession}
              settleSession={settleSession}
              voidSession={voidSession}
              setDiscount={setDiscount}
              toggleRoundOff={toggleRoundOff}
              changeQuantity={changeQuantity}
              changeSplitMode={changeSplitMode}
              changePlayerCount={changePlayerCount}
              changePlayerName={changePlayerName}
              changePlayerFramesPlayed={changePlayerFramesPlayed}
              changeFrameCount={changeFrameCount}
              assignOrder={assignOrder}
              settlePlayerBill={settlePlayerBill}
              undoPlayerSettle={undoPlayerSettle}
              leaveAndSettle={leaveAndSettle}
              rejoinPlayerBill={rejoinPlayerBill}
              rejoinPlayerStint={rejoinPlayerStint}
            />

            <MenuPanel
              search={search}
              setSearch={setSearch}
              category={category}
              setCategory={setCategory}
              categories={categories}
              filteredMenu={filteredMenu}
              activeSession={activeSession}
              addOrder={addOrder}
              changeQuantity={changeQuantity}
            />
          </div>
        )}

        {view === "dashboard" && <Dashboard metrics={metrics} sessions={state.sessions} tables={tables} now={now} hideMoney={hideMoney} />}
        {view === "settings" && (
          <SettingsView
            tables={tables}
            menu={menu}
            clearDemoData={clearDemoData}
            editTableRate={editTableRate}
            editTableName={editTableName}
            createMenuItem={createMenuItem}
            editMenuItem={editMenuItem}
            editMenuItemPrice={editMenuItemPrice}
            removeMenuItem={removeMenuItem}
          />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
