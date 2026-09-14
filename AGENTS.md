<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project notes (restaurant-site)

Next.js 16 App Router + TypeScript, Supabase via raw PostgREST `fetch` (no
supabase-js), CSS modules, deployed by Netlify on push to `main`. Env vars
live in `.env.local` (see `.env.example`); the same Supabase project serves
dev and production.

## Where things are

- `README.md` — routes, Supabase setup, deployment.
- `docs/tasks-architecture.md` — the `/staff/tasks` feature: data model, sync,
  templates, recipes, repeats, prep steps, block moving. Read it before
  touching anything under `src/app/staff/tasks/` or `src/lib/tasks-*.ts`.
- `supabase/*.sql` — schema; `tasks.sql` is the current full shape.

## How we work here

- Verify in the browser (dev server via `.claude/launch.json`) against the
  real Supabase project; create throwaway pages for tests and delete them
  afterwards — never touch the user's own pages or templates.
- Before committing: `npx tsc --noEmit -p tsconfig.json && npx eslint src`.
  The React Compiler lint rules are on: no setState directly in an effect
  body, no refs read during render.
- Commit when a piece is done and verified; small single-purpose commits with
  a short imperative title. Push only when asked (a push deploys).
- Copy conventions: the undated section is "Ongoing"; recipe views are
  "Ingredients" and "Steps"; untouched repeat occurrences are "not started".
- Sidebar and menus are built for a tablet in landscape; keep tap targets
  ≥ 36 px and check the phone layout (< 760 px) when changing layout.
