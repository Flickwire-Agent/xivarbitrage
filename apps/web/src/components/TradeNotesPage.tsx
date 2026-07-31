import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import {
  TRADE_NOTE_STATUSES,
  type TradeNote,
  type TradeNoteDraft,
  type TradeNoteStatus,
  useTradeNotesStore,
} from "../stores/tradeNotesStore.js";

const emptyDraft: TradeNoteDraft = {
  itemId: 0,
  itemName: "",
  buyWorld: "",
  sellLocation: "",
  buyPrice: 0,
  expectedSellPrice: 0,
  quantity: 1,
  notes: "",
  status: "planned",
};

function draftFromSearch(): TradeNoteDraft {
  const params = new URLSearchParams(window.location.search);
  const number = (key: string, fallback: number) => Number(params.get(key)) || fallback;
  return {
    ...emptyDraft,
    itemId: number("itemId", 0),
    itemName: params.get("itemName") ?? "",
    buyWorld: params.get("buyWorld") ?? "",
    sellLocation: params.get("sellLocation") ?? "",
    buyPrice: number("buyPrice", 0),
    expectedSellPrice: number("expectedSellPrice", 0),
    quantity: number("quantity", 1),
  };
}

function noteToDraft({
  id: _,
  createdAt: __,
  updatedAt: ___,
  ...draft
}: TradeNote): TradeNoteDraft {
  return draft;
}

export function TradeNotesPage() {
  const [location, navigate] = useLocation();
  const { notes, createNote, updateNote, deleteNote } = useTradeNotesStore();
  const [draft, setDraft] = useState<TradeNoteDraft>(draftFromSearch);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | TradeNoteStatus>("all");

  useEffect(() => {
    document.title = "Trade Notes | XIV Arbitrage";
    if (location === "/notes/new") setDraft(draftFromSearch());
  }, [location]);

  const filteredNotes = notes.filter(
    (note) => statusFilter === "all" || note.status === statusFilter,
  );
  const setField = <K extends keyof TradeNoteDraft>(key: K, value: TradeNoteDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !draft.itemName.trim() ||
      !Number.isSafeInteger(draft.itemId) ||
      draft.itemId <= 0 ||
      !Number.isFinite(draft.buyPrice) ||
      draft.buyPrice < 0 ||
      !Number.isFinite(draft.expectedSellPrice) ||
      draft.expectedSellPrice < 0 ||
      !Number.isSafeInteger(draft.quantity) ||
      draft.quantity <= 0
    )
      return;
    if (editingId) updateNote(editingId, draft);
    else createNote(draft);
    setEditingId(null);
    setDraft(emptyDraft);
    navigate("/notes");
  }

  return (
    <section className="tradeNotesPage">
      <div className="pageHeading">
        <p className="eyebrow">Personal ledger</p>
        <h1>Trade notes</h1>
        <p>Keep a local record of trades you plan, buy, list, sell, or abandon.</p>
      </div>
      <form className="tradeNoteForm" onSubmit={submit}>
        <h2>{editingId ? "Edit trade note" : "Add a trade note"}</h2>
        <div className="tradeNoteFields">
          <label className="selectField">
            Item name
            <input
              required
              value={draft.itemName}
              onChange={(e) => setField("itemName", e.target.value)}
            />
          </label>
          <label className="numberField">
            Item ID
            <input
              required
              min="1"
              type="number"
              value={draft.itemId || ""}
              onChange={(e) => setField("itemId", Number(e.target.value))}
            />
          </label>
          <label className="selectField">
            Buy world
            <input value={draft.buyWorld} onChange={(e) => setField("buyWorld", e.target.value)} />
          </label>
          <label className="selectField">
            Sell world or DC
            <input
              value={draft.sellLocation}
              onChange={(e) => setField("sellLocation", e.target.value)}
            />
          </label>
          <label className="numberField">
            Buy price
            <input
              min="0"
              type="number"
              value={draft.buyPrice || ""}
              onChange={(e) => setField("buyPrice", Number(e.target.value))}
            />
          </label>
          <label className="numberField">
            Expected sell price
            <input
              min="0"
              type="number"
              value={draft.expectedSellPrice || ""}
              onChange={(e) => setField("expectedSellPrice", Number(e.target.value))}
            />
          </label>
          <label className="numberField">
            Quantity
            <input
              required
              min="1"
              type="number"
              value={draft.quantity}
              onChange={(e) => setField("quantity", Number(e.target.value))}
            />
          </label>
          <label className="selectField">
            Status
            <select
              value={draft.status}
              onChange={(e) => setField("status", e.target.value as TradeNoteStatus)}
            >
              {TRADE_NOTE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="selectField">
          Notes
          <textarea
            value={draft.notes}
            onChange={(e) => setField("notes", e.target.value)}
            rows={4}
          />
        </label>
        <div className="tradeNoteActions">
          <button className="iconButton" type="submit">
            {editingId ? "Save changes" : "Save note"}
          </button>
          {editingId ? (
            <button
              className="textButton"
              type="button"
              onClick={() => {
                setEditingId(null);
                setDraft(emptyDraft);
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>
      <div className="tradeNotesHeader">
        <h2>Saved notes</h2>
        <label className="selectField">
          Filter status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | TradeNoteStatus)}
          >
            <option value="all">All statuses</option>
            {TRADE_NOTE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>
      {filteredNotes.length === 0 ? (
        <div className="notice">No trade notes match this filter yet.</div>
      ) : (
        <div className="tradeNotesList">
          {filteredNotes.map((note) => (
            <article className="tradeNote" key={note.id}>
              <div>
                <p className="eyebrow">{note.status}</p>
                <h3>{note.itemName}</h3>
                <p>
                  {note.buyWorld || "Buy location undecided"} to{" "}
                  {note.sellLocation || "sell location undecided"}
                </p>
              </div>
              <dl>
                <div>
                  <dt>Buy</dt>
                  <dd>{note.buyPrice.toLocaleString()} gil</dd>
                </div>
                <div>
                  <dt>Expected sale</dt>
                  <dd>{note.expectedSellPrice.toLocaleString()} gil</dd>
                </div>
                <div>
                  <dt>Quantity</dt>
                  <dd>{note.quantity.toLocaleString()}</dd>
                </div>
              </dl>
              {note.notes ? <p className="tradeNoteText">{note.notes}</p> : null}
              <div className="tradeNoteActions">
                <button
                  className="textButton"
                  type="button"
                  onClick={() => {
                    setEditingId(note.id);
                    setDraft(noteToDraft(note));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Edit
                </button>
                <button
                  className="textButton dangerAction"
                  type="button"
                  onClick={() => deleteNote(note.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
