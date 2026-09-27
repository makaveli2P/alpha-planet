import React from "react";
import { Pencil, Search, UserPlus, X } from "lucide-react";
import type { CustomerInput } from "../lib/appActions";
import { payBlockedReason } from "../lib/appActions";
import { isOpenCharge, openTabsTotal, seatOf } from "../lib/billing";
import { initials, searchCustomers } from "../lib/customers";
import { businessDayStart, formatMoney } from "../lib/format";
import type { AppState, Customer } from "../types";
import { dayLabel, formatPhone } from "./Receipt";

export type CustomersPageProps = {
  state: AppState;
  now: number;
  hideMoney: boolean;
  onAddCustomer: (input: CustomerInput) => string | undefined;
  onSaveCustomer: (customerId: string, input: CustomerInput) => string | undefined;
  onMerge: (fromId: string, intoId: string) => void;
  onPay: (customerId: string) => void; // opens the pay dialog
  onEdit: (customerId: string) => void; // opens the customer dialog
  onNew: () => void; // opens the customer dialog in "add" mode
};

type Filter = "open" | "everyone" | "guests";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Open tabs" },
  { id: "everyone", label: "Everyone" },
  { id: "guests", label: "Guests" }
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Row = {
  customer: Customer;
  tab: number;
  tableName?: string; // where they sit now
  lastAt?: number; // latest seat, charge or payment
  firstSeat?: { at: number; tableName: string }; // for a guest's "Snooker 3 · 26 Sep"
};

// "26 Sep" for the business day of `ts`, with the year when it is not this year.
function shortDate(ts: number, now: number): string {
  const day = new Date(businessDayStart(ts));
  const year = day.getFullYear() !== new Date(now).getFullYear() ? ` ${day.getFullYear()}` : "";
  return `${day.getDate()} ${MONTHS[day.getMonth()]}${year}`;
}

// One pass over the state: each customer's open tab, table, last visit and first seat.
function buildRows(state: AppState): Row[] {
  const tableName = (tableId: string) => state.tables.find((table) => table.id === tableId)?.name ?? (tableId === "counter" ? "Cafe" : tableId);
  const tabs = new Map<string, number>();
  const last = new Map<string, number>();
  const first = new Map<string, { at: number; tableId: string }>();
  const bump = (customerId: string, at?: number) => {
    if (at == null) return;
    if ((last.get(customerId) ?? -Infinity) < at) last.set(customerId, at);
  };
  for (const charge of state.charges) {
    if (isOpenCharge(charge)) tabs.set(charge.customerId, (tabs.get(charge.customerId) ?? 0) + charge.total);
    if (!charge.voidedAt) bump(charge.customerId, charge.createdAt);
  }
  for (const payment of state.payments) bump(payment.customerId, payment.at);
  for (const session of state.sessions) {
    if (session.voidedAt) continue;
    for (const seat of session.seats ?? []) {
      bump(seat.customerId, seat.leftAt ?? seat.joinedAt);
      const seen = first.get(seat.customerId);
      if (!seen || seat.joinedAt < seen.at) first.set(seat.customerId, { at: seat.joinedAt, tableId: session.tableId });
    }
  }
  return state.customers.map((customer) => {
    const where = seatOf(state.sessions, customer.id);
    const seat = first.get(customer.id);
    return {
      customer,
      tab: tabs.get(customer.id) ?? 0,
      tableName: where ? tableName(where.session.tableId) : undefined,
      lastAt: last.get(customer.id),
      firstSeat: seat ? { at: seat.at, tableName: tableName(seat.tableId) } : undefined
    };
  });
}

// "Everyone" leaves out old guests: at no table and owing nothing.
function inFilter(row: Row, filter: Filter): boolean {
  if (filter === "open") return row.tab > 0;
  if (filter === "guests") return Boolean(row.customer.guest);
  return !row.customer.guest || row.tab > 0 || Boolean(row.tableName);
}

// Seated first, then the biggest open tab, then by name.
function compareRows(a: Row, b: Row): number {
  return Number(!a.tableName) - Number(!b.tableName) || b.tab - a.tab || a.customer.name.localeCompare(b.customer.name);
}

export function CustomersPage({ state, now, hideMoney, onPay, onEdit, onNew }: CustomersPageProps) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("open");
  const money = (value: number) => (hideMoney ? "₹ •••" : formatMoney(value));

  const rows = React.useMemo(() => buildRows(state), [state]);
  const matched = React.useMemo(() => {
    if (!query.trim()) return null;
    return new Set(searchCustomers(state.customers, query, state.customers.length).map((customer) => customer.id));
  }, [state.customers, query]);

  const byQuery = matched ? rows.filter((row) => matched.has(row.customer.id)) : rows;
  const counts: Record<Filter, number> = {
    open: byQuery.filter((row) => inFilter(row, "open")).length,
    everyone: byQuery.filter((row) => inFilter(row, "everyone")).length,
    guests: byQuery.filter((row) => inFilter(row, "guests")).length
  };
  const shown = byQuery.filter((row) => inFilter(row, filter)).sort(compareRows);
  const seatedCount = rows.filter((row) => row.tableName).length;
  const hiddenGuests = filter === "everyone" ? byQuery.filter((row) => row.customer.guest && !inFilter(row, "everyone")).length : 0;
  // With a search that finds nobody in this filter, offer the filter that has them.
  const otherFilter = shown.length === 0 && matched ? FILTERS.find((entry) => entry.id !== filter && counts[entry.id] > 0) : undefined;

  return (
    <section className="customersPanel cxPage">
      <header className="cxHead">
        <div>
          <p className="eyebrow">Registry · tabs</p>
          <h2>Customers</h2>
          <span className="cxHeadSub">
            {seatedCount} at tables · {money(openTabsTotal(state.charges))} open across tabs
          </span>
        </div>
        <div className="cxTools">
          <label className="searchBox cxSearch">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              placeholder="Search name or phone"
              aria-label="Search customers by name or phone"
            />
            {query && (
              <button className="cxClear" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </label>
          <button className="primaryAction cxNew" onClick={onNew}>
            <UserPlus size={17} /> New customer
          </button>
        </div>
      </header>

      <div className="cxChips" role="tablist" aria-label="Show">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={filter === entry.id}
            className={filter === entry.id ? "active" : ""}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
            <em>{counts[entry.id]}</em>
          </button>
        ))}
      </div>

      <div className="cxTable">
        <div className="cxRow cxRowHead" aria-hidden="true">
          <span>Name</span>
          <span>Phone</span>
          <span>Table</span>
          <span className="cxNum">Open tab</span>
          <span>Last visit</span>
          <span />
        </div>
        <div className="cxRows">
          {shown.map((row) => {
            const { customer } = row;
            const blocked = payBlockedReason(state, customer.id, now);
            return (
              <div className={`cxRow${row.tableName ? " seated" : ""}`} key={customer.id}>
                <div className="cxName">
                  <span className="cxAvatar" aria-hidden="true">{initials(customer.name)}</span>
                  <div>
                    <strong>
                      {customer.name}
                      {customer.guest && <span className="cxGuestTag">guest</span>}
                    </strong>
                    {customer.guest && row.firstSeat && (
                      <span className="cxSub">
                        {row.firstSeat.tableName} · {shortDate(row.firstSeat.at, now)}
                      </span>
                    )}
                  </div>
                </div>
                <span className={customer.phone ? "cxPhone" : "cxPhone cxFaint"}>{customer.phone ? formatPhone(customer.phone) : "—"}</span>
                <span>{row.tableName && <span className="cxAtTable">{row.tableName}</span>}</span>
                <span className={`cxNum cxTab${row.tab > 0 ? "" : " cxFaint"}`}>{row.tab > 0 ? money(row.tab) : "—"}</span>
                <span className={row.lastAt ? "" : "cxFaint"}>{row.lastAt ? dayLabel(row.lastAt, now) : "—"}</span>
                <span className="cxActions">
                  {row.tab > 0 ? (
                    <button className="settleAction mini cxPayBtn" onClick={() => onPay(customer.id)} title={blocked}>
                      Pay
                    </button>
                  ) : (
                    // Nothing owed: past payments (receipts, undo) stay one tap away.
                    state.payments.some((payment) => payment.customerId === customer.id) && (
                      <button className="rowGhostBtn" onClick={() => onPay(customer.id)} aria-label={`Payments of ${customer.name}`}>
                        History
                      </button>
                    )
                  )}
                  <button className="rowGhostBtn" onClick={() => onEdit(customer.id)} aria-label={`Edit ${customer.name}`}>
                    <Pencil size={13} /> Edit
                  </button>
                </span>
              </div>
            );
          })}

          {shown.length === 0 && (
            <div className="cxEmpty">
              {matched ? (
                <>
                  <strong>No one in {FILTERS.find((entry) => entry.id === filter)?.label} matches “{query.trim()}”.</strong>
                  {otherFilter ? (
                    <button className="rowGhostBtn" onClick={() => setFilter(otherFilter.id)}>
                      Show {otherFilter.label} ({counts[otherFilter.id]})
                    </button>
                  ) : (
                    <span>Check the spelling, or add them with New customer.</span>
                  )}
                </>
              ) : filter === "open" ? (
                <>
                  <strong>No open tabs.</strong>
                  <span>Every tab is paid. Frames and cafe put on a player show up here.</span>
                </>
              ) : filter === "guests" ? (
                <>
                  <strong>No guests.</strong>
                  <span>A guest is a player added as “Player N” at a table.</span>
                </>
              ) : (
                <>
                  <strong>No customers yet.</strong>
                  <span>Add one with New customer, or add players at a table.</span>
                </>
              )}
            </div>
          )}

          {hiddenGuests > 0 && (
            <p className="cxFootNote">
              {hiddenGuests} guest{hiddenGuests === 1 ? "" : "s"} with nothing owed {hiddenGuests === 1 ? "is" : "are"} hidden here.{" "}
              <button className="cxLink" onClick={() => setFilter("guests")}>Show guests</button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
