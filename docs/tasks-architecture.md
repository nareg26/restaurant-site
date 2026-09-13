# Tasks (`/staff/tasks`) — data model and sync

Design for the Tasks feature. Covers the whole vision (pages, images,
templates, recipes, repeating pages) so that the slices in steps 2–6 don't
need schema changes between them.

## Guiding decisions

1. **One table for pages and templates.** A template is a page with
   `kind = 'template'`. Same editor, same blocks table. "Create from template"
   is a copy of that row and its blocks (and recipe rows, and images).
2. **One row per block, and each checklist item is its own block** (agreed
   2026-09-13). This is
   the Notion model: `text`, `header`, and `todo` blocks; consecutive `todo`
   blocks render as one checklist. Reasons:
   - Sync granularity: two devices editing different blocks, or ticking
     different checklist items, never overwrite each other. Ticking an item
     is a one-column PATCH on one row.
   - Images attach to "a block or a checklist item" — with items as blocks,
     that's just "images attach to a block". One code path.
   - The completion indicator is `count(todo where done) / count(todo)`.
3. **Ordering with a fractional `position`.** Insert between two blocks =
   midpoint; only the moved row is written. Renumber the page's blocks if a
   gap gets smaller than 1e-6 (practically never).
4. **Client-generated UUIDs** (`crypto.randomUUID()`), so the UI can insert
   optimistically and never waits on the server to know an id.
5. **Sync = poll + focus refresh, like the schedule.** No new dependency.
   Details below. Supabase Realtime is a later drop-in if polling feels slow.
6. **Same openness as the rest of the site**: anon key, wide-open RLS, no
   auth. Documented as a TODO like the other tables.

## Tables

```sql
-- Pages and templates.
create table if not exists task_pages (
  id           uuid primary key,                       -- client-generated
  kind         text not null check (kind in ('page', 'template')),
  day          date,                                   -- null = undated. Templates are always null.
  title        text not null default '',
  emoji        text not null default '',               -- '' = no icon
  start_min    integer,                                -- minutes since midnight; null = no start time
  template_id  uuid references task_pages (id) on delete set null,
                                                       -- pages only: the template this was copied from
                                                       -- (powers the "Edit template" shortcut)
  is_recipe    boolean not null default false,
  recipe       jsonb not null default '[]',            -- [{ id, amount, unit, name }] — see Recipes
  repeat       jsonb,                                  -- templates only; null = doesn't repeat. See Repeating
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists task_pages_kind_day on task_pages (kind, day);

-- Content blocks. A checklist is a run of consecutive `todo` blocks.
create table if not exists task_blocks (
  id         uuid primary key,                         -- client-generated
  page_id    uuid not null references task_pages (id) on delete cascade,
  position   double precision not null,
  kind       text not null check (kind in ('text', 'header', 'todo')),
  text       text not null default '',                 -- may contain [[ing:<id>|<name>]] tokens (recipes)
  done       boolean not null default false,           -- todo only
  images     jsonb not null default '[]',              -- [{ id, path, w, h }] — objects in Storage
  updated_at timestamptz not null default now()
);
create index if not exists task_blocks_page_pos on task_blocks (page_id, position);

-- Occurrences of a repeating template that must NOT be generated from the
-- rule any more: either because they became a real page, or because they
-- were deleted while still virtual.
create table if not exists task_repeat_exceptions (
  template_id     uuid not null references task_pages (id) on delete cascade,
  occurrence_day  date not null,
  page_id         uuid references task_pages (id) on delete set null,
                  -- the real page this occurrence became; null = skipped/deleted
  primary key (template_id, occurrence_day)
);

-- Keep updated_at honest without trusting clients' clocks.
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger task_pages_updated  before update on task_pages  for each row execute function set_updated_at();
create trigger task_blocks_updated before update on task_blocks for each row execute function set_updated_at();

-- RLS: wide open, same as the other tables. TODO tighten with staff auth.
alter table task_pages enable row level security;
alter table task_blocks enable row level security;
alter table task_repeat_exceptions enable row level security;
-- (four policies per table: select/insert/update/delete using (true))
```

### Storage (images, step 3)

- Bucket `task-images`, public read, anon write (matches the tables).
- **Objects are immutable and shared.** Path: `images/<image_id>.<ext>`,
  not tied to a page. A block holds a reference `{ id, path, w, h }` in
  `task_blocks.images`; any number of blocks may reference the same object.
  Copying a template, materializing a repeat occurrence, or moving a page
  copies only the reference — no extra storage, ever.
- The client downsizes to max 1600 px on the long edge before upload —
  tablet cameras produce 12 MP files nobody needs on a prep list. `w`/`h`
  let the UI reserve space before the image loads.
- **Deleting a block or page never deletes objects**, since another page may
  still reference the same image. Instead, a cleanup sweep (an admin button,
  later) collects every path referenced in `task_blocks.images`, lists the
  bucket, and removes anything unreferenced. Orphans are harmless until then.
- Consequence: removing an image from a template does not remove it from
  pages already made from that template — they keep their own reference,
  consistent with how everything else diverges from the template.

## Reads the UI needs

Everything is PostgREST with resource embedding via the FKs above, so each
screen is one or two requests.

| Screen | Request |
|---|---|
| Sidebar, day D | `task_pages?kind=eq.page&day=eq.D&select=id,title,emoji,start_min,template_id,task_blocks(kind,done)` |
| Sidebar, undated | same with `day=is.null` |
| Sidebar, repeats for D | `task_pages?kind=eq.template&repeat=not.is.null&select=*,task_repeat_exceptions(occurrence_day,page_id)` — rule evaluated client-side |
| Open page | `task_pages?id=eq.X&select=*,task_blocks(*)` |
| Template picker | `task_pages?kind=eq.template&select=id,title,emoji,is_recipe,repeat` |

Sidebar order: pages with `start_min` first, by `start_min`; then the rest by
`created_at`. (Manual ordering of the rest can be a `position` column later.)

## Sync

Same shape as `Schedule.tsx`: refetch every 5 s while the tab is visible, and
immediately on `visibilitychange`. Two things the editor adds on top:

- **Debounced writes.** Typing patches the block row ~400 ms after the last
  keystroke. Structural edits (Enter, Backspace-merge, `/` conversions,
  reorder, tick a checkbox) write immediately.
- **Dirty guard.** A poll never overwrites a block that has an unsaved local
  edit or is currently focused. Everything else takes the server's version.
  Effect: last-write-wins per row, and you never lose what you're typing.

Every write is a plain PATCH/POST/DELETE on one row (bulk POST with
`Prefer: resolution=merge-duplicates` when copying a template's blocks). No
transactions are needed; the only multi-step write that must not half-apply
is materializing a repeat occurrence, handled below.

Realtime later: Supabase's `postgres_changes` channel on the three tables
would replace the poll with no schema change.

## Templates (step 4)

- Create template: insert a `task_pages` row with `kind='template'`, plus
  `is_recipe` / `repeat` answered in the creation flow. Edited in the same
  editor as a page.
- Create page from template: read template + blocks, insert a new page with
  `template_id = template.id`, `kind='page'`, chosen `day` (or null), copied
  `recipe`, then bulk-insert copied blocks with fresh ids and the same
  positions (image references copied as-is; the objects are shared). After
  that it is independent.
- "Edit template" opens `template_id`. If the template was deleted, the FK
  sets it to null and the shortcut disappears.
- Deleting a template does not touch pages made from it.

## Recipes (step 5)

- `task_pages.recipe` is the ingredient table, an ordered array:
  `[{ id: "a1", amount: 300, unit: "g", name: "flour" }]`. Rows can be
  added, removed and reordered; it lives on the template and is **copied**
  onto every page made from it.
- **Scaling** rewrites the page's own `recipe` amounts (all rows multiplied
  by `newAmount / oldAmount` of the chosen base row) and saves them. Ratios
  are preserved, so any row can be used as the base again later. The template
  is untouched. Persisting (rather than keeping scale in local UI state)
  means the phone and the tablet show the same numbers. No rounding.
- **Ingredient pills** are tokens in block text: `[[ing:a1|flour]]`. The
  editor renders a token as a pill showing the *current* amount and unit
  from the page's `recipe` (so it follows scaling). The name is cached in
  the token, which is what's shown when the row no longer exists.
- Table view vs content view is a toggle on the page; nothing stored.

## Repeating pages (step 6)

- `task_pages.repeat` on a template is our own JSON, shaped after Google
  Calendar's dialog (exact fields decided with your screenshots), roughly:
  `{ freq: "daily"|"weekly"|"monthly", interval: 1, byWeekday: [1,3],
     start: "2026-09-15", end: null | { until: "…" } | { count: n } }`.
- For a day D, the sidebar computes which repeating templates hit D and drops
  any with a row in `task_repeat_exceptions` for D. Untouched occurrences are
  **virtual**: they render from the template (so template edits show up) and
  have no page row.
- **Materialize** on first interaction (edit, tick, move, delete):
  1. Create the page (copy of template, `template_id` set, `day = D`).
  2. Insert the exception `(template_id, D, page_id)`.
  3. If step 2 fails with a unique violation, another device got there
     first: delete the page from step 1 and open the existing `page_id`.
  A materialized occurrence that is later moved keeps its exception on the
  original day, so nothing reappears there.
- **Delete a virtual occurrence** = insert `(template_id, D, null)`.
- Changing the rule only affects future virtual occurrences. Materialized
  pages are ordinary pages by then.

## Code layout

| File | Contents |
|---|---|
| `src/lib/tasks-store.ts` | Types, normalizers, REST store for the three tables (step 2) |
| `src/lib/tasks-images.ts` | Storage upload/copy/delete + client-side downsizing (step 3) |
| `src/lib/tasks-recipe.ts` | Scaling math, token parse/serialize (step 5) |
| `src/lib/tasks-repeat.ts` | Rule → occurrences for a date range (step 6) |
| `src/app/staff/tasks/` | `page.tsx`, `Tasks.tsx` (layout, sidebar, data + sync), `Editor.tsx` (blocks), `PageMenu.tsx`, `EmojiPicker.tsx`, `tasks.module.css` |
| `supabase/tasks.sql` | The SQL above, ready to paste into the SQL editor |

Not carried over from the other features (agreed 2026-09-13): the
localStorage fallback. With
resource embedding and three related tables it would be a second, sizeable
implementation to keep in step. `/staff/tasks` shows a clear "needs Supabase"
state when the env vars are missing.
