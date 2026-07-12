import type { AppState } from "../types";
import { tables as defaultTables } from "../data/tables";
import { menu as defaultMenu } from "../data/menu";

const STORAGE_KEY = "alpha-planet-counter-v1";

function defaults(): AppState {
  return { sessions: [], tables: defaultTables, menu: defaultMenu };
}

export function loadAppState(): AppState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppState>;
      return {
        sessions: parsed.sessions ?? [],
        // Rates/menu are editable and persisted; fall back to the hardcoded
        // defaults for a fresh device or older saved data.
        tables: parsed.tables?.length ? parsed.tables : defaultTables,
        menu: parsed.menu?.length ? parsed.menu : defaultMenu
      };
    }
  } catch {
    return defaults();
  }
  return defaults();
}

export function saveAppState(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota/security failures must not bubble out of the render effect.
  }
}
