-- Financials dashboard (/admin/financials): views the charts read.
-- Run after financials.sql. Safe to run again.
--
-- Working day: a receipt entered before 11:00 is a leftover from the night
-- before, logged the next morning. It counts for the previous day and is
-- shown at 21h. The receipt itself keeps its real dates in fin_receipts.

-- Product names that are the same item. alias is matched lower-cased.
create table if not exists fin_product_names (
  alias text primary key,   -- lower-case name as it appears on receipts
  name  text not null       -- the name to show
);
alter table fin_product_names enable row level security;
drop policy if exists "public read" on fin_product_names;
create policy "public read" on fin_product_names for select using (true);

insert into fin_product_names (alias, name) values
  ('sanduiche x2', 'sandes x2'),
  ('platter menu', 'Platter')
on conflict (alias) do nothing;

-- Every receipt with its working day and display hour.
create or replace view fin_sales with (security_invoker = true) as
select
  r.*,
  case when extract(hour from r.entered_at) < 11
       then (r.entered_at::date - 1) else r.entered_at::date end as work_day,
  case when extract(hour from r.entered_at) < 11
       then 21 else extract(hour from r.entered_at)::integer end as hour
from fin_receipts r;

-- Daily totals now follow the working day (same columns as before).
create or replace view fin_daily with (security_invoker = true) as
select
  s.company_nif,
  s.work_day as day,
  count(*) filter (where s.status <> 'A')       as receipts,
  coalesce(sum(s.gross) filter (where s.status <> 'A'), 0) as gross,
  coalesce(sum(s.net)   filter (where s.status <> 'A'), 0) as net,
  coalesce(sum(s.tax)   filter (where s.status <> 'A'), 0) as tax,
  count(*) filter (where s.status = 'A')        as cancelled
from fin_sales s
group by s.company_nif, s.work_day;

create or replace view fin_daily_payments with (security_invoker = true) as
select s.company_nif, s.work_day as day, p.method, sum(p.amount) as amount
from fin_sales s
join fin_payments p using (company_nif, receipt_no)
where s.status <> 'A'
group by s.company_nif, s.work_day, p.method;

-- Receipts and sales per working day and hour.
create or replace view fin_hourly with (security_invoker = true) as
select s.company_nif, s.work_day as day, s.hour,
       count(*) as receipts, sum(s.gross) as gross, sum(s.net) as net
from fin_sales s
where s.status <> 'A'
group by s.company_nif, s.work_day, s.hour;

-- What sold per working day, duplicate names merged. Gross is worked out
-- per line (net + VAT), so it can differ from receipt totals by a few cents.
create or replace view fin_product_daily with (security_invoker = true) as
select s.company_nif, s.work_day as day,
       coalesce(n.name, l.product) as product,
       sum(l.quantity) as quantity,
       sum(l.net) as net,
       round(sum(l.net * (1 + l.vat_rate / 100)), 2) as gross
from fin_sales s
join fin_lines l using (company_nif, receipt_no)
left join fin_product_names n on n.alias = lower(l.product)
where s.status <> 'A'
group by s.company_nif, s.work_day, coalesce(n.name, l.product);
