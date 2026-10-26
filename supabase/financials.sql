-- Financials (/admin/financials): sales imported from Portuguese SAF-T files.
--
-- Anyone can read these tables (the numbers are public on purpose). Nobody
-- can write them with the anon key: there are no insert/update/delete
-- policies. Imports go through the Next.js route /api/financials/import,
-- which checks the upload PIN and calls fin_import_batch with the secret key.
--
-- Customer tax numbers (NIF) are never stored, only whether a receipt had one.
-- Amounts are signed: credit notes (NC) are negative.

create table if not exists fin_imports (
  id               uuid primary key default gen_random_uuid(),
  file_name        text not null,
  file_sha256      text not null,
  company_nif      text not null,
  period_start     date not null,       -- Header StartDate
  period_end       date not null,       -- Header EndDate
  file_created     date not null,       -- Header DateCreated: decides which file wins
  software         text not null default '',
  receipts_in_file integer not null default 0,
  inserted         integer not null default 0,
  updated          integer not null default 0,
  unchanged        integer not null default 0,
  skipped_older    integer not null default 0,
  status           text not null default 'running',  -- running | done | failed
  imported_at      timestamptz not null default now()
);
create index if not exists fin_imports_sha on fin_imports (file_sha256);

create table if not exists fin_receipts (
  company_nif    text not null,
  receipt_no     text not null,          -- "FS SH11FS/57", unique per company forever
  receipt_type   text not null,          -- FS, FT, FR, NC, ND
  day            date not null,          -- InvoiceDate
  entered_at     timestamp not null,     -- SystemEntryDate, Portuguese local time
  status         text not null,          -- N normal, A cancelled, F billed, S self-billed
  status_reason  text not null default '',
  net            numeric(12,2) not null,
  tax            numeric(12,2) not null,
  gross          numeric(12,2) not null,
  with_tax_no    boolean not null default false,  -- customer asked for a NIF on the receipt
  content_hash   text not null,          -- md5 of the imported receipt, to spot changes
  source_created date not null,          -- file_created of the newest file that had it
  import_id      uuid references fin_imports (id),
  primary key (company_nif, receipt_no)
);
create index if not exists fin_receipts_day on fin_receipts (company_nif, day);

create table if not exists fin_lines (
  company_nif  text not null,
  receipt_no   text not null,
  line_no      integer not null,
  product_code text not null,
  product      text not null,
  quantity     numeric(12,3) not null,
  unit         text not null default '',
  unit_price   numeric(12,4) not null,   -- without VAT
  net          numeric(12,2) not null,   -- without VAT; negative on credit notes
  vat_rate     numeric(5,2) not null,    -- 13, 23, 6, 0 …
  primary key (company_nif, receipt_no, line_no),
  foreign key (company_nif, receipt_no) references fin_receipts on delete cascade
);

create table if not exists fin_payments (
  company_nif text not null,
  receipt_no  text not null,
  idx         integer not null,
  method      text not null,             -- MB card, NU cash, CC, CD, TB, TR …
  amount      numeric(12,2) not null,
  primary key (company_nif, receipt_no, idx),
  foreign key (company_nif, receipt_no) references fin_receipts on delete cascade
);

alter table fin_imports  enable row level security;
alter table fin_receipts enable row level security;
alter table fin_lines    enable row level security;
alter table fin_payments enable row level security;

create policy "public read" on fin_imports  for select using (true);
create policy "public read" on fin_receipts for select using (true);
create policy "public read" on fin_lines    for select using (true);
create policy "public read" on fin_payments for select using (true);

-- Daily totals, cancelled receipts left out (they still list their payments).
create or replace view fin_daily with (security_invoker = true) as
select
  r.company_nif,
  r.day,
  count(*) filter (where r.status <> 'A')       as receipts,
  coalesce(sum(r.gross) filter (where r.status <> 'A'), 0) as gross,
  coalesce(sum(r.net)   filter (where r.status <> 'A'), 0) as net,
  coalesce(sum(r.tax)   filter (where r.status <> 'A'), 0) as tax,
  count(*) filter (where r.status = 'A')        as cancelled
from fin_receipts r
group by r.company_nif, r.day;

create or replace view fin_daily_payments with (security_invoker = true) as
select r.company_nif, r.day, p.method, sum(p.amount) as amount
from fin_receipts r
join fin_payments p using (company_nif, receipt_no)
where r.status <> 'A'
group by r.company_nif, r.day, p.method;

-- Writes (or, with p_import_id null, only classifies) one batch of receipts.
-- A receipt already stored from a newer file is left alone, so uploading an
-- old export after a corrected one can't undo the correction.
create or replace function fin_import_batch(
  p_company        text,
  p_source_created date,
  p_receipts       jsonb,
  p_import_id      uuid default null
) returns jsonb
language plpgsql
as $$
declare
  dry       boolean := p_import_id is null;
  r         jsonb;
  v_no      text;
  v_hash    text;
  v_old     record;
  n_new     integer := 0;
  n_changed integer := 0;
  n_same    integer := 0;
  n_older   integer := 0;
  changed   text[] := '{}';
  older     text[] := '{}';
begin
  if not dry then
    select company_nif, file_created into p_company, p_source_created
    from fin_imports where id = p_import_id;
    if not found then
      raise exception 'unknown import %', p_import_id;
    end if;
  end if;

  for r in select value from jsonb_array_elements(p_receipts) loop
    v_no := r->>'receipt_no';
    v_hash := md5(r::text);
    select content_hash, source_created into v_old
    from fin_receipts where company_nif = p_company and receipt_no = v_no;

    if not found then
      n_new := n_new + 1;
    elsif v_old.content_hash = v_hash then
      n_same := n_same + 1;
      if not dry and v_old.source_created < p_source_created then
        update fin_receipts set source_created = p_source_created
        where company_nif = p_company and receipt_no = v_no;
      end if;
      continue;
    elsif v_old.source_created > p_source_created then
      n_older := n_older + 1;
      older := older || v_no;
      continue;
    else
      n_changed := n_changed + 1;
      changed := changed || v_no;
    end if;

    if dry then
      continue;
    end if;

    insert into fin_receipts as t (
      company_nif, receipt_no, receipt_type, day, entered_at, status, status_reason,
      net, tax, gross, with_tax_no, content_hash, source_created, import_id
    ) values (
      p_company, v_no, r->>'receipt_type', (r->>'day')::date, (r->>'entered_at')::timestamp,
      r->>'status', coalesce(r->>'status_reason', ''),
      (r->>'net')::numeric, (r->>'tax')::numeric, (r->>'gross')::numeric,
      coalesce((r->>'with_tax_no')::boolean, false), v_hash, p_source_created, p_import_id
    )
    on conflict (company_nif, receipt_no) do update set
      receipt_type = excluded.receipt_type, day = excluded.day, entered_at = excluded.entered_at,
      status = excluded.status, status_reason = excluded.status_reason,
      net = excluded.net, tax = excluded.tax, gross = excluded.gross,
      with_tax_no = excluded.with_tax_no, content_hash = excluded.content_hash,
      source_created = excluded.source_created, import_id = excluded.import_id;

    delete from fin_lines    where company_nif = p_company and receipt_no = v_no;
    delete from fin_payments where company_nif = p_company and receipt_no = v_no;

    insert into fin_lines (company_nif, receipt_no, line_no, product_code, product,
                           quantity, unit, unit_price, net, vat_rate)
    select p_company, v_no, l.line_no, l.product_code, l.product,
           l.quantity, coalesce(l.unit, ''), l.unit_price, l.net, l.vat_rate
    from jsonb_to_recordset(coalesce(r->'lines', '[]')) as l(
      line_no integer, product_code text, product text, quantity numeric,
      unit text, unit_price numeric, net numeric, vat_rate numeric);

    insert into fin_payments (company_nif, receipt_no, idx, method, amount)
    select p_company, v_no, (p.ord - 1)::integer, p.value->>'method', (p.value->>'amount')::numeric
    from jsonb_array_elements(coalesce(r->'payments', '[]')) with ordinality as p(value, ord);
  end loop;

  if not dry then
    update fin_imports set
      inserted = inserted + n_new, updated = updated + n_changed,
      unchanged = unchanged + n_same, skipped_older = skipped_older + n_older
    where id = p_import_id;
  end if;

  return jsonb_build_object(
    'new', n_new, 'changed', n_changed, 'unchanged', n_same, 'older', n_older,
    'changed_receipts', to_jsonb(changed), 'older_receipts', to_jsonb(older)
  );
end;
$$;

-- Only the server (secret / service_role key) may run imports.
revoke execute on function fin_import_batch(text, date, jsonb, uuid) from public, anon, authenticated;
grant execute on function fin_import_batch(text, date, jsonb, uuid) to service_role;
