/*
 * Storage for the Tasks feature (/staff/tasks): pages, their content blocks,
 * and the repeat-exception records. Design notes: docs/tasks-architecture.md.
 *
 * Supabase only — there is deliberately no localStorage fallback here (three
 * related tables with embedded reads would mean a second implementation to
 * keep in step). Without env vars the page shows a "needs Supabase" state.
 */

import { normalizeRule, type RepeatRule } from "./tasks-repeat";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const SHARED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/* ---------- types ---------- */

export type PageKind = "page" | "template";
export type BlockKind = "text" | "header" | "todo";

export type ImageRef = { id: string; path: string; w: number; h: number };
export type RecipeRow = { id: string; amount: number; unit: string; name: string };

export type Page = {
  id: string;
  kind: PageKind;
  day: string | null; // ISO date, or null = undated
  title: string;
  emoji: string; // "" = no icon
  start_min: number | null; // minutes since midnight
  template_id: string | null;
  is_recipe: boolean;
  recipe: RecipeRow[];
  /** Pages: every recipe amount is shown × this. Templates: always 1. */
  recipe_scale: number;
  repeat: RepeatRule | null; // templates only
  created_at: string;
};

export type Block = {
  id: string;
  page_id: string;
  position: number;
  kind: BlockKind;
  text: string;
  done: boolean;
  images: ImageRef[];
};

/** What the sidebar needs for one page: identity plus checklist progress. */
export type PageSummary = Pick<
  Page,
  "id" | "day" | "title" | "emoji" | "start_min" | "template_id" | "created_at"
> & {
  todo_total: number;
  todo_done: number;
  /** Set for an occurrence of a repeating template that nobody has touched yet. */
  virtual?: { templateId: string; day: string };
};

/** A template with a repeat rule, plus the days its rule must skip. */
export type RepeatingTemplate = TemplateSummary & {
  repeat: RepeatRule;
  todo_total: number;
  exceptions: { occurrence_day: string; page_id: string | null }[];
};

/** What the template chooser needs. */
export type TemplateSummary = Pick<
  Page,
  "id" | "title" | "emoji" | "is_recipe" | "repeat" | "start_min" | "created_at"
>;

export type NewPage = Omit<Page, "created_at">;
export type PagePatch = Partial<
  Pick<Page, "day" | "title" | "emoji" | "start_min" | "recipe" | "recipe_scale" | "repeat">
>;
export type BlockPatch = Partial<Pick<Block, "position" | "kind" | "text" | "done" | "images">>;

/* ---------- helpers ---------- */

export const newId = () => crypto.randomUUID();

/** A position strictly between two neighbours (either may be absent). */
export const positionBetween = (before?: number, after?: number) => {
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
};

/** Sidebar order: timed pages first by time, then the rest by creation. */
export const bySidebarOrder = (a: PageSummary, b: PageSummary) => {
  if (a.start_min !== null && b.start_min !== null && a.start_min !== b.start_min)
    return a.start_min - b.start_min;
  if (a.start_min !== null && b.start_min === null) return -1;
  if (a.start_min === null && b.start_min !== null) return 1;
  return a.created_at.localeCompare(b.created_at);
};

export const byPosition = (a: Block, b: Block) => a.position - b.position;

/* eslint-disable @typescript-eslint/no-explicit-any */
const numOrNull = (v: any) =>
  v === null || v === undefined || v === "" ? null : Number(v);

const normalizeRow = (v: any): RecipeRow => ({
  id: String(v.id ?? ""),
  amount: Number(v.amount ?? 0) || 0,
  unit: (v.unit ?? "").toString(),
  name: (v.name ?? "").toString(),
});

const normalizePage = (v: any): Page => ({
  id: String(v.id),
  kind: v.kind === "template" ? "template" : "page",
  day: v.day ? String(v.day) : null,
  title: (v.title ?? "").toString(),
  emoji: (v.emoji ?? "").toString(),
  start_min: numOrNull(v.start_min),
  template_id: v.template_id ? String(v.template_id) : null,
  is_recipe: Boolean(v.is_recipe),
  recipe: Array.isArray(v.recipe) ? v.recipe.map(normalizeRow) : [],
  recipe_scale: Number(v.recipe_scale ?? 1) > 0 ? Number(v.recipe_scale ?? 1) : 1,
  repeat: normalizeRule(v.repeat),
  created_at: String(v.created_at ?? ""),
});

const normalizeBlock = (v: any): Block => ({
  id: String(v.id),
  page_id: String(v.page_id),
  position: Number(v.position),
  kind: v.kind === "header" || v.kind === "todo" ? v.kind : "text",
  text: (v.text ?? "").toString(),
  done: Boolean(v.done),
  images: Array.isArray(v.images) ? v.images : [],
});

const normalizeSummary = (v: any): PageSummary => {
  const p = normalizePage(v);
  const blocks: any[] = Array.isArray(v.task_blocks) ? v.task_blocks : [];
  const todos = blocks.filter((b) => b.kind === "todo");
  return {
    id: p.id,
    day: p.day,
    title: p.title,
    emoji: p.emoji,
    start_min: p.start_min,
    template_id: p.template_id,
    created_at: p.created_at,
    todo_total: todos.length,
    todo_done: todos.filter((b) => Boolean(b.done)).length,
  };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------- Supabase REST ---------- */

const base = SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1";
const pagesUrl = base + "/task_pages";
const blocksUrl = base + "/task_blocks";
const exceptionsUrl = base + "/task_repeat_exceptions";
const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: "Bearer " + SUPABASE_ANON_KEY,
  "Content-Type": "application/json",
};

const check = async (r: Response) => {
  if (!r.ok) throw new Error((await r.text()).slice(0, 300));
  return r;
};

const SUMMARY_SELECT =
  "id,day,title,emoji,start_min,template_id,created_at,task_blocks(kind,done)";

export interface TasksStore {
  /** Real pages on one day, in sidebar order. */
  listDay(day: string): Promise<PageSummary[]>;
  /** All templates, alphabetical. */
  listTemplates(): Promise<TemplateSummary[]>;
  /** Templates with a repeat rule, with their skipped/started days. */
  listRepeating(): Promise<RepeatingTemplate[]>;
  /** Record that an occurrence became a page (pageId) or was skipped (null). */
  addException(templateId: string, day: string, pageId: string | null): Promise<"ok" | "exists">;
  getException(templateId: string, day: string): Promise<{ page_id: string | null } | null>;
  /** Real pages with no day, in sidebar order. */
  listUndated(): Promise<PageSummary[]>;
  getPage(id: string): Promise<{ page: Page; blocks: Block[] } | null>;
  createPage(page: NewPage, blocks: Block[]): Promise<void>;
  updatePage(id: string, patch: PagePatch): Promise<void>;
  deletePage(id: string): Promise<void>;
  insertBlocks(blocks: Block[]): Promise<void>;
  updateBlock(id: string, patch: BlockPatch): Promise<void>;
  deleteBlock(id: string): Promise<void>;
}

export const store: TasksStore = {
  async listDay(day) {
    const r = await check(
      await fetch(`${pagesUrl}?select=${SUMMARY_SELECT}&kind=eq.page&day=eq.${day}`, {
        headers,
      })
    );
    return ((await r.json()) as unknown[]).map(normalizeSummary).sort(bySidebarOrder);
  },
  async listTemplates() {
    const r = await check(
      await fetch(
        `${pagesUrl}?select=id,title,emoji,is_recipe,repeat,start_min,created_at&kind=eq.template&order=title.asc,created_at.asc`,
        { headers }
      )
    );
    return ((await r.json()) as unknown[]).map((v) => {
      const p = normalizePage(v);
      return {
        id: p.id,
        title: p.title,
        emoji: p.emoji,
        is_recipe: p.is_recipe,
        repeat: p.repeat,
        start_min: p.start_min,
        created_at: p.created_at,
      };
    });
  },
  async listRepeating() {
    const r = await check(
      await fetch(
        `${pagesUrl}?select=id,title,emoji,is_recipe,repeat,start_min,created_at,task_blocks(kind),task_repeat_exceptions!template_id(occurrence_day,page_id)&kind=eq.template&repeat=not.is.null`,
        { headers }
      )
    );
    const out: RepeatingTemplate[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const v of (await r.json()) as any[]) {
      const p = normalizePage(v);
      if (!p.repeat) continue;
      const blocks: unknown[] = Array.isArray(v.task_blocks) ? v.task_blocks : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ex: any[] = Array.isArray(v.task_repeat_exceptions) ? v.task_repeat_exceptions : [];
      out.push({
        id: p.id,
        title: p.title,
        emoji: p.emoji,
        is_recipe: p.is_recipe,
        repeat: p.repeat,
        start_min: p.start_min,
        created_at: p.created_at,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        todo_total: blocks.filter((b: any) => b.kind === "todo").length,
        exceptions: ex.map((e) => ({
          occurrence_day: String(e.occurrence_day),
          page_id: e.page_id ? String(e.page_id) : null,
        })),
      });
    }
    return out;
  },
  async addException(templateId, day, pageId) {
    const r = await fetch(exceptionsUrl, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify([{ template_id: templateId, occurrence_day: day, page_id: pageId }]),
    });
    if (r.status === 409) return "exists";
    await check(r);
    return "ok";
  },
  async getException(templateId, day) {
    const r = await check(
      await fetch(
        `${exceptionsUrl}?select=page_id&template_id=eq.${encodeURIComponent(templateId)}&occurrence_day=eq.${day}&limit=1`,
        { headers }
      )
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await r.json()) as any[];
    return rows.length ? { page_id: rows[0].page_id ? String(rows[0].page_id) : null } : null;
  },
  async listUndated() {
    const r = await check(
      await fetch(`${pagesUrl}?select=${SUMMARY_SELECT}&kind=eq.page&day=is.null`, { headers })
    );
    return ((await r.json()) as unknown[]).map(normalizeSummary).sort(bySidebarOrder);
  },
  async getPage(id) {
    const r = await check(
      await fetch(
        `${pagesUrl}?select=*,task_blocks(*)&id=eq.${encodeURIComponent(id)}&limit=1`,
        { headers }
      )
    );
    const rows = (await r.json()) as unknown[];
    if (!rows.length) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = rows[0] as any;
    const blocks: unknown[] = Array.isArray(row.task_blocks) ? row.task_blocks : [];
    return { page: normalizePage(row), blocks: blocks.map(normalizeBlock).sort(byPosition) };
  },
  async createPage(page, blocks) {
    await check(
      await fetch(pagesUrl, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify([page]),
      })
    );
    if (blocks.length) await this.insertBlocks(blocks);
  },
  async updatePage(id, patch) {
    await check(
      await fetch(`${pagesUrl}?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      })
    );
  },
  async deletePage(id) {
    // Blocks go with it (on delete cascade).
    await check(
      await fetch(`${pagesUrl}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers })
    );
  },
  async insertBlocks(blocks) {
    await check(
      await fetch(blocksUrl, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(blocks),
      })
    );
  },
  async updateBlock(id, patch) {
    await check(
      await fetch(`${blocksUrl}?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      })
    );
  },
  async deleteBlock(id) {
    await check(
      await fetch(`${blocksUrl}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers })
    );
  },
};
