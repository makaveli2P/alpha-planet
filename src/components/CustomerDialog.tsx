import React from "react";
import { Merge, X } from "lucide-react";
import type { CustomerInput } from "../lib/appActions";
import { customerInputError } from "../lib/appActions";
import { seatOf, tabTotal } from "../lib/billing";
import { searchCustomers } from "../lib/customers";
import { formatMoney } from "../lib/format";
import type { AppState } from "../types";
import { formatPhone, maskedPhone } from "./Receipt";

export type CustomerDialogProps = {
  state: AppState;
  customerId?: string; // undefined = add a new customer
  onClose: () => void;
  onAdd: (input: CustomerInput) => string | undefined;
  onSave: (customerId: string, input: CustomerInput) => string | undefined;
  onMerge: (fromId: string, intoId: string) => void;
};

const CONFIRM_MS = 3000;

// Add a customer, or edit one (name, phone) and merge a duplicate record into
// another. Errors come from the same validator the handlers use.
export function CustomerDialog({ state, customerId, onClose, onAdd, onSave, onMerge }: CustomerDialogProps) {
  const customer = customerId ? state.customers.find((entry) => entry.id === customerId) : undefined;
  const [name, setName] = React.useState(customer?.name ?? "");
  const [phone, setPhone] = React.useState(customer?.phone ? formatPhone(customer.phone) : "");
  // After a failed save, the error follows the fields live until it is fixed.
  const [tried, setTried] = React.useState(false);
  const [mergeQuery, setMergeQuery] = React.useState("");
  const [mergeInto, setMergeInto] = React.useState<string | null>(null);
  const [confirmingMerge, setConfirmingMerge] = React.useState(false);

  React.useEffect(() => {
    if (!confirmingMerge) return;
    const timer = window.setTimeout(() => setConfirmingMerge(false), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirmingMerge]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (customerId && !customer) {
    return (
      <div className="receiptOverlay" role="dialog" aria-modal="true" aria-label="Customer">
        <div className="receiptPaper cxPaper cxEditPaper">
          <button className="receiptClose" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
          <h2 className="cxDialogTitle">Customer not found</h2>
          <p className="cxHint">This record was merged or removed.</p>
          <div className="cxDialogActions">
            <button className="ghostAction" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  const input: CustomerInput = { name, phone: phone.trim() || undefined };
  const error = tried ? customerInputError(state, input, customerId) : undefined;
  const phoneError = error && /phone/i.test(error) ? error : undefined;
  const nameError = error && !phoneError ? error : undefined;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = customerId ? onSave(customerId, input) : onAdd(input);
    if (result) setTried(true);
    else onClose();
  }

  // Merge: the duplicate can't be seated (its seat would move mid-sitting).
  const seatedAt = customerId ? seatOf(state.sessions, customerId) : undefined;
  const seatedTable = seatedAt ? state.tables.find((table) => table.id === seatedAt.session.tableId)?.name ?? "a table" : undefined;
  const target = mergeInto ? state.customers.find((entry) => entry.id === mergeInto) : undefined;
  // Merge into a real record only: a guest can be merged INTO someone, never the other way.
  const others = customerId ? state.customers.filter((entry) => entry.id !== customerId && !entry.guest) : [];
  const matches = mergeQuery.trim() ? searchCustomers(others, mergeQuery, 5) : [];

  return (
    <div className="receiptOverlay" role="dialog" aria-modal="true" aria-label={customer ? "Edit customer" : "New customer"}>
      <div className="receiptPaper cxPaper cxEditPaper">
        <button className="receiptClose" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
        <p className="eyebrow">{customer ? "Edit customer" : "Customer registry"}</p>
        <h2 className="cxDialogTitle">
          {customer ? customer.name : "New customer"}
          {customer?.guest && <span className="cxGuestTag">guest</span>}
        </h2>
        {customer?.guest && <p className="cxHint">Give them a real name or a phone to keep them as a regular customer.</p>}

        <form className="cxForm" onSubmit={submit}>
          <label className={`cxField${nameError ? " invalid" : ""}`}>
            <span>Name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => {
                if (customer?.guest) event.target.select();
              }}
              placeholder="Full name"
              autoComplete="off"
              aria-invalid={Boolean(nameError)}
            />
            {nameError && <em className="cxFieldError">{nameError}</em>}
          </label>
          <label className={`cxField${phoneError ? " invalid" : ""}`}>
            <span>Phone <i>optional</i></span>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="98765 43210"
              autoComplete="off"
              aria-invalid={Boolean(phoneError)}
            />
            {phoneError && <em className="cxFieldError">{phoneError}</em>}
          </label>
          <div className="cxDialogActions">
            <button type="button" className="ghostAction" onClick={onClose}>Cancel</button>
            <button type="submit" className="primaryAction">{customer ? "Save" : "Add customer"}</button>
          </div>
        </form>

        {customer && customerId && (
          <div className="cxMerge">
            <h3>Merge into…</h3>
            <p className="cxHint">
              For a duplicate record. The tab, payments and visits of {customer.name} move to the customer you pick, and this record is removed.
            </p>
            {seatedTable ? (
              <p className="cxNote">At {seatedTable} now. They must leave the table before a merge.</p>
            ) : target ? (
              <div className="cxMergeTarget">
                <div>
                  <strong>{target.name}</strong>
                  <span>
                    {maskedPhone(target.phone)}
                    {tabTotal(state.charges, target.id) > 0 ? ` · tab ${formatMoney(tabTotal(state.charges, target.id))}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="rowGhostBtn"
                  onClick={() => {
                    setMergeInto(null);
                    setConfirmingMerge(false);
                  }}
                >
                  Change
                </button>
                <button
                  type="button"
                  className={`ghostAction danger${confirmingMerge ? " confirming" : ""}`}
                  onClick={() => {
                    if (!confirmingMerge) {
                      setConfirmingMerge(true);
                      return;
                    }
                    onMerge(customerId, target.id);
                    onClose();
                  }}
                >
                  <Merge size={15} /> {confirmingMerge ? "Tap again to merge" : `Merge into ${target.name}`}
                </button>
              </div>
            ) : (
              <>
                <input
                  className="cxInput"
                  value={mergeQuery}
                  onChange={(event) => setMergeQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && mergeQuery) {
                      event.preventDefault();
                      setMergeQuery("");
                    }
                  }}
                  placeholder="Search the customer to keep"
                  aria-label="Search the customer to merge into"
                />
                {matches.length > 0 && (
                  <div className="cxSuggest">
                    {matches.map((entry) => (
                      <button type="button" key={entry.id} onClick={() => setMergeInto(entry.id)}>
                        <strong>
                          {entry.name}
                          {entry.guest && <span className="cxGuestTag">guest</span>}
                        </strong>
                        <span>{maskedPhone(entry.phone)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {mergeQuery.trim() && matches.length === 0 && <p className="cxHint">No one matches “{mergeQuery.trim()}”.</p>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
