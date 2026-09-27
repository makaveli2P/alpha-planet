import React from "react";
import { createRoot } from "react-dom/client";
import { CustomerDialog } from "./components/CustomerDialog";
import { CustomersPage } from "./components/CustomersPage";
import { Dashboard } from "./components/Dashboard";
import { ManualBillDialog } from "./components/ManualBillDialog";
import { MenuPanel } from "./components/MenuPanel";
import { PayTabDialog } from "./components/PayTabDialog";
import { PlayersPanel } from "./components/PlayersPanel";
import { SettingsView } from "./components/SettingsView";
import { TablePanel } from "./components/TablePanel";
import { TablesList } from "./components/TablesList";
import { TopBar } from "./components/TopBar";
import type { ManualBillActions } from "./components/contracts";
import { counterTable, tables as defaultTables } from "./data/tables";
import {
  billFrame,
  chargeTabTo,
  closeSitting,
  customerInputError,
  addCustomer,
  editCustomer,
  mergeCustomers,
  moveCharge,
  putBillOnNewTab,
  putBillOnTab,
  reassignFrame,
  seatCustomer,
  seatGuest,
  seatNewCustomer,
  settleTab,
  startClock,
  startCounterOrder,
  undoPayment,
  unseat,
  updateActive,
  voidCharge,
  type CustomerInput,
  type PayInput
} from "./lib/appActions";
import { calculateMetrics, calculateSessionTotals, getActiveSession, getTableStatus, sittingAlert } from "./lib/billing";
import { addMenuItem, deleteMenuItem, setMenuItemPrice, setTableName, setTableRate, updateMenuItem } from "./lib/configActions";
import { createId } from "./lib/format";
import { filterMenu, getMenuCategories } from "./lib/menu";
import {
  addOrderToSession,
  cancelFrame,
  changeOrderQuantity,
  endFrame,
  keepPlaying,
  markSessionEnded,
  reopenEndedSession,
  setFrameEnd,
  setFrameStart,
  setSessionDiscount,
  setSessionEnd,
  setSessionName,
  setSessionStart,
  settleEndedSession,
  startFrame,
  toggleSessionRoundOff,
  voidCurrentSession
} from "./lib/sessionActions";
import { manualBillError, recordManualBill, voidManualBill } from "./lib/manualBill";
import { loadAppState, parseBackup, saveAppState, storedBytes } from "./lib/storage";
import type { AppState, AppView, MenuItem, PaymentMode, Session, TableConfig } from "./types";
import "./styles.css";
import "./styles/floor-left.css";
import "./styles/table-panel.css";
import "./styles/customers.css";
import "./styles/misc.css";
import "./styles/manual.css";

export type SettledToast = { label: string; total: number; mode: PaymentMode | "Tab"; tableId: string };

// makeId that hands out the given ids first (so the caller knows them before
// the state update runs), then fresh ones.
function presetIds(...ids: string[]): () => string {
  const queue = [...ids];
  return () => queue.shift() ?? createId();
}

function App() {
  const [state, setState] = React.useState<AppState>(() => loadAppState());
  // Latest committed state, for validation and toasts only — every write goes
  // through a functional update on the current state (never this ref).
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const [saveFailed, setSaveFailed] = React.useState(false);
  const tables = state.tables;
  const [selectedTableId, setSelectedTableId] = React.useState(defaultTables[0].id);
  const [view, setView] = React.useState<AppView>("floor");
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState("All");
  const [now, setNow] = React.useState(Date.now());
  const [hideMoney, setHideMoney] = React.useState(false);
  const [settledToast, setSettledToast] = React.useState<SettledToast | null>(null);
  const [payFor, setPayFor] = React.useState<string | null>(null);
  const [editFor, setEditFor] = React.useState<{ customerId?: string } | null>(null);
  // The manual bill dialog, opened on this table (or "counter").
  const [manualFor, setManualFor] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSaveFailed(!saveAppState(state));
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
      const views: Record<string, AppView> = { "1": "floor", "2": "customers", "3": "dashboard", "4": "settings" };
      if (views[event.key]) {
        event.preventDefault();
        setView(views[event.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (!settledToast) return;
    const timer = window.setTimeout(() => setSettledToast(null), 1700);
    return () => window.clearTimeout(timer);
  }, [settledToast]);

  const commit = React.useCallback((fn: (current: AppState) => AppState) => setState(fn), []);

  const isCounter = selectedTableId === counterTable.id;
  const selectedTable: TableConfig = isCounter ? counterTable : tables.find((table) => table.id === selectedTableId) ?? tables[0];
  const activeSession = getActiveSession(state.sessions, selectedTable.id);
  const metrics = calculateMetrics(state, now);

  // Money on the floor that is not on a tab or paid yet. "Waiting" counts every
  // table in the needs-action colour: a loser to pick, a bill to take, an idle
  // table, or a table order with nobody seated (sittingAlert). An empty counter
  // order has no bill to take yet.
  const liveTotals = state.sessions.reduce(
    (acc, session) => {
      if (session.settledAt) return acc;
      const status = getTableStatus(session);
      const emptyCounter = session.tableId === counterTable.id && session.orders.length === 0;
      const waiting = !emptyCounter && (status === "billing" || status === "awaiting" || sittingAlert(session, now) !== undefined);
      return {
        revenue: acc.revenue + calculateSessionTotals(session, now).total,
        running: acc.running + (status === "running" ? 1 : 0),
        billing: acc.billing + (waiting ? 1 : 0)
      };
    },
    { revenue: 0, running: 0, billing: 0 }
  );

  const categories = getMenuCategories(state.menu);
  const filteredMenu = filterMenu(state.menu, category, search);

  const table = selectedTable;
  const onActive = (fn: (session: Session) => Session) => commit((current) => updateActive(current, table.id, fn));
  const withActiveId = (fn: (current: AppState, sessionId: string) => AppState) =>
    commit((current) => {
      const active = getActiveSession(current.sessions, table.id);
      return active ? fn(current, active.id) : current;
    });

  function toastIfSettled(label: string, sessionId: string, mode: PaymentMode | "Tab") {
    const session = stateRef.current.sessions.find((entry) => entry.id === sessionId);
    if (!session || session.settledAt || !session.endedAt) return;
    const total = calculateSessionTotals(session, Date.now()).total;
    setSettledToast({ label, total, mode, tableId: session.tableId });
  }

  const floorHandlers = {
    // players
    onSeatCustomer: (customerId: string) => commit((current) => seatCustomer(current, table, customerId, Date.now(), createId)),
    onSeatNew: (input: CustomerInput): string | undefined => {
      const error = customerInputError(stateRef.current, input);
      if (error) return error;
      commit((current) => seatNewCustomer(current, table, input, Date.now(), createId));
      return undefined;
    },
    onSeatGuest: () => commit((current) => seatGuest(current, table, Date.now(), createId)),
    onLeave: (seatId: string) => withActiveId((current, sessionId) => unseat(current, sessionId, seatId, Date.now())),
    onPay: (customerId: string) => setPayFor(customerId),
    onEditCustomer: (customerId: string) => setEditFor({ customerId }),
    // frames
    onStartFrame: () => onActive((session) => startFrame(session, Date.now(), createId())),
    onEndFrame: () => onActive((session) => endFrame(session, Date.now())),
    onKeepPlaying: () => onActive(keepPlaying),
    onCancelFrame: () => onActive((session) => cancelFrame(session, Date.now())),
    onSetFrameStart: (frameId: string, at: number) => onActive((session) => setFrameStart(session, frameId, at, Date.now())),
    onSetFrameEnd: (frameId: string, at: number) => onActive((session) => setFrameEnd(session, frameId, at, Date.now())),
    onBillFrame: (seatId: string) => withActiveId((current, sessionId) => billFrame(current, sessionId, seatId, Date.now(), createId)),
    onReassignFrame: (frameId: string, seatId: string) =>
      withActiveId((current, sessionId) => reassignFrame(current, sessionId, frameId, seatId, Date.now())),
    onChargeTabTo: (seatId: string, lineId?: string) =>
      withActiveId((current, sessionId) => chargeTabTo(current, sessionId, seatId, Date.now(), createId, lineId)),
    onCloseTable: () => withActiveId((current, sessionId) => closeSitting(current, sessionId, Date.now())),
    // cafe lines
    onChangeQuantity: (lineId: string, delta: number) => onActive((session) => changeOrderQuantity(session, lineId, delta)),
    // whole bill
    onStartClock: () => commit((current) => startClock(current, table, Date.now(), createId)),
    onStartCounterOrder: () => commit((current) => startCounterOrder(current, Date.now(), createId)),
    onSetName: (value: string) => onActive((session) => setSessionName(session, value)),
    onSetStartTime: (at: number) => onActive((session) => setSessionStart(session, at, Date.now())),
    onSetEndTime: (at: number) => onActive((session) => setSessionEnd(session, at, Date.now())),
    onEndSession: () => onActive((session) => markSessionEnded(session, Date.now())),
    onReopen: () => onActive((session) => reopenEndedSession(session, Date.now())),
    onSettle: (mode: PaymentMode) => {
      if (activeSession) toastIfSettled(activeSession.customerName ? `${table.name} · ${activeSession.customerName}` : table.name, activeSession.id, mode);
      onActive((session) => settleEndedSession(session, mode, Date.now()));
    },
    onPutOnTab: (customerId: string) => {
      const customer = stateRef.current.customers.find((entry) => entry.id === customerId);
      if (activeSession) toastIfSettled(`${table.name} · ${customer?.name ?? "tab"}`, activeSession.id, "Tab");
      withActiveId((current, sessionId) => putBillOnTab(current, sessionId, customerId, Date.now(), createId));
    },
    onPutOnTabNew: (input: CustomerInput): string | undefined => {
      const error = customerInputError(stateRef.current, input);
      if (error) return error;
      if (activeSession) toastIfSettled(`${table.name} · ${input.name.trim()}`, activeSession.id, "Tab");
      withActiveId((current, sessionId) => putBillOnNewTab(current, sessionId, input, Date.now(), createId));
      return undefined;
    },
    onVoid: () => onActive((session) => voidCurrentSession(session, Date.now())),
    onSetDiscount: (value: number) => onActive((session) => setSessionDiscount(session, value)),
    onToggleRoundOff: () => onActive(toggleSessionRoundOff)
  };

  function addOrder(menuItem: MenuItem, price: MenuItem["prices"][number]) {
    onActive((session) => addOrderToSession(session, menuItem, price, createId));
  }

  const customerHandlers = {
    onAddCustomer: (input: CustomerInput): string | undefined => {
      const error = customerInputError(stateRef.current, input);
      if (error) return error;
      commit((current) => addCustomer(current, input, Date.now(), createId).state);
      return undefined;
    },
    onSaveCustomer: (customerId: string, input: CustomerInput): string | undefined => {
      const error = customerInputError(stateRef.current, input, customerId);
      if (error) return error;
      commit((current) => editCustomer(current, customerId, input));
      return undefined;
    },
    onMerge: (fromId: string, intoId: string) => commit((current) => mergeCustomers(current, fromId, intoId)),
    onPay: (customerId: string) => setPayFor(customerId),
    onEdit: (customerId: string) => setEditFor({ customerId }),
    onNew: () => setEditFor({})
  };

  const payHandlers = {
    // Returns the new payment's id; the dialog finds it in state after the update.
    onPayTab: (customerId: string, chargeIds: string[], input: PayInput): string => {
      const paymentId = createId();
      commit((current) => settleTab(current, customerId, chargeIds, input, Date.now(), presetIds(paymentId)).state);
      return paymentId;
    },
    onVoidCharge: (chargeId: string) => commit((current) => voidCharge(current, chargeId, Date.now())),
    onMoveCharge: (chargeId: string, customerId: string) => commit((current) => moveCharge(current, chargeId, customerId)),
    onUndoPayment: (paymentId: string) => commit((current) => undoPayment(current, paymentId))
  };

  const manualHandlers: ManualBillActions = {
    // Validate on the latest state, then record in one update. The dialog finds
    // the records by the draft id (missing = the reducer refused).
    onRecordManual: (input) => {
      const error = manualBillError(stateRef.current, input, Date.now());
      if (error) return { error };
      commit((current) => recordManualBill(current, input, Date.now(), createId));
      return { id: input.id };
    },
    onVoidManual: (sessionId: string) => commit((current) => voidManualBill(current, sessionId, Date.now()))
  };

  function exportBackup() {
    const blob = new Blob([JSON.stringify(stateRef.current, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const day = new Date();
    link.href = url;
    link.download = `alpha-planet-${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importBackup(text: string): string | undefined {
    const next = parseBackup(text, Date.now());
    if (!next) return "That file is not an Alpha Planet backup.";
    setState(next);
    return undefined;
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
        saveFailed={saveFailed}
      />

      <main className="workspace">
        {view === "floor" && (
          <div className="floorGrid">
            <TablesList
              tables={tables}
              sessions={state.sessions}
              now={now}
              selectedId={selectedTable.id}
              onSelect={setSelectedTableId}
              onManualBill={() => setManualFor(selectedTable.id)}
            />
            <PlayersPanel key={`players-${selectedTable.id}`} state={state} table={selectedTable} session={activeSession} now={now} {...floorHandlers} />
            <TablePanel
              key={`table-${selectedTable.id}`}
              state={state}
              table={selectedTable}
              isCounter={isCounter}
              session={activeSession}
              now={now}
              settledInfo={settledToast && settledToast.tableId === selectedTable.id ? settledToast : undefined}
              {...floorHandlers}
            />
            <MenuPanel
              session={activeSession}
              tableName={selectedTable.name}
              search={search}
              setSearch={setSearch}
              category={category}
              setCategory={setCategory}
              categories={categories}
              filteredMenu={filteredMenu}
              addOrder={addOrder}
              changeQuantity={floorHandlers.onChangeQuantity}
              isCounter={isCounter}
            />
          </div>
        )}

        {view === "customers" && <CustomersPage state={state} now={now} hideMoney={hideMoney} {...customerHandlers} />}
        {view === "dashboard" && <Dashboard metrics={metrics} state={state} now={now} hideMoney={hideMoney} />}
        {view === "settings" && (
          <SettingsView
            tables={tables}
            menu={state.menu}
            storageBytes={storedBytes()}
            saveFailed={saveFailed}
            onExport={exportBackup}
            onImport={importBackup}
            clearDemoData={() => setState((current) => ({ ...current, sessions: [], charges: [], payments: [] }))}
            editTableRate={(id, rate) => setState((current) => ({ ...current, tables: setTableRate(current.tables, id, rate) }))}
            editTableName={(id, name) => setState((current) => ({ ...current, tables: setTableName(current.tables, id, name) }))}
            createMenuItem={(name, categoryName, price) => {
              const item: MenuItem = {
                id: createId(),
                name: name.trim(),
                category: categoryName.trim() || "Cafe",
                prices: [{ label: "Regular", price: Math.max(0, Math.round(price) || 0) }]
              };
              if (item.name) setState((current) => ({ ...current, menu: addMenuItem(current.menu, item) }));
            }}
            editMenuItem={(id, patch) => setState((current) => ({ ...current, menu: updateMenuItem(current.menu, id, patch) }))}
            editMenuItemPrice={(id, index, price) => setState((current) => ({ ...current, menu: setMenuItemPrice(current.menu, id, index, price) }))}
            removeMenuItem={(id) => setState((current) => ({ ...current, menu: deleteMenuItem(current.menu, id) }))}
          />
        )}
      </main>

      {payFor && <PayTabDialog state={state} customerId={payFor} now={now} onClose={() => setPayFor(null)} {...payHandlers} />}
      {manualFor && (
        <ManualBillDialog
          state={state}
          tableId={manualFor}
          now={now}
          onClose={() => setManualFor(null)}
          onPayNow={(customerId) => {
            // One overlay at a time: this dialog closes as the pay dialog opens.
            setManualFor(null);
            setPayFor(customerId);
          }}
          {...manualHandlers}
        />
      )}
      {editFor && (
        <CustomerDialog
          state={state}
          customerId={editFor.customerId}
          onClose={() => setEditFor(null)}
          onAdd={customerHandlers.onAddCustomer}
          onSave={customerHandlers.onSaveCustomer}
          onMerge={customerHandlers.onMerge}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
