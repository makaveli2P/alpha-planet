// available = free · seated = players at the table, nothing running ·
// running = a frame or the whole-table clock is running · awaiting = a frame
// ended and waits for its lowest scorer · billing = a whole-table bill ended,
// not settled.
export type TableStatus = "available" | "seated" | "running" | "awaiting" | "billing";
export type PaymentMode = "Cash" | "UPI" | "Card";
export type AppView = "floor" | "customers" | "dashboard" | "settings";

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
};

// A person in the customer registry. Staff add known players to a table from
// here; a player added as "Player N" is a guest customer. Tabs (charges) and
// payments hang off the customer, so a tab can be settled days or months later.
export type Customer = {
  id: string;
  name: string;
  phone?: string;   // digits only; unique among customers when present
  guest?: boolean;  // made at a table as "Player N"; naming them in the registry clears it
  createdAt: number;
};

export type ChargeItem = { name: string; variant: string; unitPrice: number; quantity: number };

// One line on a customer's tab. Amounts are snapshotted when the charge is
// made, so a tab reads the same months later.
// frame = a frame they lost (table time + the table's cafe folded into it) ·
// cafe = cafe charged straight to them · bill = a whole bill put on their tab ·
// carry = what was left unpaid by a part payment (not new sales).
export type Charge = {
  id: string;
  customerId: string;
  createdAt: number;
  kind: "frame" | "cafe" | "bill" | "carry";
  sessionId?: string;
  tableId?: string;
  tableName: string;
  frameNo?: number;
  minutes?: number;    // frame length, for display
  players?: number;    // players at the table during the frame
  tableCharge: number; // table-time part
  items: ChargeItem[]; // cafe part
  adjust?: number;     // bill only: −discount + round-off, so total = tableCharge + Σitems + adjust
  total: number;
  paymentId?: string;  // set once paid
  voidedAt?: number;   // a voided charge counts nowhere
  fromPaymentId?: string; // carry only: the part payment that left it
  manual?: true;       // made by a manual bill (play the floor did not record)
};

// Money taken against a tab. It closes exactly the charges listed: `amount` is
// what was received, `discount` what was let off, and anything still owed
// becomes a new "carry" charge on the same tab.
export type Payment = {
  id: string;
  customerId: string;
  at: number;
  mode: PaymentMode;
  amount: number;
  discount: number;
  chargeIds: string[];
  carryChargeId?: string;
};

// A player seated at a table. The rate counts them from `joinedAt` until
// `leftAt`. A returning player gets a new seat.
export type Seat = {
  id: string;
  customerId: string;
  joinedAt: number;
  leftAt?: number;
};

// A loser-pays frame. Staff start it; it never starts by itself. `endedAt`
// set without `chargeId` = ended, waiting for its lowest scorer.
export type Frame = {
  id: string;
  startedAt: number;
  endedAt?: number;
  chargeId?: string;
};

// "frames" = loser pays: frames bill their lowest scorer's tab, and the
// sitting itself bills nothing. "table" = one bill for the whole table on a
// clock (pool, the counter, a party paying together). "per-player" = the
// retired frames-played split; old saved sessions bill as "table".
export type SplitMode = "table" | "frames" | "per-player";

// One sitting at a table (or one counter order).
export type Session = {
  id: string;
  tableId: string;
  startedAt: number;
  endedAt?: number;
  ratePerHour: number;
  orders: OrderLine[]; // whole-table: the bill items · frames: the table tab
  discount: number;
  roundOffEnabled?: boolean;
  paymentMode?: PaymentMode;
  settledAt?: number;
  voidedAt?: number;
  customerName?: string;
  splitMode?: SplitMode;
  seats?: Seat[];
  frames?: Frame[];
  // ₹/hr added per player above the base headcount. Snapshotted at start, like
  // ratePerHour, so a later policy change never re-prices a running table.
  extraPlayerRatePerHour?: number;
  tabChargeId?: string; // a whole bill put on a customer's tab
  legacy?: unknown;     // old-shape fields parked by the migration; never read
  // A manual bill: play the floor did not record, entered afterwards. It is
  // settled when it is made and counts on the business day it was entered.
  manual?: true;
};

// Who a manual bill goes to: a customer in the registry, or someone new who
// joins the registry in the same update.
export type ManualPayer = { customerId: string } | { name: string; phone?: string };

// What the manual bill dialog sends. `id` is made once per draft, so a double
// tap can never save two bills. `tableId` is a table id or "counter" (then
// `mode`, the day and the times are ignored). `dayOffset` 0 = today's business
// day, up to 6. `start`/`end` are "HH:MM", or "" when not entered. `players`
// prices loser pays on snooker only. `discount` and `tender` apply to the
// whole table and the counter only; loser pays always goes on the loser's tab.
export type ManualBillInput = {
  id: string;
  tableId: string;
  mode: "frames" | "table";
  dayOffset: number;
  start: string;
  end: string;
  players: number;
  orders: OrderLine[];
  discount: number;
  payer?: ManualPayer;
  tender?: PaymentMode | "Tab";
};

export type AppState = {
  schemaVersion: 2;
  sessions: Session[];
  tables: TableConfig[];
  menu: MenuItem[];
  menuVersion: number; // the data/menu.ts version the saved menu came from
  customers: Customer[];
  charges: Charge[];
  payments: Payment[];
};

export type ClosedSession = Session & { settledAt: number };

export type TableSummary = {
  table: TableConfig;
  session?: Session;
  status: TableStatus;
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

// A frame of the current sitting as the UI shows it.
export type FrameView = {
  frame: Frame;
  no: number;
  minutes: number;
  players: number;     // seats present at any point during the frame
  tableCharge: number; // priced by headcount (live while running)
  state: "running" | "awaiting" | "billed";
  charge?: Charge;     // once billed
};

export type RankingRow = {
  name: string;
  value: number | string;
};

// Sales in each clock hour of the day (a whole-table bill by the hour its
// sitting STARTED; a tab charge by the hour it was made).
export type HourRevenue = {
  hour: number;   // 0–23
  label: string;  // e.g. "9 PM"
  total: number;  // ₹ started in this hour
};

// The three mutually-exclusive sales channels. Their sum is the day's GROSS
// (before discount / round-off); net = Metrics.totalRevenue.
export type RevenueMix = {
  tableTime: number;  // table time: whole-table bills + frames
  dineInCafe: number; // cafe at the tables (bills, frames, cafe charges)
  takeaway: number;   // counter/takeaway orders
  gross: number;      // tableTime + dineInCafe + takeaway
};

// Money collected today per tender: bills settled at the counter plus tab
// payments. "Unknown" holds old bills saved without a tender.
export type TenderTotals = {
  Cash: number;
  UPI: number;
  Card: number;
  Unknown: number;
};

// One real table's day: how long it was busy, what it earned, frames played
// and players seated.
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
  utilization: number; // busy ÷ open-so-far, 0–1
};

export type Metrics = {
  totalRevenue: number;   // sales today (earned, after discounts)
  collected: number;      // money taken today: settled bills + tab payments
  toTabs: number;         // charges added to tabs today
  openTabs: number;       // every unpaid charge, any day
  tabPayments: number;    // tab payments taken today
  tableRevenue: number;
  kitchenRevenue: number;
  discounts: number;
  takeawayRevenue: number;
  takeawayOrders: number;
  settledSessions: number; // bills today: settled whole-table/counter bills + billed frames
  averageMinutes: number;
  itemRankings: RankingRow[];
  revenueByHour: HourRevenue[];
  peakHour?: number;       // hour (0–23) with the most sales, if any
  revenueMix: RevenueMix;
  tenderTotals: TenderTotals;
  tablePerformance: TablePerformance[];
  openMinutes: number;     // minutes since the day's first activity
  totalFrames: number;
  avgFrames: number;       // per loser-pays sitting
  playersServed: number;   // distinct customers seated today
};

// What the selected free table did today (shown on its empty panel).
export type TableHistory = {
  lastAt?: number;
  today: {
    sittings: number;
    frames: number;
    minutes: number;
    revenue: number;
  };
};
