import type { MenuItem, TableConfig } from "../types";

// Editing rates/menu only changes what a NEW session or order snapshots — active
// sessions keep their snapshotted ratePerHour and order lines keep their unitPrice.

export function setTableRate(tables: TableConfig[], id: string, rate: number): TableConfig[] {
  const safe = Number.isFinite(rate) ? Math.max(0, Math.round(rate)) : 0;
  return tables.map((table) => (table.id === id ? { ...table, ratePerHour: safe } : table));
}

export function setTableName(tables: TableConfig[], id: string, name: string): TableConfig[] {
  const trimmed = name.trim();
  return tables.map((table) => (table.id === id ? { ...table, name: trimmed || table.name } : table));
}

export function addMenuItem(menu: MenuItem[], item: MenuItem): MenuItem[] {
  return [...menu, item];
}

export function updateMenuItem(menu: MenuItem[], id: string, patch: Partial<MenuItem>): MenuItem[] {
  return menu.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
}

export function setMenuItemPrice(menu: MenuItem[], id: string, index: number, price: number): MenuItem[] {
  const safe = Number.isFinite(price) ? Math.max(0, Math.round(price)) : 0;
  return menu.map((entry) =>
    entry.id === id
      ? { ...entry, prices: entry.prices.map((p, i) => (i === index ? { ...p, price: safe } : p)) }
      : entry
  );
}

export function deleteMenuItem(menu: MenuItem[], id: string): MenuItem[] {
  return menu.filter((entry) => entry.id !== id);
}
