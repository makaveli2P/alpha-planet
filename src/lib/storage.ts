import type { AppState, Charge, Customer, Payment, Session, TableConfig } from "../types";
import { tables as defaultTables } from "../data/tables";
import { MENU_VERSION, menu as defaultMenu } from "../data/menu";
import { convertV1FramesSession, type NameBook, type V1FramesSession } from "./legacyFrames";
import { createId } from "./format";

const STORAGE_KEY = "alpha-planet-counter-v1";

function defaults(): AppState {
  return { schemaVersion: 2, sessions: [], tables: defaultTables, menu: defaultMenu, menuVersion: MENU_VERSION, customers: [], charges: [], payments: [] };
}

type StoredState = Partial<Omit<AppState, "schemaVersion">> & { schemaVersion?: number };

// Bring data saved before the customer registry (schemaVersion < 2) forward.
// v1 loser-pays sittings become tab charges and payments with the exact amounts
// v1 billed; other sessions just park their old per-player fields.
export function migrate(stored: StoredState, now: number, makeId: () => string = createId): AppState {
  const tables: TableConfig[] = stored.tables?.length ? stored.tables : defaultTables;
  const base: AppState = {
    schemaVersion: 2,
    sessions: stored.sessions ?? [],
    tables,
    // A menu saved from an older data/menu.ts gives way to the current one.
    menu: stored.menu?.length && stored.menuVersion === MENU_VERSION ? stored.menu : defaultMenu,
    menuVersion: MENU_VERSION,
    customers: stored.customers ?? [],
    charges: stored.charges ?? [],
    payments: stored.payments ?? []
  };
  if (stored.schemaVersion === 2) return base;

  const customers: Customer[] = [...base.customers];
  const charges: Charge[] = [...base.charges];
  const payments: Payment[] = [...base.payments];
  const byName: NameBook = new Map();
  const sessions: Session[] = base.sessions.map((raw) => {
    const old = raw as Session & { players?: unknown; frames?: unknown };
    if (old.splitMode === "frames") {
      const tableName = tables.find((table) => table.id === old.tableId)?.name ?? old.tableId;
      const converted = convertV1FramesSession(old as unknown as V1FramesSession, tableName, now, makeId, byName);
      customers.push(...converted.customers);
      charges.push(...converted.charges);
      payments.push(...converted.payments);
      return converted.session;
    }
    if (old.players !== undefined || old.frames !== undefined) {
      const { players, frames, ...rest } = old;
      return { ...rest, legacy: { players, frames } } as Session;
    }
    return old;
  });
  return { ...base, sessions, customers, charges, payments };
}

// Keep the raw saved data under a side key before a migration (once) or when
// it can't be read, so the next save can never destroy the only copy.
function backup(raw: string, suffix: string) {
  try {
    const key = `${STORAGE_KEY}-backup-${suffix}`;
    if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
  } catch {
    // Out of quota: nothing more we can do here.
  }
}

export function loadAppState(): AppState {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaults();
    const parsed = JSON.parse(stored) as StoredState;
    if (parsed.schemaVersion !== 2) backup(stored, "before-v2");
    return migrate(parsed, Date.now());
  } catch {
    if (stored) backup(stored, `unreadable-${Date.now()}`);
    return defaults();
  }
}

// Returns false when the browser refused to save (usually storage full), so
// the app can say so instead of silently losing tabs.
export function saveAppState(state: AppState): boolean {
  const data = JSON.stringify(state);
  try {
    localStorage.setItem(STORAGE_KEY, data);
    return true;
  } catch {
    // Storage full: the side backups are the first thing to give up (the live
    // data matters more), then try once more.
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`${STORAGE_KEY}-backup-`)) localStorage.removeItem(key);
      }
      localStorage.setItem(STORAGE_KEY, data);
      return true;
    } catch {
      return false;
    }
  }
}

// Bytes the saved state takes (UTF-16 in localStorage ≈ 2 bytes per char).
export function storedBytes(): number {
  try {
    return (localStorage.getItem(STORAGE_KEY)?.length ?? 0) * 2;
  } catch {
    return 0;
  }
}

// A backup file's contents → a full state, or undefined if it isn't one.
export function parseBackup(text: string, now: number): AppState | undefined {
  try {
    const parsed = JSON.parse(text) as StoredState;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sessions)) return undefined;
    return migrate(parsed, now);
  } catch {
    return undefined;
  }
}
