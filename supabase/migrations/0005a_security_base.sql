-- =====================================================================
-- 0005 · Políticas RLS, privilegios, almacenamiento y datos de referencia
-- =====================================================================

-- ---------- Funciones auxiliares de acceso ----------
create or replace function public.has_support_access(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_superadmin() and exists (
    select 1 from public.support_access_grants g
    where g.org_id = p_org and g.superadmin_id = auth.uid() and g.expires_at > now()) $$;

create or replace function public.can_read_document(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.documents d where d.id = p_doc and (
      public.can_client_action(d.client_id,'documentos','ver')
      or (public.is_client_user(d.client_id) and d.visible_to_client)
      or public.has_support_access(d.org_id))) $$;

create or replace function public.shares_org_as_staff(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships mine join public.memberships theirs on theirs.org_id = mine.org_id
                 where mine.user_id = auth.uid() and mine.status = 'activa' and mine.role in ('admin','auxiliar')
                   and theirs.user_id = p_user) $$;

-- Ruta de almacenamiento: {org_id}/{client_id}/{archivo}
create or replace function public.storage_can_upload(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text[]; v_org uuid; v_client uuid;
begin
  f := string_to_array(p_name, '/');
  if array_length(f,1) <> 3 then return false; end if;
  v_org := f[1]::uuid; v_client := f[2]::uuid;
  if public.client_org(v_client) is distinct from v_org then return false; end if;
  return public.can_client_action(v_client,'documentos','crear') or public.is_client_user(v_client);
exception when others then return false;
end $$;

create or replace function public.storage_can_read(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.documents d where d.storage_path = p_name and public.can_read_document(d.id)) $$;

create or replace function public.branding_can_write(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return public.is_org_admin((string_to_array(p_name,'/'))[1]::uuid);
exception when others then return false;
end $$;

-- Un auxiliar que crea un cliente queda asignado a él
create or replace function public.tg_client_autoassign() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_m uuid;
begin
  select id into v_m from public.memberships where org_id = new.org_id and user_id = auth.uid() and role = 'auxiliar';
  if v_m is not null then
    insert into public.client_assignments(membership_id, client_id, org_id) values (v_m, new.id, new.org_id) on conflict do nothing;
  end if;
  return null;
end $$;
create trigger clients_autoassign after insert on public.clients for each row execute function public.tg_client_autoassign();

create or replace function public.get_privacy_policy(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('version', p.version, 'content', p.content, 'published_at', p.published_at)
  from public.privacy_policies p join public.organizations o on o.id = p.org_id
  where o.slug = lower(p_slug) and p.published_at is not null
  order by p.published_at desc limit 1 $$;

-- ---------- Activar RLS en todas las tablas ----------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
revoke all on public.ledger_entries, public.invoice_balances from anon;

-- ---------- Políticas ----------
-- Organizaciones
create policy org_select on public.organizations for select to authenticated using (public.is_org_member(id) or public.is_superadmin());
create policy org_update on public.organizations for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));
revoke insert, update, delete on public.organizations from authenticated;
grant update (name, legal_name, nit, require_segregation) on public.organizations to authenticated;

create policy firm_select on public.firm_profiles for select to authenticated using (public.is_org_member(org_id));
create policy firm_update on public.firm_profiles for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
revoke insert, delete on public.firm_profiles from authenticated;

create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.shares_org_as_staff(id) or public.is_superadmin());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create policy plans_select on public.plans for select to authenticated using (true);
create policy plans_admin on public.plans for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

create policy memb_select on public.memberships for select to authenticated using (user_id = auth.uid() or public.is_org_staff(org_id));
revoke insert, update, delete on public.memberships from authenticated;
create policy assign_select on public.client_assignments for select to authenticated using (public.is_org_staff(org_id));
revoke insert, update, delete on public.client_assignments from authenticated;
create policy inv_select on public.invitations for select to authenticated using (public.is_org_admin(org_id));
create policy inv_update on public.invitations for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id) and status = 'revocada');
revoke insert, delete on public.invitations from authenticated;

create policy perm_select on public.role_permissions for select to authenticated using (public.is_org_member(org_id));
create policy perm_write on public.role_permissions for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- Clientes
create policy clients_select on public.clients for select to authenticated
  using (public.can_client_action(id,'clientes','ver') or public.is_client_user(id) or public.has_support_access(org_id));
create policy clients_insert on public.clients for insert to authenticated
  with check (public.is_org_staff(org_id) and public.has_perm(org_id,'clientes','crear'));
create policy clients_update on public.clients for update to authenticated
  using (public.can_client_action(id,'clientes','editar')) with check (public.can_client_action(id,'clientes','editar'));
create policy clients_delete on public.clients for delete to authenticated using (public.is_org_admin(org_id));

create policy contacts_select on public.client_contacts for select to authenticated using (public.can_client_action(client_id,'clientes','ver') or public.is_client_user(client_id));
create policy contacts_write on public.client_contacts for all to authenticated
  using (public.can_client_action(client_id,'clientes','editar')) with check (public.can_client_action(client_id,'clientes','editar'));
create policy notes_select on public.client_notes for select to authenticated using (public.can_client_action(client_id,'clientes','ver'));
create policy notes_insert on public.client_notes for insert to authenticated with check (public.can_client_action(client_id,'clientes','editar') and author_id = auth.uid());
create policy notes_delete on public.client_notes for delete to authenticated using (author_id = auth.uid() or public.is_org_admin(org_id));

create policy audit_select on public.audit_log for select to authenticated using (public.is_org_admin(org_id) or (public.is_superadmin() and org_id is null));
revoke insert, update, delete on public.audit_log from authenticated;

