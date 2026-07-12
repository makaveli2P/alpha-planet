import type { MenuItem, Session } from "../types";

export function getMenuCategories(menu: MenuItem[], sessions: Session[], now: number) {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const usageByCategory = new Map<string, number>();
  for (const session of sessions) {
    if (!session.settledAt || session.voidedAt || session.settledAt < startOfDay.getTime()) continue;
    for (const line of session.orders) {
      usageByCategory.set(line.category, (usageByCategory.get(line.category) ?? 0) + line.quantity);
    }
  }

  const baseCategories = Array.from(new Set(menu.map((entry) => entry.category)));
  return [
    "All",
    ...baseCategories.sort((a, b) => (usageByCategory.get(b) ?? 0) - (usageByCategory.get(a) ?? 0))
  ];
}

export function filterMenu(menu: MenuItem[], category: string, search: string) {
  const normalizedSearch = search.trim().toLowerCase();
  return menu.filter((entry) => {
    const matchesCategory = category === "All" || entry.category === category;
    const matchesSearch = !normalizedSearch || entry.name.toLowerCase().includes(normalizedSearch);
    return matchesCategory && matchesSearch;
  });
}
