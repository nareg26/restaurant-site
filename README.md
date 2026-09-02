# Restaurant Site

Website and staff tools for the restaurant. Built with [Next.js](https://nextjs.org) (App Router, TypeScript), backed by [Supabase](https://supabase.com) for shared data, deployed on Cloudflare.

## Pages

| Route | What it is |
|---|---|
| `/` | Landing page (staff tools index for now) |
| `/staff/schedule` | Weekly calendar of shifts (drag to create, drag edges to resize), shared via Supabase |
| `/staff/shift?id=…` | Expanded view of one shift: times, person, notes, checklist |
| `/staff/preferences` | Poll: staff mark which open shifts they want and spend points on favourites |

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Without `.env.local` the schedule still works, but edits save only in your own browser (localStorage) instead of syncing with the team.

## Supabase setup

1. Create a free project at [supabase.com](https://supabase.com).
2. In **Settings → API**, copy the project URL and `anon` key into `.env.local`.
3. In the **SQL editor**, create the table the schedule uses:

```sql
create table if not exists shifts (
  id         uuid primary key default gen_random_uuid(),
  day        date not null,
  start_min  integer not null,  -- minutes since midnight (540 = 9:00)
  end_min    integer not null,
  emoji      text not null default '🍽️',
  title      text not null default '',
  person     text not null default '',  -- empty = shift is open
  notes      text not null default '',
  checklist  jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table shifts enable row level security;

-- Anyone with the anon key may read and write the schedule.
-- TODO: tighten this once staff auth is added — as-is, anyone who
-- finds the site can edit the schedule.
create policy "public read"   on shifts for select using (true);
create policy "public write"  on shifts for insert with check (true);
create policy "public update" on shifts for update using (true);
create policy "public delete" on shifts for delete using (true);
```

4. Also create the table behind `/staff/preferences` (each browser owns one
   anonymous row, keyed by an id kept in localStorage):

```sql
create table if not exists shift_prefs (
  id         uuid primary key,
  name       text not null default '',
  marks      jsonb not null default '{}',
  points     jsonb not null default '{}',
  notes      text not null default '',
  updated_at timestamptz not null default now()
);

alter table shift_prefs enable row level security;
create policy "public read"   on shift_prefs for select using (true);
create policy "public write"  on shift_prefs for insert with check (true);
create policy "public update" on shift_prefs for update using (true);
```

The days/slots being voted on live in `src/lib/prefs-config.ts` — edit that
file when a new round of open shifts comes up.

> **Note on the anon key:** it is designed to be public (it ships to every
> browser), so having it in `.env.local` / deploy settings is fine. What
> protects your data is Row Level Security. The policies above are wide open
> for convenience while the site is young — adding a proper staff login is on
> the roadmap.

## Deployment

Netlify (free tier), building automatically from this repo on every push to
`main`. Build settings come from `netlify.toml`; Netlify detects Next.js and
applies its Next.js runtime on its own.

**Set the environment variables in Netlify** (Site configuration → Environment
variables), otherwise the deployed site falls back to browser-only storage:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

`.env.local` is gitignored and never reaches the build, which is why these have
to be set in the dashboard.

> Dragging this folder into Netlify by hand does **not** work: Next.js has to be
> built first, and a drag-and-drop deploy skips the build entirely.
