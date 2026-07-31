import { create } from "zustand";

const STORAGE_KEY = "xiv-arbitrage.trade-notes";

export const TRADE_NOTE_STATUSES = ["planned", "bought", "listed", "sold", "abandoned"] as const;
export type TradeNoteStatus = (typeof TRADE_NOTE_STATUSES)[number];

export type TradeNote = {
  id: string;
  itemId: number;
  itemName: string;
  buyWorld: string;
  sellLocation: string;
  buyPrice: number;
  expectedSellPrice: number;
  quantity: number;
  notes: string;
  status: TradeNoteStatus;
  createdAt: string;
  updatedAt: string;
};

export type TradeNoteDraft = Omit<TradeNote, "id" | "createdAt" | "updatedAt">;

function isTradeNote(value: unknown): value is TradeNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.id === "string" &&
    typeof note.itemId === "number" &&
    Number.isSafeInteger(note.itemId) &&
    note.itemId > 0 &&
    typeof note.itemName === "string" &&
    typeof note.buyWorld === "string" &&
    typeof note.sellLocation === "string" &&
    typeof note.buyPrice === "number" &&
    Number.isFinite(note.buyPrice) &&
    note.buyPrice >= 0 &&
    typeof note.expectedSellPrice === "number" &&
    Number.isFinite(note.expectedSellPrice) &&
    note.expectedSellPrice >= 0 &&
    typeof note.quantity === "number" &&
    Number.isSafeInteger(note.quantity) &&
    note.quantity > 0 &&
    typeof note.notes === "string" &&
    typeof note.status === "string" &&
    TRADE_NOTE_STATUSES.includes(note.status as TradeNoteStatus) &&
    typeof note.createdAt === "string" &&
    typeof note.updatedAt === "string"
  );
}

function loadNotes(): TradeNote[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isTradeNote) : [];
  } catch {
    return [];
  }
}

function persist(notes: TradeNote[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

type TradeNotesState = {
  notes: TradeNote[];
  createNote: (draft: TradeNoteDraft) => void;
  updateNote: (id: string, draft: TradeNoteDraft) => void;
  deleteNote: (id: string) => void;
};

export const useTradeNotesStore = create<TradeNotesState>((set) => ({
  notes: loadNotes(),
  createNote: (draft) =>
    set((state) => {
      const now = new Date().toISOString();
      const notes = [
        { ...draft, id: crypto.randomUUID(), createdAt: now, updatedAt: now },
        ...state.notes,
      ];
      persist(notes);
      return { notes };
    }),
  updateNote: (id, draft) =>
    set((state) => {
      const notes = state.notes.map((note) =>
        note.id === id ? { ...note, ...draft, updatedAt: new Date().toISOString() } : note,
      );
      persist(notes);
      return { notes };
    }),
  deleteNote: (id) =>
    set((state) => {
      const notes = state.notes.filter((note) => note.id !== id);
      persist(notes);
      return { notes };
    }),
}));

export function getTradeNoteHref(draft: Partial<TradeNoteDraft> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(draft))
    if (value !== undefined && value !== "") params.set(key, String(value));
  return `/notes/new${params.size ? `?${params.toString()}` : ""}`;
}
