import { Minus, Plus, Search } from "lucide-react";
import type { MenuItem, Session } from "../types";
import { formatMoney, shortCategory } from "../lib/format";

export function MenuPanel({
  search,
  setSearch,
  category,
  setCategory,
  categories,
  filteredMenu,
  activeSession,
  addOrder,
  changeQuantity
}: {
  search: string;
  setSearch: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  categories: string[];
  filteredMenu: MenuItem[];
  activeSession?: Session;
  addOrder: (menuItem: MenuItem, price: MenuItem["prices"][number]) => void;
  changeQuantity: (lineId: string, delta: number) => void;
}) {
  return (
    <section className="menuPanel">
      <header className="sectionHeader compact">
        <div>
          <p className="eyebrow">Cafe</p>
          <h2>Add items</h2>
        </div>
      </header>
      <div className="searchBox">
        <Search size={17} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search menu" />
      </div>
      <div className="categoryRail">
        {categories.map((name) => (
          <button key={name} className={category === name ? "active" : ""} onClick={() => setCategory(name)}>
            {shortCategory(name)}
          </button>
        ))}
      </div>
      <div className="menuList">
        {filteredMenu.map((entry) => (
          <div className="menuItem" key={entry.id}>
            <strong className="menuItemName">{entry.name}</strong>
            <div className="priceButtons">
              {entry.prices.map((price) => {
                const label =
                  price.label === "Regular"
                    ? formatMoney(price.price)
                    : `${price.label} ${formatMoney(price.price)}`;
                const existingLine = activeSession?.orders.find(
                  (line) => line.itemId === entry.id && line.variant === price.label
                );
                if (existingLine) {
                  return (
                    <div key={price.label} className="qtyStepper">
                      <button
                        onClick={() => changeQuantity(existingLine.lineId, -1)}
                        aria-label={`Remove one ${entry.name}`}
                      >
                        <Minus size={12} />
                      </button>
                      <span>{existingLine.quantity}</span>
                      <button
                        onClick={() => changeQuantity(existingLine.lineId, 1)}
                        aria-label={`Add one ${entry.name}`}
                      >
                        <Plus size={12} />
                      </button>
                      <em>{label}</em>
                    </div>
                  );
                }
                return (
                  <button
                    key={price.label}
                    disabled={!activeSession}
                    onClick={() => addOrder(entry, price)}
                  >
                    <Plus size={14} /> {label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
