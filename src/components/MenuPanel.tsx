import React from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import type { MenuItem, Session } from "../types";
import { tableTabTotal } from "../lib/billing";
import { formatMoney, shortCategory } from "../lib/format";
import { findOrderLine } from "../lib/sessionActions";
import { orderWords } from "./OrderLines";

export function MenuPanel({
  session,
  tableName,
  search,
  setSearch,
  category,
  setCategory,
  categories,
  filteredMenu,
  addOrder,
  changeQuantity,
  isCounter = false
}: {
  session?: Session;
  tableName: string;
  search: string;
  setSearch: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  categories: string[];
  filteredMenu: MenuItem[];
  addOrder: (menuItem: MenuItem, price: MenuItem["prices"][number]) => void;
  changeQuantity: (lineId: string, delta: number) => void;
  isCounter?: boolean;
}) {
  // A search covers the whole menu, so "All" is the active chip while it runs.
  const searching = search.trim() !== "";
  const activeCategory = searching ? "All" : category;
  // Headings mark each category in a list of many categories. They also tell
  // apart a dish printed on two pages (each with its own price).
  const grouped = activeCategory === "All";

  return (
    <section className="menuPanel">
      <header className="sectionHeader compact">
        <div>
          <p className="eyebrow">Cafe</p>
          {/* Names the table that a tap adds to, where staff look while they browse. */}
          <h2>Add to {isCounter ? "Takeaway" : tableName}</h2>
        </div>
      </header>
      <div className="searchBox">
        <Search size={17} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSearch("");
          }}
          placeholder="Search menu"
        />
        {search && (
          <button type="button" className="mpClear" onClick={() => setSearch("")} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </div>
      {/* Every category at once, in the printed menu's page order, so the chips
          never move. */}
      <div className="categoryRail mpCats">
        {categories.map((name) => (
          <button
            key={name}
            className={activeCategory === name ? "active" : ""}
            onClick={() => {
              setSearch("");
              setCategory(name);
            }}
          >
            {shortCategory(name)}
          </button>
        ))}
      </div>
      <div className="menuList">
        {filteredMenu.length === 0 && (
          <p className="muted mpEmpty">{searching ? `No items match “${search.trim()}”.` : "No items in this category."}</p>
        )}
        {filteredMenu.map((entry, index) => (
          <React.Fragment key={entry.id}>
            {grouped && entry.category !== filteredMenu[index - 1]?.category && <p className="mpGroup">{entry.category}</p>}
            <div className="menuItem">
              <strong className="menuItemName">{entry.name}</strong>
              <div className="priceButtons">
                {entry.prices.map((price) => {
                  const label = price.label === "Regular" ? formatMoney(price.price) : `${price.label} ${formatMoney(price.price)}`;
                  // The stepper drives the sitting's own line: the table order on
                  // a loser-pays table, the bill items on a whole bill.
                  const existingLine = findOrderLine(session, entry, price);
                  if (existingLine) {
                    return (
                      <div key={price.label} className="qtyStepper">
                        <button onClick={() => changeQuantity(existingLine.lineId, -1)} aria-label={`Remove one ${entry.name}`}>
                          <Minus size={12} />
                        </button>
                        <span>{existingLine.quantity}</span>
                        <button onClick={() => changeQuantity(existingLine.lineId, 1)} aria-label={`Add one ${entry.name}`}>
                          <Plus size={12} />
                        </button>
                        <em>{label}</em>
                      </div>
                    );
                  }
                  return (
                    <button key={price.label} disabled={!session} onClick={() => addOrder(entry, price)}>
                      <Plus size={14} /> {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>

      {session ? (
        <OrderSummary session={session} isCounter={isCounter} />
      ) : (
        <p className="mpHint">{isCounter ? "Start an order first" : "Add a player or start the clock first"}</p>
      )}
    </section>
  );
}

// One line under the menu: what the sitting's list holds. The list itself is in
// the Table column (OrderLines); this confirms each add at a glance.
function OrderSummary({ session, isCounter }: { session: Session; isCounter: boolean }) {
  const words = orderWords(session, isCounter);
  const units = session.orders.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <div className="mpSum">
      <span>{units > 0 ? `${words.title} · ${units} ${units === 1 ? "item" : "items"}` : words.empty}</span>
      {units > 0 && <strong>{formatMoney(tableTabTotal(session))}</strong>}
    </div>
  );
}
