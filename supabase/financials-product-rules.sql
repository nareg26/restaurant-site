-- Display rules for the "What sold" list (/admin/financials).
-- Run after financials-dashboard.sql. Safe to run again.
--
-- A rule says how one till item shows: under another name, and/or with
-- each one counting as N. Items that end up with the same name are shown
-- as one row; their values add up as sold, only the count is multiplied.
-- Rules are applied in the browser, so the data itself never changes, and
-- viewers can switch them off ("Show cleaned list").
--
-- Anyone can read the rules. Only the server route changes them, after the
-- upload PIN, through fin_set_product_rules.

create table if not exists fin_product_rules (
  product    text primary key,                   -- till name, lower-case and trimmed
  show_as    text not null default '',           -- '' = keep the till's name
  multiplier numeric(10,3) not null default 1 check (multiplier > 0),
  updated_at timestamptz not null default now()
);
alter table fin_product_rules enable row level security;
drop policy if exists "public read" on fin_product_rules;
create policy "public read" on fin_product_rules for select using (true);

-- The merges that used to be built into the product view, as editable rules.
insert into fin_product_rules (product, show_as, multiplier) values
  ('sandes x2',    'Falafel sandwich', 2),
  ('sanduiche x2', 'Falafel sandwich', 2),
  ('platter menu', 'Platter',          1)
on conflict (product) do nothing;

-- Products per working day under the till's own names (no merging here).
create or replace view fin_product_daily with (security_invoker = true) as
select s.company_nif, s.work_day as day,
       l.product,
       sum(l.quantity) as quantity,
       sum(l.net) as net,
       round(sum(l.net * (1 + l.vat_rate / 100)), 2) as gross
from fin_sales s
join fin_lines l using (company_nif, receipt_no)
where s.status <> 'A'
group by s.company_nif, s.work_day, l.product;

drop table if exists fin_product_names;

-- Every item ever sold, for the rules editor.
create or replace view fin_products with (security_invoker = true) as
select l.company_nif, l.product, sum(l.quantity) as quantity, max(r.day) as last_day
from fin_lines l
join fin_receipts r using (company_nif, receipt_no)
where r.status <> 'A'
group by l.company_nif, l.product;

-- Replaces the whole rule set in one go. Rows that change nothing
-- (no new name, ×1) are dropped.
create or replace function fin_set_product_rules(p_rules jsonb) returns integer
language plpgsql
as $$
begin
  delete from fin_product_rules where true;
  insert into fin_product_rules (product, show_as, multiplier)
  select distinct on (lower(trim(r->>'product')))
         lower(trim(r->>'product')),
         trim(coalesce(r->>'show_as', '')),
         coalesce((r->>'multiplier')::numeric, 1)
  from jsonb_array_elements(p_rules) as r
  where trim(coalesce(r->>'product', '')) <> ''
    and (trim(coalesce(r->>'show_as', '')) <> '' or coalesce((r->>'multiplier')::numeric, 1) <> 1);
  return (select count(*) from fin_product_rules);
end;
$$;

revoke execute on function fin_set_product_rules(jsonb) from public, anon, authenticated;
grant execute on function fin_set_product_rules(jsonb) to service_role;
