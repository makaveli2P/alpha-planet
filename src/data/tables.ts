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
