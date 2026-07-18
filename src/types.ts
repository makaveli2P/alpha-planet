export type TableStatus = "available" | "running" | "billing";
export type PaymentMode = "Cash" | "UPI" | "Card";
export type AppView = "floor" | "dashboard" | "settings";

export type TableGame = "snooker" | "american-pool" | "indian-pool";
export type TableOrientation = "portrait" | "landscape";
export type RailColor = "brown" | "black";

export type TableConfig = {
  id: string;
  name: string;
  type: "American Pool" | "Pool" | "Snooker" | "Indian Pool" | "Takeaway";
  game: TableGame;
  orientation: TableOrientation;
  ratePerHour: number;
  x: number;
  y: number;
  w: number;
  h: number;
  felt: "green" | "blue";
  rail: RailColor;
};

export type MenuItem = {
  id: string;
  name: string;
  category: string;
  prices: { label: string; price: number }[];
};

export type OrderLine = {
  lineId: string;
  itemId: string;
  name: string;
  category: string;
  variant: string;
  unitPrice: number;
  quantity: number;
  // Per-player snooker only: which player ordered this line. Undefined = shared
  // (split equally across players). Ignored in single-payer / non-snooker bills.
  playerId?: string;
};

// A single player on a per-player snooker bill. Each player is settled
// individually (own payment mode + receipt); the session settles once every
// player is settled. `satOutFrames` lowers their share of the table charge.
export type PlayerBill = {
  id: string;
  name?: string;
  satOutFrames: number;
  paymentMode?: PaymentMode;
  settledAt?: number;
  // Early checkout: this player left while the table kept running. Their share of
  // the table time is frozen at the moment they left (the remaining players carry
  // the time from then on), so the split still reconciles to the final charge.
  leftAt?: number;
  frozenTableShare?: number;
  frozenSharedCafe?: number;
  frozenFrames?: number;
  frozenMinutes?: number;
  // Joined mid-session (after some frames were already played). Purely for the
  // receipt's "in" time; the frame-share is what actually drives their bill.
  joinedAt?: number;
  // Set once this (settled) stint has spawned a rejoin, so it can't do so twice.
  rejoinedAt?: number;
};

// "table" = one bill for the whole table (the original behavior, also used for
// pool/counter). "per-player" = split the table charge by frames played and
// settle each player separately (snooker default).
export type SplitMode = "table" | "per-player";

export type Session = {
  id: string;
  tableId: string;
  startedAt: number;
  endedAt?: number;
  ratePerHour: number;
  orders: OrderLine[];
  discount: number;
  roundOffEnabled?: boolean;
  paymentMode?: PaymentMode;
  settledAt?: number;
  voidedAt?: number;
  customerName?: string;
  // Per-player snooker billing (all optional; absent = single-payer table bill).
  splitMode?: SplitMode;
  players?: PlayerBill[];
  frameCount?: number;
};

export type AppState = {
  sessions: Session[];
  tables: TableConfig[];
  menu: MenuItem[];
};

export type ClosedSession = Session & { settledAt: number };

export type TableSummary = {
  table: TableConfig;
  session?: Session;
  status: TableStatus;
};

export type BallSpec = {
  id: string;
  x: number;
  y: number;
  color: string;
  stripeColor?: string;
  label?: string;
  size?: "small" | "normal";
  kind?: "solid" | "stripe" | "cue" | "snooker";
};

export type SessionTotals = {
  minutes: number;
  tableCharge: number;
  kitchenTotal: number;
  subtotal: number;
  afterDiscount: number;
  roundOff: number;
  total: number;
};

// One player's slice of a per-player snooker bill. Shares sum EXACTLY to the
// session's tableCharge (table time) and kitchenTotal (cafe), so the per-player
// totals reconcile to the session subtotal with no rupees lost or invented.
export type PlayerTotals = {
  player: PlayerBill;
  index: number;
  framesPlayed: number;
  tableShare: number;      // slice of the table time charge (by frames played)
  ownCafe: number;         // cafe lines assigned to this player
  sharedCafeShare: number; // equal slice of unassigned ("shared") cafe lines
  total: number;           // tableShare + ownCafe + sharedCafeShare
  settled: boolean;
  left: boolean;           // checked out early (table still running for others)
};

export type RankingRow = {
  name: string;
  value: number | string;
};

// Revenue collected in each clock hour of the day (attributed to the hour a
// session STARTED — when the table was occupied — matching the arrivals rhythm).
export type HourRevenue = {
  hour: number;   // 0–23
  label: string;  // e.g. "9 PM"
  total: number;  // ₹ started in this hour
};

// The three mutually-exclusive revenue channels. Their sum is the day's GROSS
// (before discount / round-off); net = Metrics.totalRevenue.
export type RevenueMix = {
  tableTime: number;  // Σ tableCharge over real tables
  dineInCafe: number; // Σ kitchen over real tables (dine-in food/drink)
  takeaway: number;   // Σ total over counter/takeaway orders
  gross: number;      // tableTime + dineInCafe + takeaway
};

// Money collected per tender. Per-player snooker bills credit each player's
// slice to the mode they actually paid with, so one table can span tenders.
export type TenderTotals = {
  Cash: number;
  UPI: number;
  Card: number;
  Unknown: number;
};

// One real table's day: how long it was occupied, what it earned, and — for
// per-player snooker — how many frames were played and heads served.
export type TablePerformance = {
  id: string;
  name: string;
  game: TableGame;
  type: TableConfig["type"];
  minutes: number;
  revenue: number;
  sessions: number;
  frames: number;
  players: number;
  utilization: number; // occupied ÷ open-so-far, 0–1
};

export type Metrics = {
  totalRevenue: number;
  tableRevenue: number;
  kitchenRevenue: number;
  discounts: number;
  takeawayRevenue: number;
  takeawayOrders: number;
  settledSessions: number;
  averageMinutes: number;
  itemRankings: RankingRow[];
  // The day's money shape and composition.
  revenueByHour: HourRevenue[];
  peakHour?: number;      // hour (0–23) with the most revenue, if any
  revenueMix: RevenueMix;
  tenderTotals: TenderTotals;
  splitBillCount: number; // per-player bills settled across >1 tender
  // Per-table performance + the snooker units unlocked by per-player billing.
  tablePerformance: TablePerformance[];
  openMinutes: number;    // minutes since the day's first session began
  totalFrames: number;
  avgFrames: number;      // per snooker (per-player) session
  playersServed: number;  // heads across per-player snooker sessions
};

export type TableHistory = {
  last?: ClosedSession;
  lastTotals?: SessionTotals;
  today: {
    count: number;
    minutes: number;
    revenue: number;
  };
};
