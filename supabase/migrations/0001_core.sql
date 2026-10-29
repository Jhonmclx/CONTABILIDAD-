-- =====================================================================
-- CONTABILIDAD DIGITAL · 0001 · Núcleo multiempresa, roles, permisos, auditoría
-- =====================================================================
create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.member_role as enum ('admin','auxiliar','cliente');
create type public.org_status  as enum ('activa','suspendida');

-- ---------- Utilidades genéricas ----------
create or replace function public.tg_touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- Planes de suscripción ----------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  price_cop numeric(14,2),              -- null = precio por definir
  max_users int, max_clients int, max_storage_mb int, max_documents_month int,
  features jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plans_touch before update on public.plans for each row execute function public.tg_touch_updated_at();

insert into public.plans(code,name,price_cop,max_users,max_clients,max_storage_mb,max_documents_month) values
 ('inicial','Inicial',null,3,30,2048,1000),
 ('profesional','Profesional',null,10,150,10240,5000),
 ('firma','Firma',null,50,1000,51200,30000);

-- ---------- Organizaciones (firmas) ----------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug citext unique not null check (slug ~ '^[a-z0-9]([a-z0-9-]{1,58})[a-z0-9]$'),
  name text not null check (length(name) between 2 and 120),
  legal_name text,
  nit text,
  status public.org_status not null default 'activa',
  plan_id uuid references public.plans(id),
  require_segregation boolean not null default true,   -- quien prepara no aprueba
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger org_touch before update on public.organizations for each row execute function public.tg_touch_updated_at();

-- ---------- Identidad pública / tarjeta digital ----------
create table public.firm_profiles (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  commercial_name text not null default 'CONTABILIDAD DIGITAL',
  accountant_name text,
  headline text,
  description text,
  services text[] not null default '{}',
  phone text, whatsapp text, email text, address text, map_url text,
  hours text,
  socials jsonb not null default '{}',
  logo_url text, photo_url text,
  color_primary text not null default '#10b981' check (color_primary ~ '^#[0-9a-fA-F]{6}$'),
  color_secondary text not null default '#0b1530' check (color_secondary ~ '^#[0-9a-fA-F]{6}$'),
  color_accent text not null default '#d4af37' check (color_accent ~ '^#[0-9a-fA-F]{6}$'),
  custom_domain text,
  is_published boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger firm_touch before update on public.firm_profiles for each row execute function public.tg_touch_updated_at();

-- ---------- Perfiles de usuario ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email citext,
  phone text,
  is_superadmin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.tg_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.tg_new_user();

-- ---------- Clientes (empresas/personas atendidas por la firma) ----------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_type text not null default 'juridica' check (person_type in ('natural','juridica')),
  name text not null check (length(name) between 2 and 200),
  id_type text not null default 'NIT' check (id_type in ('NIT','CC','CE','PAS','PPT','OTRO')),
  id_number text not null check (id_number ~ '^[0-9A-Za-z-]{3,20}$'),
  dv text check (dv is null or dv ~ '^[0-9]$'),
  email citext, phone text, address text, city text,
  economic_activity text,            -- código CIIU
  tax_regime text,
  fiscal_responsibilities text[] not null default '{}',
  accounting_period text not null default 'mensual' check (accounting_period in ('mensual','bimestral','trimestral','cuatrimestral','semestral','anual')),
  bank_info jsonb,                   -- solo información bancaria autorizada
  status text not null default 'activo' check (status in ('prospecto','activo','inactivo')),
  file_status text not null default 'al_dia' check (file_status in ('al_dia','pendiente_documentos','en_revision','con_alertas')),
  tags text[] not null default '{}',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id_type, id_number)
);
create index on public.clients(org_id);
create trigger clients_touch before update on public.clients for each row execute function public.tg_touch_updated_at();

-- ---------- Membresías ----------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  client_id uuid references public.clients(id) on delete cascade,  -- solo para rol cliente
  status text not null default 'activa' check (status in ('activa','suspendida')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id),
  check ((role = 'cliente') = (client_id is not null))
);
create index on public.memberships(user_id);

create table public.client_assignments (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (membership_id, client_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email citext not null,
  role public.member_role not null,
  client_id uuid references public.clients(id) on delete cascade,
  invited_by uuid default auth.uid(),
  status text not null default 'pendiente' check (status in ('pendiente','aceptada','revocada')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  check ((role = 'cliente') = (client_id is not null))
);
create unique index invitations_open_uniq on public.invitations(org_id, email) where status = 'pendiente';

-- ---------- Permisos configurables por rol ----------
create table public.role_permissions (
  org_id uuid not null references public.organizations(id) on delete cascade,
  role public.member_role not null check (role <> 'admin'),
  module text not null check (module in ('clientes','documentos','contabilidad','conciliacion','cartera','tributario','tareas','informes')),
  action text not null check (action in ('ver','crear','editar','aprobar','exportar')),
  allowed boolean not null,
  primary key (org_id, role, module, action)
);

-- ---------- Contactos y notas internas ----------
create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null, role text, email citext, phone text,
  created_at timestamptz not null default now()
);
create table public.client_notes (            -- nunca visibles para el cliente
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  body text not null,
  author_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------- Auditoría (solo inserción) ----------
create table public.audit_log (
  id bigserial primary key,
  org_id uuid,          -- sin FK: el historial se conserva aunque se elimine la firma
  user_id uuid,
  at timestamptz not null default now(),
  action text not null,
  entity text not null,
  entity_id text,
  result text not null default 'ok',
  reason text,
  old_data jsonb,
  new_data jsonb
);
create index on public.audit_log(org_id, at desc);

create or replace function public.tg_audit_immutable() returns trigger
language plpgsql as $$
begin raise exception 'Los registros de auditoría no se pueden modificar ni borrar'; end $$;
create trigger audit_no_update before update or delete on public.audit_log
  for each row execute function public.tg_audit_immutable();

-- Limpia datos sensibles antes de guardarlos en auditoría
create or replace function public.audit_sanitize(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null then null
    else (j - 'bank_info' - 'raw_text' - 'password' - 'token')
         || case when j ? 'bank_info' then jsonb_build_object('bank_info','[protegido]') else '{}'::jsonb end
  end $$;

create or replace function public.tg_audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; v_org uuid; v_id text;
begin
  v_old := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_org := coalesce((v_new->>'org_id')::uuid, (v_old->>'org_id')::uuid, (v_new->>'id')::uuid);
  if tg_table_name = 'organizations' then v_org := coalesce((v_new->>'id')::uuid,(v_old->>'id')::uuid); end if;
  v_id  := coalesce(v_new->>'id', v_old->>'id', v_new->>'membership_id', v_old->>'membership_id');
  insert into public.audit_log(org_id,user_id,action,entity,entity_id,old_data,new_data)
  values (v_org, auth.uid(), lower(tg_op), tg_table_name, v_id, audit_sanitize(v_old), audit_sanitize(v_new));
  return coalesce(new, old);
end $$;

-- ---------- Funciones de autorización (base de RLS) ----------
create or replace function public.is_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_superadmin from public.profiles where id = auth.uid()), false) $$;

create or replace function public.my_role(p_org uuid) returns public.member_role
language sql stable security definer set search_path = public as $$
  select m.role from public.memberships m
  join public.organizations o on o.id = m.org_id and o.status = 'activa'
  where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'activa' $$;

create or replace function public.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(p_org) = 'admin', false) $$;

create or replace function public.is_org_staff(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(p_org) in ('admin','auxiliar'), false) $$;

create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role(p_org) is not null $$;

-- Staff que puede trabajar con un cliente: admin de la firma o auxiliar asignado
create or replace function public.can_staff_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
    join public.memberships m on m.org_id = c.org_id and m.user_id = auth.uid() and m.status = 'activa'
    join public.organizations o on o.id = c.org_id and o.status = 'activa'
    where c.id = p_client
      and (m.role = 'admin'
           or (m.role = 'auxiliar' and exists (
                 select 1 from public.client_assignments a where a.membership_id = m.id and a.client_id = c.id))))
$$;

-- Usuario con rol cliente vinculado a ese cliente
create or replace function public.is_client_user(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id and o.status = 'activa'
    where m.user_id = auth.uid() and m.status = 'activa' and m.role = 'cliente' and m.client_id = p_client) $$;

create or replace function public.default_perm(p_role public.member_role, p_module text, p_action text) returns boolean
language sql immutable as $$
  select case
    when p_role = 'admin' then true
    when p_role = 'auxiliar' then p_action in ('ver','crear','editar') or (p_module = 'informes' and p_action = 'exportar')
    else false end $$;

create or replace function public.has_perm(p_org uuid, p_module text, p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.member_role; v boolean;
begin
  r := public.my_role(p_org);
  if r is null then return false; end if;
  if r = 'admin' then return true; end if;
  select allowed into v from public.role_permissions
   where org_id = p_org and role = r and module = p_module and action = p_action;
  return coalesce(v, public.default_perm(r, p_module, p_action));
end $$;

create or replace function public.client_org(p_client uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.clients where id = p_client $$;

-- Puede el usuario actual trabajar sobre (cliente, módulo, acción)
create or replace function public.can_client_action(p_client uuid, p_module text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_staff_client(p_client) and public.has_perm(public.client_org(p_client), p_module, p_action) $$;

-- ---------- Integridad: org_id siempre derivado del cliente ----------
create or replace function public.tg_set_org_from_client() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if new.client_id is null then raise exception 'client_id es obligatorio'; end if;
  if tg_op = 'UPDATE' and new.client_id is distinct from old.client_id then
    raise exception 'No se permite mover registros entre clientes';
  end if;
  select org_id into v_org from public.clients where id = new.client_id;
  if v_org is null then raise exception 'Cliente inexistente'; end if;
  new.org_id := v_org;   -- ignora cualquier org_id enviado por el usuario
  return new;
end $$;

create or replace function public.tg_lock_org_id() returns trigger
language plpgsql as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'No se permite cambiar la organización de un registro';
  end if;
  return new;
end $$;

create trigger clients_lock_org before update on public.clients for each row execute function public.tg_lock_org_id();
create trigger contacts_org before insert or update on public.client_contacts for each row execute function public.tg_set_org_from_client();
create trigger notes_org before insert or update on public.client_notes for each row execute function public.tg_set_org_from_client();

create or replace function public.tg_assignment_org() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_m_org uuid; v_c_org uuid;
begin
  select org_id into v_m_org from public.memberships where id = new.membership_id;
  select org_id into v_c_org from public.clients where id = new.client_id;
  if v_m_org is null or v_m_org <> v_c_org then raise exception 'Asignación entre organizaciones distintas'; end if;
  new.org_id := v_m_org; return new;
end $$;
create trigger assignment_org before insert or update on public.client_assignments for each row execute function public.tg_assignment_org();

create or replace function public.tg_membership_client_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is not null and public.client_org(new.client_id) <> new.org_id then
    raise exception 'El cliente no pertenece a la organización';
  end if;
  return new;
end $$;
create trigger membership_client_org before insert or update on public.memberships for each row execute function public.tg_membership_client_org();
create trigger invitation_client_org before insert or update on public.invitations for each row execute function public.tg_membership_client_org();

-- Auditoría de tablas núcleo
create trigger audit_organizations after insert or update or delete on public.organizations for each row execute function public.tg_audit_row();
create trigger audit_firm after update on public.firm_profiles for each row execute function public.tg_audit_row();
create trigger audit_clients after insert or update or delete on public.clients for each row execute function public.tg_audit_row();
create trigger audit_memberships after insert or update or delete on public.memberships for each row execute function public.tg_audit_row();
create trigger audit_assignments after insert or delete on public.client_assignments for each row execute function public.tg_audit_row();
create trigger audit_permissions after insert or update or delete on public.role_permissions for each row execute function public.tg_audit_row();
create trigger audit_invitations after insert or update on public.invitations for each row execute function public.tg_audit_row();
