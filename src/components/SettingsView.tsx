import React from "react";
import { AlertTriangle, Download, Lock, Plus, Trash2, Unlock, Upload } from "lucide-react";
import { BASE_PLAYERS, DAY_START_HOUR, EXTRA_PLAYER_RATE_PER_HOUR } from "../data/tables";
import { formatHour, formatMoney, formatRatePerMinute, shortCategory } from "../lib/format";
import { parseBackup } from "../lib/storage";
import type { MenuItem, TableConfig } from "../types";

// Static admin PIN that gates editing. Change this to your own code.
const RATES_PIN = "1234";

export function SettingsView({
  tables,
  menu,
  storageBytes,
  saveFailed,
  onExport,
  onImport,
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
  storageBytes: number;
  saveFailed: boolean;
  onExport: () => void;
  onImport: (text: string) => string | undefined; // error message, or undefined when loaded
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
            <button
              type="button"
              className="lockBtn unlocked"
              onClick={() => {
                setUnlocked(false);
                setConfirmingClear(false);
              }}
            >
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

      <div className="stFoot">
        <div className="policyBox stPolicy">
          <h3>Billing policy</h3>
          <p>
            A whole-table bill charges to the minute at the rate stored when its clock started. A rate or price change affects only new sittings
            and new orders.
          </p>
          <p>
            Snooker is loser pays. A frame starts only when staff tap Start frame. When staff end the frame and pick the loser, its table time and
            the table order go on the loser’s tab.
          </p>
          <p>
            A table’s rate covers {BASE_PLAYERS} players. Each extra player adds {formatMoney(EXTRA_PLAYER_RATE_PER_HOUR)}/hr (
            {formatRatePerMinute(EXTRA_PLAYER_RATE_PER_HOUR)}/min) from the moment they join. A player who leaves during a frame still counts
            until that frame ends. Pool keeps its flat rate.
          </p>
          <p>Tabs stay open until the customer pays. Take the payment on the Customers page, days or months later.</p>
          <p>The business day starts at {formatHour(DAY_START_HOUR)}, so a late night counts as one day.</p>
          <button
            type="button"
            className={`ghostAction${confirmingClear ? " confirming" : ""}`}
            disabled={!unlocked}
            title={unlocked ? undefined : "Unlock with the PIN first"}
            onClick={() => {
              if (confirmingClear) {
                clearDemoData();
                setConfirmingClear(false);
              } else {
                setConfirmingClear(true);
              }
            }}
          >
            {confirmingClear ? "Tap again — this deletes every tab" : "Clear sittings, tabs and payments"}
          </button>
        </div>

        <BackupBox storageBytes={storageBytes} saveFailed={saveFailed} onExport={onExport} onImport={onImport} />
      </div>
    </section>
  );
}

// localStorage in most browsers holds about 5 MB for this site.
const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Export the whole state to a .json file, or load one back. Loading replaces
// everything on this device, so it needs a second tap within 3 s.
function BackupBox({
  storageBytes,
  saveFailed,
  onExport,
  onImport
}: {
  storageBytes: number;
  saveFailed: boolean;
  onExport: () => void;
  onImport: (text: string) => string | undefined;
}) {
  const [pending, setPending] = React.useState<{ name: string; text: string; summary: string } | null>(null);
  const [confirmingImport, setConfirmingImport] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);

  // Staff arrive here from the "Not saved" pill: show the backup box first.
  // Scroll only the settings panel (scrollIntoView would also shift the
  // overflow-hidden workspace around it).
  React.useEffect(() => {
    const box = boxRef.current;
    const panel = box?.closest(".settingsPanel");
    if (!saveFailed || !box || !panel) return;
    panel.scrollTop += box.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16;
  }, [saveFailed]);

  React.useEffect(() => {
    if (!confirmingImport) return;
    const timer = window.setTimeout(() => setConfirmingImport(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingImport]);

  async function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file can be picked again
    setError(null);
    setLoaded(null);
    setPending(null);
    setConfirmingImport(false);
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError("The file could not be read.");
      return;
    }
    // Read-only preview, so staff see what the file holds before it replaces anything.
    const preview = parseBackup(text, Date.now());
    if (!preview) {
      setError("That file is not an Alpha Planet backup.");
      return;
    }
    const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    setPending({
      name: file.name,
      text,
      summary: `${count(preview.sessions.length, "sitting")} · ${count(preview.customers.length, "customer")} · ${count(preview.charges.length, "tab charge")}`
    });
  }

  function replaceData() {
    if (!pending) return;
    if (!confirmingImport) {
      setConfirmingImport(true);
      return;
    }
    setConfirmingImport(false);
    const failure = onImport(pending.text);
    if (failure) {
      setError(failure);
      return;
    }
    setLoaded(pending.name);
    setPending(null);
  }

  const share = Math.min(1, storageBytes / STORAGE_LIMIT_BYTES);

  return (
    <div className="policyBox stBackup" ref={boxRef}>
      <h3>Backup</h3>
      {saveFailed && (
        <p className="stSaveWarn" role="alert">
          <AlertTriangle size={15} />
          <span>The last change was not saved on this device. The browser storage is full or blocked. Export a backup now.</span>
        </p>
      )}
      <p>All data lives only in this browser. Export a backup often, and keep the file somewhere safe.</p>

      <div className="stStorage" title={`${storageBytes.toLocaleString("en-IN")} bytes`}>
        <span>
          Storage used: <strong>{formatBytes(storageBytes)}</strong> of about 5 MB
        </span>
        <div className="stStorageTrack">
          <div className={`stStorageFill${share >= 0.8 ? " high" : ""}`} style={{ width: `${Math.max(storageBytes > 0 ? 1 : 0, share * 100)}%` }} />
        </div>
      </div>

      <div className="stBackupActions">
        <button type="button" className="ghostAction" onClick={onExport}>
          <Download size={15} /> Export backup (.json)
        </button>
        <button type="button" className="ghostAction" onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> Import backup
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="stFileInput" onChange={pickFile} aria-label="Backup file" />
      </div>

      {pending && (
        <div className="stPending">
          <p>
            <strong>{pending.name}</strong>
            <span>{pending.summary}</span>
          </p>
          <div className="stBackupActions">
            <button type="button" className={`ghostAction danger${confirmingImport ? " confirming" : ""}`} onClick={replaceData}>
              {confirmingImport ? "Tap again — this replaces all data" : "Replace all data with this backup"}
            </button>
            <button
              type="button"
              className="rowGhostBtn"
              onClick={() => {
                setPending(null);
                setConfirmingImport(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="stError" role="alert">
          {error}
        </p>
      )}
      {loaded && <p className="stLoaded">Loaded {loaded}.</p>}
    </div>
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
