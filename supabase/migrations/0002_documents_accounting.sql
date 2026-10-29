-- =====================================================================
-- 0002 · Centro documental, extracción OCR/IA y núcleo contable
-- =====================================================================

-- ---------- Documentos ----------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  period text check (period is null or period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  doc_type text not null default 'otro' check (doc_type in
    ('factura_compra','factura_venta','extracto_bancario','nomina','soporte','declaracion','certificado','entregable','otro')),
  title text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  tags text[] not null default '{}',
  status text not null default 'recibido' check (status in ('recibido','en_proceso','procesado','requiere_revision','error','archivado')),
  version int not null default 1,
  parent_id uuid references public.documents(id),
  visible_to_client boolean not null default false,
  source text not null default 'firma' check (source in ('firma','cliente')),
  duplicate_of uuid references public.documents(id),
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.documents(client_id, period);
create index on public.documents(sha256);
create trigger documents_org before insert or update on public.documents for each row execute function public.tg_set_org_from_client();
create trigger documents_touch before update on public.documents for each row execute function public.tg_touch_updated_at();

-- Detecta duplicados por huella (no elimina nada)
create or replace function public.tg_document_duplicate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sha256 is not null then
    select id into new.duplicate_of from public.documents
     where client_id = new.client_id and sha256 = new.sha256 and id <> new.id
     order by created_at limit 1;
  end if;
  if new.source = 'cliente' then new.visible_to_client := true; end if;
  return new;
end $$;
create trigger documents_dup before insert on public.documents for each row execute function public.tg_document_duplicate();

create table public.document_events (
  id bigserial primary key,
  org_id uuid not null,
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid default auth.uid(),
  event text not null check (event in ('subido','consultado','descargado','modificado','aprobado','nueva_version','archivado')),
  at timestamptz not null default now()
);

create table public.document_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  description text,
  period text,
  due_date date,
  status text not null default 'pendiente' check (status in ('pendiente','recibido','cerrado','cancelado')),
  fulfilled_document_id uuid references public.documents(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create trigger docreq_org before insert or update on public.document_requests for each row execute function public.tg_set_org_from_client();

-- ---------- Extracción (OCR / XML / IA) ----------
create table public.extractions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  provider text not null default 'pendiente',
  status text not null default 'pendiente' check (status in
    ('pendiente','procesando','extraido','requiere_revision','revisado','aprobado','error','pendiente_proveedor')),
  fields jsonb not null default '{}',
  confidence jsonb not null default '{}',
  issues text[] not null default '{}',
  raw_text text,
  error text,
  attempts int not null default 0,
  possible_duplicate_of uuid references public.extractions(id),
  reviewed_by uuid, reviewed_at timestamptz,
  approved_by uuid, approved_at timestamptz,
  voucher_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index extractions_doc_uniq on public.extractions(document_id);
create trigger extractions_org before insert or update on public.extractions for each row execute function public.tg_set_org_from_client();
create trigger extractions_touch before update on public.extractions for each row execute function public.tg_touch_updated_at();

-- Duplicado de factura: mismo emisor + número (o emisor + fecha + total)
create or replace function public.tg_extraction_duplicate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fields ? 'numero_factura' and new.fields ? 'nit_emisor' then
    select id into new.possible_duplicate_of from public.extractions e
     where e.client_id = new.client_id and e.id <> new.id
       and e.fields->>'nit_emisor' = new.fields->>'nit_emisor'
       and (e.fields->>'numero_factura' = new.fields->>'numero_factura'
            or (e.fields->>'fecha_emision' = new.fields->>'fecha_emision' and e.fields->>'total' = new.fields->>'total'))
     order by e.created_at limit 1;
    if new.possible_duplicate_of is not null and not ('posible_duplicado' = any(new.issues)) then
      new.issues := array_append(new.issues, 'posible_duplicado');
    end if;
  end if;
  return new;
end $$;
create trigger extractions_dup before insert or update of fields on public.extractions for each row execute function public.tg_extraction_duplicate();

-- ---------- Contabilidad ----------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{1,12}$'),
  name text not null,
  account_type text not null check (account_type in ('activo','pasivo','patrimonio','ingreso','gasto','costo','orden_deudora','orden_acreedora')),
  nature text not null check (nature in ('debito','credito')),
  accepts_movements boolean not null default true,
  requires_third_party boolean not null default false,
  requires_cost_center boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, code)
);
create trigger accounts_org before insert or update on public.accounts for each row execute function public.tg_set_org_from_client();

create table public.third_parties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  id_type text not null default 'NIT',
  id_number text not null,
  dv text,
  name text not null,
  email citext, phone text, address text,
  created_at timestamptz not null default now(),
  unique (client_id, id_number)
);
create trigger third_org before insert or update on public.third_parties for each row execute function public.tg_set_org_from_client();

create table public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  code text not null, name text not null, is_active boolean not null default true,
  unique (client_id, code)
);
create trigger cc_org before insert or update on public.cost_centers for each row execute function public.tg_set_org_from_client();

create table public.periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  month int not null check (month between 1 and 12),
  status text not null default 'abierto' check (status in ('abierto','cerrado')),
  closed_by uuid, closed_at timestamptz,
  unique (client_id, year, month)
);
create trigger periods_org before insert or update on public.periods for each row execute function public.tg_set_org_from_client();

create table public.vouchers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  voucher_type text not null default 'CC' check (voucher_type ~ '^[A-Z]{1,4}$'),
  number int,
  date date not null,
  description text not null,
  status text not null default 'borrador' check (status in ('borrador','en_revision','devuelto','contabilizado','anulado')),
  source text not null default 'manual' check (source in ('manual','ia','xml','conciliacion','reverso','importacion')),
  extraction_id uuid references public.extractions(id),
  document_id uuid references public.documents(id),
  reversal_of uuid references public.vouchers(id),
  reversed_by uuid references public.vouchers(id),
  prepared_by uuid default auth.uid(),
  approved_by uuid, approved_at timestamptz,
  return_reason text,
  total_debit numeric(18,2) not null default 0,
  total_credit numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, voucher_type, number)
);
create index on public.vouchers(client_id, date);
create trigger vouchers_org before insert or update on public.vouchers for each row execute function public.tg_set_org_from_client();
create trigger vouchers_touch before update on public.vouchers for each row execute function public.tg_touch_updated_at();

create table public.voucher_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null,
  voucher_id uuid not null references public.vouchers(id) on delete cascade,
  line_no int not null default 1,
  account_id uuid not null references public.accounts(id),
  third_party_id uuid references public.third_parties(id),
  cost_center_id uuid references public.cost_centers(id),
  description text,
  debit numeric(18,2) not null default 0 check (debit >= 0),
  credit numeric(18,2) not null default 0 check (credit >= 0),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index on public.voucher_lines(voucher_id);
create index on public.voucher_lines(account_id);

-- Las líneas heredan org/cliente del comprobante; cuentas y terceros deben ser del mismo cliente
create or replace function public.tg_line_integrity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_org uuid;
begin
  select client_id, org_id into v_client, v_org from public.vouchers where id = new.voucher_id;
  if v_client is null then raise exception 'Comprobante inexistente'; end if;
  new.client_id := v_client; new.org_id := v_org;
  if not exists (select 1 from public.accounts where id = new.account_id and client_id = v_client) then
    raise exception 'La cuenta no pertenece al cliente del comprobante';
  end if;
  if new.third_party_id is not null and not exists (select 1 from public.third_parties where id = new.third_party_id and client_id = v_client) then
    raise exception 'El tercero no pertenece al cliente';
  end if;
  if new.cost_center_id is not null and not exists (select 1 from public.cost_centers where id = new.cost_center_id and client_id = v_client) then
    raise exception 'El centro de costos no pertenece al cliente';
  end if;
  return new;
end $$;
create trigger lines_integrity before insert or update on public.voucher_lines for each row execute function public.tg_line_integrity();

-- Bloqueo: comprobantes contabilizados/anulados no se modifican salvo por procedimientos autorizados
create or replace function public.tg_voucher_lock() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.voucher_proc', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.status in ('contabilizado','anulado') then raise exception 'Un comprobante contabilizado no se puede eliminar; use un reverso'; end if;
    return old;
  end if;
  if old.status in ('contabilizado','anulado') then
    raise exception 'Un comprobante contabilizado no se puede modificar; use un reverso o ajuste';
  end if;
  return new;
end $$;   -- versión completa en 0004
create trigger vouchers_lock before update or delete on public.vouchers for each row execute function public.tg_voucher_lock();

create or replace function public.tg_lines_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text; v_id uuid;
begin
  if coalesce(current_setting('app.voucher_proc', true), '') = 'on' then return coalesce(new, old); end if;
  v_id := coalesce(new.voucher_id, old.voucher_id);
  select status into v_status from public.vouchers where id = v_id;
  if v_status in ('contabilizado','anulado','en_revision') then
    raise exception 'Las líneas de un comprobante en estado % no se pueden modificar', v_status;
  end if;
  return coalesce(new, old);
end $$;
create trigger lines_lock before insert or update or delete on public.voucher_lines for each row execute function public.tg_lines_lock();

-- Totales del comprobante
create or replace function public.tg_lines_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_prev text;
begin
  v_id := coalesce(new.voucher_id, old.voucher_id);
  v_prev := coalesce(current_setting('app.voucher_proc', true), '');
  perform set_config('app.voucher_proc','on', true);
  update public.vouchers v set
    total_debit  = coalesce((select sum(debit)  from public.voucher_lines where voucher_id = v_id),0),
    total_credit = coalesce((select sum(credit) from public.voucher_lines where voucher_id = v_id),0)
  where v.id = v_id;
  perform set_config('app.voucher_proc', v_prev, true);
  return null;
end $$;
create trigger lines_totals after insert or update or delete on public.voucher_lines for each row execute function public.tg_lines_totals();

create trigger audit_vouchers after insert or update or delete on public.vouchers for each row execute function public.tg_audit_row();
create trigger audit_lines after insert or update or delete on public.voucher_lines for each row execute function public.tg_audit_row();
create trigger audit_periods after insert or update on public.periods for each row execute function public.tg_audit_row();
create trigger audit_accounts after insert or update or delete on public.accounts for each row execute function public.tg_audit_row();
create trigger audit_documents after insert or update or delete on public.documents for each row execute function public.tg_audit_row();
create trigger audit_extractions after update of status on public.extractions for each row execute function public.tg_audit_row();
