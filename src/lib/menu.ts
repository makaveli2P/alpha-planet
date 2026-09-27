import type { MenuItem } from "../types";

// "All" plus the categories in menu-data order (src/data/menu.ts lists the
// printed menu's pages in order), so the chips never move during the night.
export function getMenuCategories(menu: MenuItem[]) {
  return ["All", ...new Set(menu.map((entry) => entry.category))];
}

// True when `query` is in `name` at the start of a word: at the start of the
// name, or after a space or punctuation. Both are lowercase. "tea" is at a word
// start in "Black Tea" but not in "Steamed Momos"; "ice tea" is in "Lemon Ice Tea".
function atWordStart(name: string, query: string): boolean {
  for (let at = name.indexOf(query); at !== -1; at = name.indexOf(query, at + 1)) {
    if (at === 0 || !/[a-z0-9]/.test(name[at - 1])) return true;
  }
  return false;
}

// A search looks through the whole menu, whatever category is selected, so an
// item is never hidden behind the wrong chip. When a name has a word that
// starts with the search, only those names match ("tea" lists the teas, not
// the Steamed Momos). When no name has one, a name that contains the search
// matches ("rita" finds Margherita Pizza). Results keep menu order.
export function filterMenu(menu: MenuItem[], category: string, search: string) {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) return menu.filter((entry) => category === "All" || entry.category === category);
  const wordStarts = menu.filter((entry) => atWordStart(entry.name.toLowerCase(), normalizedSearch));
  if (wordStarts.length > 0) return wordStarts;
  return menu.filter((entry) => entry.name.toLowerCase().includes(normalizedSearch));
}
