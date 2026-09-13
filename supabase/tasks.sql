-- Tables behind /staff/tasks. Run once in the Supabase SQL editor.
-- Design notes: docs/tasks-architecture.md

create table if not exists task_pages (
  id           uuid primary key,
  kind         text not null check (kind in ('page', 'template')),
  day          date,                          -- null = undated (templates are always null)
  title        text not null default '',
  emoji        text not null default '',
  start_min    integer,                       -- minutes since midnight; null = no start time
  template_id  uuid references task_pages (id) on delete set null,
  is_recipe    boolean not null default false,
  recipe       jsonb not null default '[]',   -- [{ id, amount, unit, name }]
  recipe_scale double precision not null default 1,  -- pages: shown amount = amount × scale
  repeat       jsonb,                         -- templates only; null = doesn't repeat
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists task_pages_kind_day on task_pages (kind, day);

create table if not exists task_blocks (
  id         uuid primary key,
  page_id    uuid not null references task_pages (id) on delete cascade,
  position   double precision not null,
  kind       text not null check (kind in ('text', 'header', 'todo')),
  text       text not null default '',
  done       boolean not null default false,
  images     jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
create index if not exists task_blocks_page_pos on task_blocks (page_id, position);

create table if not exists task_repeat_exceptions (
  template_id     uuid not null references task_pages (id) on delete cascade,
  occurrence_day  date not null,
  page_id         uuid references task_pages (id) on delete set null,
  primary key (template_id, occurrence_day)
);

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists task_pages_updated on task_pages;
create trigger task_pages_updated before update on task_pages
  for each row execute function set_updated_at();
drop trigger if exists task_blocks_updated on task_blocks;
create trigger task_blocks_updated before update on task_blocks
  for each row execute function set_updated_at();

-- Wide open, like the other tables. TODO tighten once staff auth exists.
alter table task_pages enable row level security;
alter table task_blocks enable row level security;
alter table task_repeat_exceptions enable row level security;

create policy "public read"   on task_pages for select using (true);
create policy "public write"  on task_pages for insert with check (true);
create policy "public update" on task_pages for update using (true);
create policy "public delete" on task_pages for delete using (true);

create policy "public read"   on task_blocks for select using (true);
create policy "public write"  on task_blocks for insert with check (true);
create policy "public update" on task_blocks for update using (true);
create policy "public delete" on task_blocks for delete using (true);

create policy "public read"   on task_repeat_exceptions for select using (true);
create policy "public write"  on task_repeat_exceptions for insert with check (true);
create policy "public update" on task_repeat_exceptions for update using (true);
create policy "public delete" on task_repeat_exceptions for delete using (true);
