-- =====================================================================
-- 0004 · Lógica de negocio en servidor (RPC) y automatizaciones
-- =====================================================================

-- ---------- Notificaciones (internas) ----------
create or replace function public.enqueue_message(p_org uuid, p_user uuid, p_kind text, p_subject text, p_body text, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
declare s record; v_email text;
begin
  -- Solo se encola si el canal está habilitado, con proveedor configurado y el tipo de aviso permitido.
  for s in select * from public.channel_settings where org_id = p_org and enabled and provider_configured and p_kind = any(allowed_kinds) loop
    if s.channel = 'email' then
      select email into v_email from public.profiles where id = p_user;
      if v_email is not null then
        insert into public.outbound_messages(org_id,channel,to_address,kind,subject,body,dedupe_key)
        values (p_org,'email',v_email,p_kind,p_subject,left(p_body,600),p_dedupe||':'||p_user)
        on conflict do nothing;
      end if;
    end if;
    -- WhatsApp: requiere número verificado y plantilla aprobada por el proveedor (pendiente de configurar)
  end loop;
end $$;

create or replace function public.notify_user(p_org uuid, p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications(org_id,user_id,kind,title,body,link,dedupe_key)
  values (p_org,p_user,p_kind,p_title,p_body,p_link,p_dedupe)
  on conflict do nothing;
  if found then perform public.enqueue_message(p_org,p_user,p_kind,p_title,'Tienes un nuevo aviso en la plataforma: '||p_title,coalesce(p_dedupe,gen_random_uuid()::text)); end if;
end $$;

-- Avisa a administradores de la firma y auxiliares asignados al cliente
create or replace function public.notify_staff(p_org uuid, p_client uuid, p_kind text, p_title text, p_body text, p_link text, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select distinct m.user_id from public.memberships m
    where m.org_id = p_org and m.status = 'activa'
      and (m.role = 'admin' or (m.role = 'auxiliar' and p_client is not null and exists (
            select 1 from public.client_assignments a where a.membership_id = m.id and a.client_id = p_client)))
  loop
    perform public.notify_user(p_org, r.user_id, p_kind, p_title, p_body, p_link, p_dedupe);
  end loop;
end $$;

create or replace function public.notify_client_users(p_client uuid, p_kind text, p_title text, p_body text, p_link text, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select user_id, org_id from public.memberships where client_id = p_client and role = 'cliente' and status = 'activa' loop
    perform public.notify_user(r.org_id, r.user_id, p_kind, p_title, p_body, p_link, p_dedupe);
  end loop;
end $$;

-- ---------- Organizaciones y miembros ----------
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_plan uuid;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  if (select count(*) from public.organizations where created_by = auth.uid()) >= 3 and not public.is_superadmin() then
    raise exception 'Límite de organizaciones por usuario alcanzado';
  end if;
  select id into v_plan from public.plans where code = 'inicial';
  insert into public.organizations(name, slug, plan_id, created_by)
  values (trim(p_name), lower(trim(p_slug)), v_plan, auth.uid()) returning id into v_org;
  insert into public.firm_profiles(org_id) values (v_org);
  insert into public.memberships(org_id, user_id, role) values (v_org, auth.uid(), 'admin');
  insert into public.automation_rules(org_id, event) values
    (v_org,'documento_recibido'),(v_org,'documento_faltante'),(v_org,'vencimiento_proximo'),
    (v_org,'conciliacion_diferencias'),(v_org,'comprobante_devuelto');
  insert into public.channel_settings(org_id, channel) values (v_org,'email'),(v_org,'whatsapp');
  return v_org;
end $$;

create or replace function public.invite_member(p_org uuid, p_email text, p_role public.member_role, p_client uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_max int; v_count int;
begin
  if not public.is_org_admin(p_org) then raise exception 'Solo el contador administrador puede invitar'; end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo inválido'; end if;
  select p.max_users into v_max from public.organizations o join public.plans p on p.id = o.plan_id where o.id = p_org;
  select count(*) into v_count from public.memberships where org_id = p_org and role <> 'cliente';
  if p_role <> 'cliente' and v_max is not null and v_count >= v_max then raise exception 'El plan actual permite % usuarios internos', v_max; end if;
  insert into public.invitations(org_id, email, role, client_id) values (p_org, lower(p_email), p_role, p_client)
  returning id into v_id;
  return v_id;
end $$;

-- El usuario acepta las invitaciones dirigidas a su correo verificado
create or replace function public.accept_invitations() returns int
language plpgsql security definer set search_path = public, auth as $$
declare v_email text; v_confirmed timestamptz; r record; n int := 0;
begin
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  if v_email is null then return 0; end if;
  if v_confirmed is null then raise exception 'Confirme su correo antes de aceptar invitaciones'; end if;
  for r in select * from public.invitations where lower(email) = lower(v_email) and status = 'pendiente' and expires_at > now() loop
    insert into public.memberships(org_id, user_id, role, client_id)
    values (r.org_id, auth.uid(), r.role, r.client_id)
    on conflict (org_id, user_id) do nothing;
    update public.invitations set status = 'aceptada' where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.update_member(p_membership uuid, p_role public.member_role, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare m record; v_admins int;
begin
  select * into m from public.memberships where id = p_membership;
  if not found or not public.is_org_admin(m.org_id) then raise exception 'No autorizado'; end if;
  if p_role = 'cliente' or m.role = 'cliente' then
    if p_role <> m.role then raise exception 'Un usuario cliente no puede convertirse en usuario interno (y viceversa)'; end if;
  end if;
  if m.role = 'admin' and (p_role <> 'admin' or p_status <> 'activa') then
    select count(*) into v_admins from public.memberships where org_id = m.org_id and role = 'admin' and status = 'activa';
    if v_admins <= 1 then raise exception 'Debe existir al menos un contador administrador activo'; end if;
  end if;
  update public.memberships set role = p_role, status = p_status where id = p_membership;
end $$;

-- Lista de miembros (con nombre y correo) visible al administrador
create or replace function public.org_members(p_org uuid)
returns table(membership_id uuid, user_id uuid, full_name text, email text, role public.member_role, status text, client_id uuid, client_name text, assigned uuid[])
language sql stable security definer set search_path = public as $$
  select m.id, m.user_id, p.full_name, p.email::text, m.role, m.status, m.client_id, c.name,
         array(select a.client_id from public.client_assignments a where a.membership_id = m.id)
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  left join public.clients c on c.id = m.client_id
  where m.org_id = p_org and public.is_org_staff(p_org)
  order by m.role, p.full_name $$;

-- El cliente actualiza solo sus datos de contacto permitidos
create or replace function public.client_update_contact(p_client uuid, p_email text, p_phone text, p_address text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_client_user(p_client) then raise exception 'No autorizado'; end if;
  update public.clients set email = nullif(trim(p_email),''), phone = left(nullif(trim(p_phone),''),30), address = left(nullif(trim(p_address),''),200)
  where id = p_client;
end $$;

-- Eventos de seguridad / exportación registrados desde la aplicación
create or replace function public.log_event(p_org uuid, p_action text, p_entity text, p_entity_id text default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_org is not null and not public.is_org_member(p_org) then raise exception 'No autorizado'; end if;
  if p_org is null and p_action not in ('inicio_sesion','cierre_sesion','recuperacion_contrasena') then raise exception 'Evento no permitido'; end if;
  if p_action !~ '^[a-z_]{3,40}$' then raise exception 'Acción inválida'; end if;
  insert into public.audit_log(org_id,user_id,action,entity,entity_id,reason)
  values (p_org, auth.uid(), p_action, left(p_entity,60), left(p_entity_id,80), left(p_reason,500));
end $$;

-- ---------- Límites del plan ----------
create or replace function public.tg_plan_limit_clients() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max int; v_count int;
begin
  select p.max_clients into v_max from public.organizations o join public.plans p on p.id = o.plan_id where o.id = new.org_id;
  select count(*) into v_count from public.clients where org_id = new.org_id;
  if v_max is not null and v_count >= v_max then raise exception 'El plan actual permite % clientes', v_max; end if;
  return new;
end $$;
create trigger clients_plan_limit before insert on public.clients for each row execute function public.tg_plan_limit_clients();

-- ---------- Plan de cuentas: plantilla de referencia ----------
create or replace function public.load_puc_template(p_client uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.can_client_action(p_client,'contabilidad','crear') then raise exception 'No autorizado'; end if;
  insert into public.accounts(client_id, org_id, code, name, account_type, nature)
  select p_client, public.client_org(p_client), t.code, t.name,
         case left(t.code,1) when '1' then 'activo' when '2' then 'pasivo' when '3' then 'patrimonio' when '4' then 'ingreso'
              when '5' then 'gasto' when '6' then 'costo' when '7' then 'costo' when '8' then 'orden_deudora' else 'orden_acreedora' end,
         case when left(t.code,1) in ('1','5','6','7','8') then 'debito' else 'credito' end
  from (values
    ('1','Activo'),('11','Disponible'),('1105','Caja'),('110505','Caja general'),('1110','Bancos'),('111005','Moneda nacional'),
    ('12','Inversiones'),('13','Deudores'),('1305','Clientes'),('130505','Nacionales'),('1330','Anticipos y avances'),
    ('1355','Anticipo de impuestos y contribuciones o saldos a favor'),('1380','Deudores varios'),
    ('14','Inventarios'),('1435','Mercancías no fabricadas por la empresa'),
    ('15','Propiedades, planta y equipo'),('1524','Equipo de oficina'),('1528','Equipo de computación y comunicación'),
    ('1540','Flota y equipo de transporte'),('1592','Depreciación acumulada'),
    ('2','Pasivo'),('21','Obligaciones financieras'),('2105','Bancos nacionales'),('22','Proveedores'),('2205','Nacionales'),
    ('23','Cuentas por pagar'),('2335','Costos y gastos por pagar'),('2365','Retención en la fuente'),
    ('2367','Impuesto a las ventas retenido'),('2368','Impuesto de industria y comercio retenido'),('2370','Retenciones y aportes de nómina'),
    ('24','Impuestos, gravámenes y tasas'),('2404','De renta y complementarios'),('2408','Impuesto sobre las ventas por pagar'),
    ('2412','De industria y comercio'),('25','Obligaciones laborales'),('2505','Salarios por pagar'),('2510','Cesantías consolidadas'),
    ('3','Patrimonio'),('31','Capital social'),('3105','Capital suscrito y pagado'),('36','Resultados del ejercicio'),
    ('3605','Utilidad del ejercicio'),('3610','Pérdida del ejercicio'),('37','Resultados de ejercicios anteriores'),
    ('4','Ingresos'),('41','Operacionales'),('4135','Comercio al por mayor y al por menor'),
    ('4155','Actividades inmobiliarias, empresariales y de alquiler'),('42','No operacionales'),('4210','Financieros'),
    ('5','Gastos'),('51','Operacionales de administración'),('5105','Gastos de personal'),('5110','Honorarios'),('5115','Impuestos'),
    ('5120','Arrendamientos'),('5135','Servicios'),('5195','Diversos'),('52','Operacionales de ventas'),
    ('53','No operacionales'),('5305','Financieros'),('54','Impuesto de renta y complementarios'),
    ('6','Costos de ventas'),('61','Costo de ventas y de prestación de servicios'),('6135','Comercio al por mayor y al por menor')
  ) as t(code,name)
  on conflict (client_id, code) do nothing;
  get diagnostics n = row_count;
  -- Solo las cuentas sin subcuentas aceptan movimientos
  update public.accounts a set accepts_movements = not exists (
      select 1 from public.accounts b where b.client_id = a.client_id and b.code <> a.code and b.code like a.code || '%')
  where a.client_id = p_client;
  update public.accounts set requires_third_party = true
   where client_id = p_client and (code like '1305%' or code like '2205%' or code like '2335%' or code like '2365%');
  return n;
end $$;

