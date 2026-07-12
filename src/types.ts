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
};

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

export type RankingRow = {
  name: string;
  value: number | string;
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
  tableRankings: RankingRow[];
  itemRankings: RankingRow[];
  peakHours: RankingRow[];
  paymentModes: RankingRow[];
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
