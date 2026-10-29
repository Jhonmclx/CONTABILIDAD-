-- =====================================================================
-- 0003 · Conciliación, cartera, calendario tributario, tareas,
--        notificaciones, mensajería, privacidad y sitio público
-- =====================================================================

-- ---------- Conciliación bancaria ----------
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  bank_name text,
  number_last4 text check (number_last4 is null or number_last4 ~ '^[0-9]{4}$'),
  ledger_account_id uuid references public.accounts(id),
  created_at timestamptz not null default now()
);
create trigger bankacc_org before insert or update on public.bank_accounts for each row execute function public.tg_set_org_from_client();

create table public.bank_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  source_document_id uuid references public.documents(id),
  status text not null default 'en_proceso' check (status in ('en_proceso','en_revision','aprobada')),
  imported_by uuid default auth.uid(),
  approved_by uuid, approved_at timestamptz,
  created_at timestamptz not null default now()
);
create trigger stmt_org before insert or update on public.bank_statements for each row execute function public.tg_set_org_from_client();

create table public.bank_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  statement_id uuid not null references public.bank_statements(id) on delete cascade,
  date date not null,
  description text not null,
  reference text,
  amount numeric(18,2) not null check (amount <> 0),     -- + entrada, - salida
  category text check (category in ('comision','transferencia','pago','recaudo','impuesto','interes','otro')),
  status text not null default 'sin_conciliar' check (status in ('sin_conciliar','propuesta','conciliada','sin_correspondencia')),
  line_hash text not null,
  unique (statement_id, line_hash)
);
create trigger bankline_org before insert or update on public.bank_lines for each row execute function public.tg_set_org_from_client();

create table public.reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  bank_line_id uuid not null references public.bank_lines(id) on delete cascade,
  voucher_line_id uuid references public.voucher_lines(id),
  match_type text not null check (match_type in ('exacta','aproximada','manual')),
  score numeric(5,2) not null default 0,
  decision text not null default 'propuesta' check (decision in ('propuesta','aceptada','rechazada')),
  justification text,
  decided_by uuid, decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bank_line_id, voucher_line_id)
);
create trigger match_org before insert or update on public.reconciliation_matches for each row execute function public.tg_set_org_from_client();
create trigger audit_matches after insert or update on public.reconciliation_matches for each row execute function public.tg_audit_row();
create trigger audit_statements after insert or update on public.bank_statements for each row execute function public.tg_audit_row();

-- ---------- Cuentas por cobrar / por pagar ----------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('cobrar','pagar')),
  third_party_id uuid references public.third_parties(id),
  third_party_name text not null,
  number text not null,
  issue_date date not null,
  due_date date,
  subtotal numeric(18,2) not null default 0,
  tax numeric(18,2) not null default 0,
  withholding numeric(18,2) not null default 0,
  total numeric(18,2) not null check (total >= 0),
  currency text not null default 'COP',
  verification text not null default 'por_verificar' check (verification in ('documentado','por_verificar')),
  status text not null default 'pendiente' check (status in ('pendiente','parcial','pagada','anulada')),
  document_id uuid references public.documents(id),
  extraction_id uuid references public.extractions(id),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (client_id, kind, third_party_name, number)
);
create trigger inv_org before insert or update on public.invoices for each row execute function public.tg_set_org_from_client();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  date date not null,
  amount numeric(18,2) not null check (amount > 0),
  method text,
  reference text,
  confirmed boolean not null default false,
  confirmed_by uuid, confirmed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create trigger pay_org before insert or update on public.payments for each row execute function public.tg_set_org_from_client();
create trigger audit_payments after insert or update or delete on public.payments for each row execute function public.tg_audit_row();

-- Estado de la factura según pagos CONFIRMADOS
create or replace function public.tg_invoice_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_inv uuid; v_paid numeric; v_total numeric;
begin
  v_inv := coalesce(new.invoice_id, old.invoice_id);
  select coalesce(sum(amount),0) into v_paid from public.payments where invoice_id = v_inv and confirmed;
  select total into v_total from public.invoices where id = v_inv;
  update public.invoices set status = case when v_paid <= 0 then 'pendiente' when v_paid < v_total then 'parcial' else 'pagada' end
   where id = v_inv and status <> 'anulada';
  return null;
end $$;
create trigger pay_status after insert or update or delete on public.payments for each row execute function public.tg_invoice_status();

-- ---------- Calendario tributario ----------
-- Reglas configurables con vigencia, fuente, versión y estado de validación.
create table public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,  -- null = plantilla global
  code text not null,
  name text not null,
  authority text not null default 'DIAN',
  periodicity text not null check (periodicity in ('mensual','bimestral','cuatrimestral','semestral','anual','unica')),
  applies_to text,                 -- descripción de a quién aplica (responsabilidad, tipo de persona)
  responsibility_code text,        -- código de responsabilidad RUT relacionado, si aplica
  source_url text,
  source_note text,
  version text not null default '1',
  valid_from date, valid_to date,
  validation_status text not null default 'sin_verificar' check (validation_status in ('sin_verificar','verificada','obsoleta')),
  validated_by uuid, validated_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index tax_rules_uniq on public.tax_rules(coalesce(org_id,'00000000-0000-0000-0000-000000000000'::uuid), code, version);

-- Fechas por periodo y último(s) dígito(s) del NIT
create table public.tax_rule_dates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid not null references public.tax_rules(id) on delete cascade,
  period_label text not null,          -- ej. 2026-01, 2026-B1, 2025
  nit_digits text not null default '*' check (nit_digits ~ '^(\*|[0-9]{1,2}(-[0-9]{1,2})?)$'),
  due_date date not null,
  unique (rule_id, period_label, nit_digits)
);

create table public.obligations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  rule_id uuid references public.tax_rules(id),
  name text not null,
  period_label text not null,
  due_date date,
  date_confirmed boolean not null default false,   -- falso = la fecha debe confirmarse con fuente oficial
  responsible_id uuid,
  status text not null default 'pendiente' check (status in ('pendiente','en_preparacion','presentada','pagada','vencida','no_aplica')),
  amount numeric(18,2),
  presented_at date, paid_at date,
  support_document_id uuid references public.documents(id),
  notes text,
  created_at timestamptz not null default now(),
  unique (client_id, rule_id, period_label)
);
create trigger obl_org before insert or update on public.obligations for each row execute function public.tg_set_org_from_client();
create trigger audit_obligations after insert or update on public.obligations for each row execute function public.tg_audit_row();

-- ---------- Tareas ----------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  task_type text not null default 'general',
  title text not null,
  description text,
  assignee_id uuid,
  priority text not null default 'media' check (priority in ('baja','media','alta','urgente')),
  due_date date,
  status text not null default 'pendiente' check (status in ('pendiente','en_proceso','en_revision','devuelta','aprobada','completada','bloqueada')),
  document_id uuid references public.documents(id) on delete set null,
  voucher_id uuid references public.vouchers(id) on delete set null,
  obligation_id uuid references public.obligations(id) on delete set null,
  statement_id uuid references public.bank_statements(id) on delete set null,
  notes text,
  dedupe_key text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tasks_dedupe on public.tasks(org_id, dedupe_key) where dedupe_key is not null;
create index on public.tasks(org_id, status);
create trigger tasks_touch before update on public.tasks for each row execute function public.tg_touch_updated_at();

create or replace function public.tg_task_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is not null then new.org_id := public.client_org(new.client_id); end if;
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then raise exception 'No se permite cambiar la organización'; end if;
  return new;
end $$;
create trigger tasks_org before insert or update on public.tasks for each row execute function public.tg_task_org();

create table public.task_events (
  id bigserial primary key,
  org_id uuid not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid default auth.uid(),
  from_status text, to_status text,
  comment text,
  at timestamptz not null default now()
);
create or replace function public.tg_task_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events(org_id,task_id,to_status,comment) values (new.org_id,new.id,new.status,'Creada');
  elsif new.status is distinct from old.status or new.assignee_id is distinct from old.assignee_id then
    insert into public.task_events(org_id,task_id,from_status,to_status,comment)
    values (new.org_id,new.id,old.status,new.status,
      case when new.assignee_id is distinct from old.assignee_id then 'Responsable actualizado' end);
  end if;
  return null;
end $$;
create trigger tasks_history after insert or update on public.tasks for each row execute function public.tg_task_history();

-- Reglas de automatización
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  event text not null check (event in ('documento_recibido','documento_faltante','vencimiento_proximo','conciliacion_diferencias','comprobante_devuelto')),
  is_active boolean not null default true,
  default_assignee_id uuid,
  priority text not null default 'media',
  days_before int not null default 5,
  unique (org_id, event)
);

create table public.job_runs (
  id bigserial primary key,
  job text not null,
  org_id uuid,
  status text not null check (status in ('ok','error')),
  detail text,
  attempts int not null default 1,
  at timestamptz not null default now()
);

-- ---------- Notificaciones y mensajería ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notif_dedupe on public.notifications(user_id, dedupe_key) where dedupe_key is not null;
create index on public.notifications(user_id, read_at);

create table public.channel_settings (
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('email','whatsapp')),
  enabled boolean not null default false,
  provider text,
  provider_configured boolean not null default false,   -- lo marca el servidor al detectar credenciales
  max_per_hour int not null default 30 check (max_per_hour between 1 and 1000),
  allowed_kinds text[] not null default '{tarea_asignada,documento_solicitado,vencimiento_proximo}',
  primary key (org_id, channel)
);

-- Cola de salida: nunca contiene cifras ni datos financieros, solo avisos genéricos
create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('email','whatsapp')),
  to_address text not null,
  kind text not null,
  subject text,
  body text not null check (length(body) <= 600),
  status text not null default 'en_cola' check (status in ('en_cola','bloqueado','enviado','error','limitado')),
  dedupe_key text not null,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (org_id, channel, dedupe_key)
);

-- ---------- Protección de datos (Ley 1581 de 2012) ----------
create table public.privacy_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  version text not null,
  content text not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, version)
);
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid default auth.uid(),
  subject_name text, subject_email citext,
  policy_version text not null,
  purpose text not null default 'tratamiento_datos',
  channel text not null default 'plataforma',
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create table public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  requester_name text not null check (length(requester_name) between 2 and 120),
  requester_email citext not null,
  requester_id_number text,
  request_type text not null check (request_type in ('consulta','actualizacion','rectificacion','supresion','revocatoria','prueba_autorizacion')),
  description text not null check (length(description) <= 2000),
  status text not null default 'recibida' check (status in ('recibida','en_tramite','respondida','rechazada')),
  due_date date,
  response text,
  handled_by uuid,
  created_at timestamptz not null default now()
);
create trigger audit_dsr after insert or update on public.data_subject_requests for each row execute function public.tg_audit_row();

-- ---------- Sitio público ----------
create table public.appointment_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(name) between 2 and 120),
  phone text check (phone is null or length(phone) <= 30),
  email citext,
  message text check (message is null or length(message) <= 1000),
  preferred_date date,
  card_ref text check (card_ref is null or card_ref ~ '^[A-Za-z0-9_-]{1,40}$'),
  consent boolean not null,
  status text not null default 'nueva' check (status in ('nueva','contactada','agendada','descartada')),
  created_at timestamptz not null default now(),
  check (consent)
);
create table public.card_visits (
  id bigserial primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  card_ref text,
  at timestamptz not null default now()
);

-- ---------- Acceso excepcional de soporte (superadmin) ----------
create table public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  superadmin_id uuid not null references auth.users(id),
  granted_by uuid not null default auth.uid(),
  reason text not null check (length(reason) >= 10),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at <= created_at + interval '72 hours')
);
create trigger audit_support after insert on public.support_access_grants for each row execute function public.tg_audit_row();
