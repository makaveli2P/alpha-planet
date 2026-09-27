import type { TableConfig } from "../types";

// Floor is laid out as a real room: five snooker tables along the top run,
// the two pool tables on the lower run. x/y/w/h are percentages of the board.
// Table numbering runs from the RIGHT — Snooker 1 (premium, ₹1,200) is the
// rightmost table, stepping down leftward. Pool 1 sits on the right of its run.
// Rendering keys off `game`: american-pool gets rail diamonds.
export const tables: TableConfig[] = [
  { id: "t4", name: "Snooker 1", type: "Snooker", game: "snooker", orientation: "portrait", ratePerHour: 1200, x: 80.5, y: 4, w: 16.5, h: 36, felt: "green", rail: "brown" },
  { id: "t3", name: "Snooker 2", type: "Snooker", game: "snooker", orientation: "portrait", ratePerHour: 800, x: 61, y: 4, w: 16.5, h: 36, felt: "green", rail: "brown" },
  { id: "t2", name: "Snooker 3", type: "Snooker", game: "snooker", orientation: "portrait", ratePerHour: 400, x: 41.5, y: 4, w: 16.5, h: 36, felt: "green", rail: "brown" },
  { id: "t1", name: "Snooker 4", type: "Snooker", game: "snooker", orientation: "portrait", ratePerHour: 240, x: 22, y: 4, w: 16.5, h: 36, felt: "green", rail: "brown" },
  { id: "t7", name: "Snooker 5", type: "Snooker", game: "snooker", orientation: "portrait", ratePerHour: 240, x: 2.5, y: 4, w: 16.5, h: 36, felt: "green", rail: "brown" },
  { id: "t5", name: "Pool 2", type: "American Pool", game: "american-pool", orientation: "landscape", ratePerHour: 240, x: 6, y: 60, w: 38, h: 24, felt: "blue", rail: "black" },
  { id: "t6", name: "Pool 1", type: "Indian Pool", game: "indian-pool", orientation: "portrait", ratePerHour: 240, x: 50, y: 52, w: 18, h: 36, felt: "green", rail: "brown" }
];

// Snooker loser-pays pricing: a table's rate covers up to BASE_PLAYERS players,
// and each player above that adds ₹0.5/min (₹30/hr) from the moment they join.
// Within a frame the rate never drops: a player who leaves still counts until
// the frame ends (billing.frameHeadcountAt). On the ₹240/hr tables that is
// ₹4/min for 2 players, ₹4.5 for 3, ₹5 for 4.
export const BASE_PLAYERS = 2;
export const EXTRA_PLAYER_RATE_PER_HOUR = 30;

// The venue's business day starts at 6 AM, so a late night (say 23:00–01:30)
// counts as one day in "today" totals, bill numbers and tab day groups.
export const DAY_START_HOUR = 6;

// The cafe/takeaway station: counter orders with no physical table.
export const counterTable: TableConfig = {
  id: "counter",
  name: "Cafe",
  type: "Takeaway",
  game: "snooker",
  orientation: "portrait",
  ratePerHour: 0,
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  felt: "green",
  rail: "brown"
};
