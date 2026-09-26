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
  // Loser-pays snooker only (ignored on a whole-table bill). Who pays this line:
  // `playerId` = one player ordered it for themselves. Otherwise it rides the
  // frame it was ordered in and its lowest scorer pays: `frameNo` is stamped
  // when that frame ends; unstamped = the frame still open.
  playerId?: string;
  frameNo?: number;
};

// One player on a loser-pays snooker table. They owe the frames they lost plus
// their own cafe lines, and settle individually (own payment mode + receipt).
// The table's headcount — which sets the rate — counts them from `joinedAt`
// until `leftAt`. A player who leaves keeps their tab and can pay while the
// table plays on; a returning player is added again as a fresh entry.
export type PlayerBill = {
  id: string;
  name?: string;
  joinedAt?: number;
  leftAt?: number;
  paymentMode?: PaymentMode;
  settledAt?: number;
};

// A finished frame. It began where the previous frame ended (the first frame at
// session start) and is billed to its lowest scorer. `endedAt` is absent only on
// the last frame of an ended session: that frame ends with the session, so a
// corrected end time moves it too. `loserId` is absent between End frame and
// the pick of the lowest scorer — the boundary is recorded at the tap, so the
// next frame (and any cafe ordered in it) starts from there.
export type Frame = {
  endedAt?: number;
  loserId?: string;
};

// "table" = one bill for the whole table (pool, the counter, or a snooker party
// paying as one). "frames" = snooker loser-pays: each frame's table time, plus
// the cafe ordered during it, goes on its lowest scorer's tab, and each player
// settles their own tab (snooker default). "per-player" is the retired
// frames-played split; saved sessions that still carry it bill as "table".
export type SplitMode = "table" | "frames" | "per-player";

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
  // Loser-pays snooker billing (all optional; absent = single-payer table bill).
  splitMode?: SplitMode;
  players?: PlayerBill[];
  frames?: Frame[];
  // ₹/hr added per player above the base headcount. Snapshotted at start, like
  // ratePerHour, so a later policy change never re-prices a running table.
  extraPlayerRatePerHour?: number;
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

// One frame of a loser-pays table, derived from the session. A finished frame
// carries its lowest scorer once picked; the open frame (still being played, or
// the last one left unbilled by End session) has none.
export type FrameSummary = {
  no: number;
  startedAt: number;
  endedAt: number;     // resolved end: now, for the frame still being played
  minutes: number;     // whole minutes, for display only
  players: number;     // players at the table at any point during the frame
  tableCharge: number; // ₹ table time, priced by headcount second by second
  cafeTotal: number;   // cafe folded into this frame (its lowest scorer pays)
  total: number;
  loserId?: string;
  open: boolean;
  // Ended (End frame tapped) but its lowest scorer is not picked yet.
  awaiting?: boolean;
  // An ended session's open frame with no billable time, only cafe: resolving
  // it assigns that cafe to a player instead of recording a frame.
  cafeOnly?: boolean;
};

// One player's tab on a loser-pays table. Tabs plus the unbilled frames (the
// open one, and one awaiting its lowest scorer) sum EXACTLY to the session
// subtotal, so no rupee is lost or invented.
export type PlayerTotals = {
  player: PlayerBill;
  index: number;
  framesLost: number;
  tableShare: number; // table time of the frames they lost
  frameCafe: number;  // cafe folded into the frames they lost
  ownCafe: number;    // cafe lines assigned to them directly
  total: number;      // tableShare + frameCafe + ownCafe
  settled: boolean;
  left: boolean;      // left the table (the table may still be running)
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

// Money collected per tender. Loser-pays snooker bills credit each player's tab
// to the mode they actually paid with, so one table can span tenders.
export type TenderTotals = {
  Cash: number;
  UPI: number;
  Card: number;
  Unknown: number;
};

// One real table's day: how long it was occupied, what it earned, and — for
// loser-pays snooker — how many frames were played and heads served.
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
  splitBillCount: number; // loser-pays bills settled across >1 tender
  // Per-table performance + the snooker units unlocked by loser-pays billing.
  tablePerformance: TablePerformance[];
  openMinutes: number;    // minutes since the day's first session began
  totalFrames: number;
  avgFrames: number;      // per loser-pays snooker session
  playersServed: number;  // heads across loser-pays snooker sessions
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
