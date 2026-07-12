import React from "react";
import { Lock, Plus, Trash2, Unlock } from "lucide-react";
import { formatMoney, shortCategory } from "../lib/format";
import type { MenuItem, TableConfig } from "../types";

// Static admin PIN that gates editing. Change this to your own code.
const RATES_PIN = "1234";

export function SettingsView({
  tables,
  menu,
  clearDemoData,
  editTableRate,
  editTableName,
  createMenuItem,
  editMenuItem,
  editMenuItemPrice,
  removeMenuItem
}: {
  tables: TableConfig[];
  menu: MenuItem[];
  clearDemoData: () => void;
  editTableRate: (id: string, rate: number) => void;
  editTableName: (id: string, name: string) => void;
  createMenuItem: (name: string, category: string, price: number) => void;
  editMenuItem: (id: string, patch: Partial<MenuItem>) => void;
  editMenuItemPrice: (id: string, index: number, price: number) => void;
  removeMenuItem: (id: string) => void;
}) {
  const [confirmingClear, setConfirmingClear] = React.useState(false);
  const [unlocked, setUnlocked] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [pinError, setPinError] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newCategory, setNewCategory] = React.useState("");
  const [newPrice, setNewPrice] = React.useState("");

  React.useEffect(() => {
    if (!confirmingClear) return;
    const timer = window.setTimeout(() => setConfirmingClear(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingClear]);

  const snooker = tables.filter((table) => table.game === "snooker");
  const pool = tables.filter((table) => table.game !== "snooker");
  const categories = Array.from(new Set(menu.map((item) => item.category)));

  function tryUnlock(event: React.FormEvent) {
    event.preventDefault();
    if (pin === RATES_PIN) {
      setUnlocked(true);
      setPin("");
      setPinError(false);
    } else {
      setPinError(true);
    }
  }

  function submitNewItem(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    createMenuItem(newName, newCategory, Number(newPrice));
    setNewName("");
    setNewPrice("");
  }

  return (
    <section className="settingsPanel">
      <header className="sectionHeader">
        <div>
          <p className="eyebrow">Setup</p>
          <h2>Rates &amp; menu</h2>
        </div>
        <div className="authControl">
          {unlocked ? (
            <button type="button" className="lockBtn unlocked" onClick={() => setUnlocked(false)}>
              <Unlock size={15} /> Editing — tap to lock
            </button>
          ) : (
            <form className="pinForm" onSubmit={tryUnlock}>
              <Lock size={15} />
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(event) => {
                  setPin(event.target.value);
                  setPinError(false);
                }}
                placeholder="PIN to edit"
                className={pinError ? "error" : ""}
                aria-label="Admin PIN"
              />
              <button type="submit">Unlock</button>
            </form>
          )}
        </div>
      </header>

      <div className="ratesColumns">
        <div className="rateCol">
          <h3>Snooker</h3>
          {snooker.map((table) => (
            <RateRow key={table.id} table={table} unlocked={unlocked} editTableRate={editTableRate} editTableName={editTableName} />
          ))}
        </div>

        <div className="rateCol">
          <h3>Pool</h3>
          {pool.map((table) => (
            <RateRow key={table.id} table={table} unlocked={unlocked} editTableRate={editTableRate} editTableName={editTableName} />
          ))}
        </div>

        <div className="rateCol kitchenCol">
          <h3>Cafe</h3>
          {unlocked && (
            <form className="addItem" onSubmit={submitNewItem}>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New item name" aria-label="New item name" />
              <div className="addItemRow">
                <input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="Category"
                  list="rates-categories"
                  aria-label="Category"
                />
                <input
                  type="number"
                  min="0"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="₹"
                  aria-label="Price"
                />
                <button type="submit" aria-label="Add item"><Plus size={15} /> Add</button>
              </div>
              <datalist id="rates-categories">
                {categories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </form>
          )}

          <div className="kitchenList">
            {categories.map((cat) => (
              <div className="kitchenGroup" key={cat}>
                <p className="catLabel">{shortCategory(cat)}</p>
                {menu
                  .filter((item) => item.category === cat)
                  .map((item) => (
                    <MenuRow
                      key={item.id}
                      item={item}
                      unlocked={unlocked}
                      editMenuItem={editMenuItem}
                      editMenuItemPrice={editMenuItemPrice}
                      removeMenuItem={removeMenuItem}
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="policyBox">
        <h3>Billing policy</h3>
        <p>Billed to the minute against the rate stored when the session started. Editing a rate or price only affects new sessions and orders.</p>
        <button
          type="button"
          className={`ghostAction${confirmingClear ? " confirming" : ""}`}
          onClick={() => {
            if (confirmingClear) {
              clearDemoData();
              setConfirmingClear(false);
            } else {
              setConfirmingClear(true);
            }
          }}
        >
          {confirmingClear ? "Tap again to confirm" : "Clear session data"}
        </button>
      </div>
    </section>
  );
}

function RateRow({
  table,
  unlocked,
  editTableRate,
  editTableName
}: {
  table: TableConfig;
  unlocked: boolean;
  editTableRate: (id: string, rate: number) => void;
  editTableName: (id: string, name: string) => void;
}) {
  return (
    <div className={`rateRow2${unlocked ? " editing" : ""}${table.ratePerHour >= 1200 ? " premium" : ""}`}>
      {unlocked ? (
        <input
          className="nameEdit"
          defaultValue={table.name}
          onBlur={(e) => editTableName(table.id, e.target.value)}
          aria-label={`${table.name} name`}
        />
      ) : (
        <div className="rateInfo">
          <strong>{table.name}</strong>
          <span>{table.type}</span>
        </div>
      )}
      <div className="rateVal">
        <span className="cur">₹</span>
        {unlocked ? (
          <input
            className="rateEdit"
            type="number"
            min="0"
            defaultValue={table.ratePerHour}
            onBlur={(e) => editTableRate(table.id, Number(e.target.value))}
            aria-label={`${table.name} rate`}
          />
        ) : (
          <strong>{table.ratePerHour.toLocaleString("en-IN")}</strong>
        )}
        <em>/hr</em>
      </div>
    </div>
  );
}

function MenuRow({
  item,
  unlocked,
  editMenuItem,
  editMenuItemPrice,
  removeMenuItem
}: {
  item: MenuItem;
  unlocked: boolean;
  editMenuItem: (id: string, patch: Partial<MenuItem>) => void;
  editMenuItemPrice: (id: string, index: number, price: number) => void;
  removeMenuItem: (id: string) => void;
}) {
  if (!unlocked) {
    return (
      <div className="menuRow">
        <span className="mName">{item.name}</span>
        <span className="mPrice">
          {item.prices.map((p) => `${p.label !== "Regular" ? `${p.label} ` : ""}${formatMoney(p.price)}`).join("  ·  ")}
        </span>
      </div>
    );
  }
  return (
    <div className="menuRow editing">
      <input
        className="mNameEdit"
        defaultValue={item.name}
        onBlur={(e) => editMenuItem(item.id, { name: e.target.value.trim() || item.name })}
        aria-label={`${item.name} name`}
      />
      <div className="mPrices">
        {item.prices.map((p, index) => (
          <label key={p.label} className="mPriceEdit">
            <span>{p.label !== "Regular" ? p.label : "₹"}</span>
            <input
              type="number"
              min="0"
              defaultValue={p.price}
              onBlur={(e) => editMenuItemPrice(item.id, index, Number(e.target.value))}
              aria-label={`${item.name} ${p.label} price`}
            />
          </label>
        ))}
      </div>
      <button className="delBtn" type="button" onClick={() => removeMenuItem(item.id)} aria-label={`Delete ${item.name}`}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}
