/*
 * Storage backends for shifts.
 *
 * With Supabase env vars set (see .env.example) shifts live in the shared
 * `shifts` table. Without them, everything is kept in the visitor's own
 * browser (localStorage) so the app still works.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const SHARED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export type ChecklistItem = { id: string; text: string; done: boolean };

export type Shift = {
  id: string;
  day: string; // ISO date, "2026-08-03"
  start_min: number; // minutes since midnight
  end_min: number;
  emoji: string;
  title: string;
  person: string; // empty string = shift is open / unassigned
  notes: string;
  checklist: ChecklistItem[];
};

export type NewShift = Omit<Shift, "id">;

export interface ShiftsStore {
  /** All shifts with fromDay <= day <= toDay (ISO dates, inclusive). */
  list(fromDay: string, toDay: string): Promise<Shift[]>;
  get(id: string): Promise<Shift | null>;
  create(shift: NewShift): Promise<Shift>;
  update(id: string, patch: Partial<NewShift>): Promise<void>;
  remove(id: string): Promise<void>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const normalize = (row: any): Shift => ({
  id: String(row.id),
  day: String(row.day),
  start_min: Number(row.start_min),
  end_min: Number(row.end_min),
  emoji: row.emoji ?? "🍽️",
  title: row.title ?? "",
  person: row.person ?? "",
  notes: row.notes ?? "",
  checklist: Array.isArray(row.checklist) ? row.checklist : [],
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------- localStorage backend ---------- */

const LOCAL_KEY = "shifts-v1";

const readAll = (): Shift[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    return Array.isArray(arr) ? arr.map(normalize) : [];
  } catch {
    return [];
  }
};
const writeAll = (shifts: Shift[]) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(shifts));
  } catch {
    /* storage full or blocked */
  }
};

export const localShiftsStore: ShiftsStore = {
  async list(fromDay, toDay) {
    return readAll()
      .filter((s) => s.day >= fromDay && s.day <= toDay)
      .sort((a, b) => a.day.localeCompare(b.day) || a.start_min - b.start_min);
  },
  async get(id) {
    return readAll().find((s) => s.id === id) ?? null;
  },
  async create(shift) {
    const created: Shift = { ...shift, id: crypto.randomUUID() };
    writeAll([...readAll(), created]);
    return created;
  },
  async update(id, patch) {
    writeAll(readAll().map((s) => (s.id === id ? { ...s, ...patch } : s)));
  },
  async remove(id) {
    writeAll(readAll().filter((s) => s.id !== id));
  },
};

/* ---------- Supabase REST backend ---------- */

const restUrl = SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/shifts";
const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: "Bearer " + SUPABASE_ANON_KEY,
  "Content-Type": "application/json",
};

const check = async (r: Response) => {
  if (!r.ok) throw new Error((await r.text()).slice(0, 300));
  return r;
};

export const remoteShiftsStore: ShiftsStore = {
  async list(fromDay, toDay) {
    const r = await check(
      await fetch(
        `${restUrl}?select=*&day=gte.${fromDay}&day=lte.${toDay}&order=day.asc,start_min.asc`,
        { headers }
      )
    );
    return ((await r.json()) as unknown[]).map(normalize);
  },
  async get(id) {
    const r = await check(
      await fetch(`${restUrl}?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, { headers })
    );
    const rows = (await r.json()) as unknown[];
    return rows.length ? normalize(rows[0]) : null;
  },
  async create(shift) {
    const r = await check(
      await fetch(restUrl, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify([shift]),
      })
    );
    return normalize(((await r.json()) as unknown[])[0]);
  },
  async update(id, patch) {
    await check(
      await fetch(`${restUrl}?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(patch),
      })
    );
  },
  async remove(id) {
    await check(
      await fetch(`${restUrl}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers })
    );
  },
};

export const store: ShiftsStore = SHARED ? remoteShiftsStore : localShiftsStore;
