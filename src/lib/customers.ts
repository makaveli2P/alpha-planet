import type { Customer } from "../types";

// Customer registry helpers: phone normalising, lookup and search.

// Digits only, and an Indian number loses its "91" / "0" prefix so the same
// phone always reads the same: "+91 98765 43210" → "9876543210".
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

// Two numbers are the same phone when their last 10 digits match
// ("+91 98765 43210" = "9876543210").
export function phoneKey(phone: string): string {
  const digits = normalizePhone(phone);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function isValidPhone(phone: string): boolean {
  const digits = normalizePhone(phone);
  return digits.length >= 7 && digits.length <= 15;
}

export function findByPhone(customers: Customer[], phone: string, exceptId?: string): Customer | undefined {
  const key = phoneKey(phone);
  if (!key) return undefined;
  return customers.find((customer) => customer.id !== exceptId && customer.phone && phoneKey(customer.phone) === key);
}

// "Rahul 98765 43210" → name "Rahul", phone "9876543210". Text that is only a
// phone number gives an empty name.
export function splitNameAndPhone(text: string): { name: string; phone?: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^(.*?)[\s,]*(\+?\d[\d\s-]{5,}\d)$/);
  if (match && isValidPhone(match[2])) {
    return { name: match[1].trim(), phone: normalizePhone(match[2]) };
  }
  return { name: trimmed };
}

// Registry search by name (any word start, or anywhere) or phone digits.
// Best matches first: name prefix, then word prefix, then anywhere, then phone.
export function searchCustomers(customers: Customer[], query: string, limit = 8): Customer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const digits = normalizePhone(q);
  const scored: { customer: Customer; score: number }[] = [];
  for (const customer of customers) {
    const name = customer.name.toLowerCase();
    let score = 0;
    if (name.startsWith(q)) score = 4;
    else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 3;
    else if (name.includes(q)) score = 2;
    else if (digits.length >= 3 && customer.phone && normalizePhone(customer.phone).includes(digits)) score = 1;
    if (score > 0) scored.push({ customer, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || Number(Boolean(a.customer.guest)) - Number(Boolean(b.customer.guest)) || a.customer.name.localeCompare(b.customer.name))
    .slice(0, limit)
    .map((entry) => entry.customer);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
