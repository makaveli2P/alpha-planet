import type { CustomerInput, PayInput } from "../lib/appActions";
import type { AppState, ManualBillInput, PaymentMode, Session, TableConfig } from "../types";

// The props contract between main.tsx and the floor components. Every action
// is a fire-and-forget state update, except the two that return an error
// message for inline display.
export type FloorActions = {
  // players
  onSeatCustomer: (customerId: string) => void;
  onSeatNew: (input: CustomerInput) => string | undefined; // error message, or undefined when seated
  onSeatGuest: () => void;
  onLeave: (seatId: string) => void;
  onPay: (customerId: string) => void; // opens the pay dialog
  onEditCustomer: (customerId: string) => void; // opens the customer dialog
  // loser-pays frames
  onStartFrame: () => void;
  onEndFrame: () => void;
  onKeepPlaying: () => void;
  onCancelFrame: () => void;
  onSetFrameStart: (frameId: string, at: number) => void;
  onSetFrameEnd: (frameId: string, at: number) => void;
  onBillFrame: (seatId: string) => void;
  onReassignFrame: (frameId: string, seatId: string) => void;
  onChargeTabTo: (seatId: string, lineId?: string) => void; // one unit of a line, or the whole table order
  onCloseTable: () => void;
  // cafe lines (the table order, the bill items, the counter order)
  onChangeQuantity: (lineId: string, delta: number) => void;
  // whole bill / counter
  onStartClock: () => void;
  onStartCounterOrder: () => void;
  onSetName: (value: string) => void;
  onSetStartTime: (at: number) => void;
  onSetEndTime: (at: number) => void;
  onEndSession: () => void;
  onReopen: () => void;
  onSettle: (mode: PaymentMode) => void;
  onPutOnTab: (customerId: string) => void;
  onPutOnTabNew: (input: CustomerInput) => string | undefined; // add to the registry and put the bill on their tab
  onVoid: () => void;
  onSetDiscount: (value: number) => void;
  onToggleRoundOff: () => void;
};

export type FloorProps = {
  state: AppState;
  table: TableConfig;
  session?: Session;
  now: number;
};

export type PayActions = {
  onPayTab: (customerId: string, chargeIds: string[], input: PayInput) => string; // returns the payment id
  onVoidCharge: (chargeId: string) => void;
  onMoveCharge: (chargeId: string, customerId: string) => void;
  onUndoPayment: (paymentId: string) => void;
};

export type SettledInfo = { label: string; total: number; mode: PaymentMode | "Tab" };

// The tender buttons, in one order in every flow: staff tap by position.
export const TENDERS: PaymentMode[] = ["Cash", "UPI", "Card"];

// The manual bill dialog. Record returns the draft id when the bill is on
// record, or the reason it is not; the dialog then finds its records by id.
export type ManualBillActions = {
  onRecordManual: (input: ManualBillInput) => { id: string } | { error: string };
  onVoidManual: (sessionId: string) => void;
};
