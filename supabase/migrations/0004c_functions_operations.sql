-- 0004c · Conciliación, tributario, automatizaciones, sitio público, superadmin
-- ---------- Conciliación ----------
create or replace function public.bank_category(p_desc text) returns text
language sql immutable as $$
  select case
    when p_desc ~* '(gmf|4 ?x ?1000|gravamen)' then 'impuesto'
    when p_desc ~* '(comisi|cuota de manejo|cobro servicio|iva comis)' then 'comision'
    when p_desc ~* '(interes|rendimiento)' then 'interes'
    when p_desc ~* '(transf|ach|pse|traslado)' then 'transferencia'
    else null end $$;

create or replace function public.propose_matches(p_statement uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s record; l record; c record; v_count int; n int := 0; v_days int;
begin
  select st.*, ba.ledger_account_id into s from public.bank_statements st join public.bank_accounts ba on ba.id = st.bank_account_id where st.id = p_statement;
  if not found or not public.can_client_action(s.client_id,'conciliacion','editar') then raise exception 'No autorizado'; end if;
  if s.status = 'aprobada' then raise exception 'La conciliación ya fue aprobada'; end if;
  if s.ledger_account_id is null then raise exception 'Asocie una cuenta contable a la cuenta bancaria antes de conciliar'; end if;
  for l in select * from public.bank_lines where statement_id = p_statement and status in ('sin_conciliar','propuesta') loop
    update public.bank_lines set category = coalesce(category, public.bank_category(description)) where id = l.id;
    select count(*) into v_count
      from public.voucher_lines vl join public.vouchers v on v.id = vl.voucher_id and v.status = 'contabilizado'
     where vl.account_id = s.ledger_account_id and (vl.debit - vl.credit) = l.amount
       and v.date between l.date - 5 and l.date + 5
       and not exists (select 1 from public.reconciliation_matches rm where rm.voucher_line_id = vl.id and rm.decision = 'aceptada');
    for c in
      select vl.id, v.date from public.voucher_lines vl join public.vouchers v on v.id = vl.voucher_id and v.status = 'contabilizado'
       where vl.account_id = s.ledger_account_id and (vl.debit - vl.credit) = l.amount
         and v.date between l.date - 5 and l.date + 5
         and not exists (select 1 from public.reconciliation_matches rm where rm.voucher_line_id = vl.id and rm.decision = 'aceptada')
    loop
      v_days := abs(c.date - l.date);
      insert into public.reconciliation_matches(client_id, org_id, bank_line_id, voucher_line_id, match_type, score)
      values (s.client_id, s.org_id, l.id, c.id,
              case when v_count = 1 and v_days = 0 then 'exacta' else 'aproximada' end,
              case when v_count = 1 then greatest(100 - v_days*8, 50) else 40 end)
      on conflict (bank_line_id, voucher_line_id) do nothing;
      n := n + 1;
    end loop;
    if v_count > 0 then update public.bank_lines set status = 'propuesta' where id = l.id; end if;
  end loop;
  return n;   -- nunca se acepta automáticamente: cada propuesta requiere decisión
end $$;

create or replace function public.decide_match(p_match uuid, p_decision text, p_justification text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m public.reconciliation_matches;
begin
  select * into m from public.reconciliation_matches where id = p_match for update;
  if not found or not public.can_client_action(m.client_id,'conciliacion','editar') then raise exception 'No autorizado'; end if;
  if p_decision not in ('aceptada','rechazada') then raise exception 'Decisión inválida'; end if;
  if p_decision = 'aceptada' and m.match_type <> 'exacta' and coalesce(length(trim(p_justification)),0) < 5 then
    raise exception 'Justifique la aceptación de una coincidencia no exacta';
  end if;
  if p_decision = 'aceptada' and exists (select 1 from public.reconciliation_matches where voucher_line_id = m.voucher_line_id and decision = 'aceptada' and id <> m.id) then
    raise exception 'Ese movimiento contable ya está conciliado con otra línea';
  end if;
  update public.reconciliation_matches set decision = p_decision, justification = p_justification, decided_by = auth.uid(), decided_at = now() where id = p_match;
  if p_decision = 'aceptada' then
    update public.reconciliation_matches set decision = 'rechazada', justification = 'Descartada al aceptar otra coincidencia', decided_by = auth.uid(), decided_at = now()
     where bank_line_id = m.bank_line_id and id <> m.id and decision = 'propuesta';
    update public.bank_lines set status = 'conciliada' where id = m.bank_line_id;
  elsif not exists (select 1 from public.reconciliation_matches where bank_line_id = m.bank_line_id and decision in ('propuesta','aceptada')) then
    update public.bank_lines set status = 'sin_conciliar' where id = m.bank_line_id;
  end if;
end $$;

create or replace function public.manual_match(p_line uuid, p_voucher_line uuid, p_justification text) returns uuid
language plpgsql security definer set search_path = public as $$
declare l public.bank_lines; v_id uuid;
begin
  select * into l from public.bank_lines where id = p_line;
  if not found or not public.can_client_action(l.client_id,'conciliacion','editar') then raise exception 'No autorizado'; end if;
  if not exists (select 1 from public.voucher_lines where id = p_voucher_line and client_id = l.client_id) then raise exception 'Movimiento contable inválido'; end if;
  insert into public.reconciliation_matches(client_id, org_id, bank_line_id, voucher_line_id, match_type, score)
  values (l.client_id, l.org_id, p_line, p_voucher_line, 'manual', 0) returning id into v_id;
  perform public.decide_match(v_id, 'aceptada', p_justification);
  return v_id;
end $$;

create or replace function public.mark_no_match(p_line uuid, p_justification text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.bank_lines;
begin
  select * into l from public.bank_lines where id = p_line;
  if not found or not public.can_client_action(l.client_id,'conciliacion','editar') then raise exception 'No autorizado'; end if;
  if coalesce(length(trim(p_justification)),0) < 5 then raise exception 'Justifique la decisión'; end if;
  update public.bank_lines set status = 'sin_correspondencia' where id = p_line;
  insert into public.audit_log(org_id,user_id,action,entity,entity_id,reason) values (l.org_id, auth.uid(), 'sin_correspondencia', 'bank_lines', p_line::text, p_justification);
end $$;

create or replace function public.approve_statement(p_statement uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s public.bank_statements; v_pending int;
begin
  select * into s from public.bank_statements where id = p_statement for update;
  if not found or not public.can_client_action(s.client_id,'conciliacion','aprobar') then raise exception 'No autorizado'; end if;
  select count(*) into v_pending from public.bank_lines where statement_id = p_statement and status in ('sin_conciliar','propuesta','sin_correspondencia');
  update public.bank_statements set status = 'aprobada', approved_by = auth.uid(), approved_at = now() where id = p_statement;
  if v_pending > 0 and exists (select 1 from public.automation_rules where org_id = s.org_id and event = 'conciliacion_diferencias' and is_active) then
    insert into public.tasks(org_id, client_id, task_type, title, description, priority, statement_id, dedupe_key)
    values (s.org_id, s.client_id, 'conciliacion', 'Investigar diferencias de conciliación '||s.period,
            v_pending||' movimiento(s) sin conciliar al aprobar.', 'alta', s.id, 'stmt:'||s.id)
    on conflict do nothing;
  end if;
  return v_pending;
end $$;

-- ---------- Calendario tributario ----------
create or replace function public.copy_tax_templates(p_org uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_org_admin(p_org) then raise exception 'No autorizado'; end if;
  insert into public.tax_rules(org_id, code, name, authority, periodicity, applies_to, responsibility_code, source_url, source_note, version, validation_status)
  select p_org, code, name, authority, periodicity, applies_to, responsibility_code, source_url, source_note, version, 'sin_verificar'
    from public.tax_rules where org_id is null
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.validate_tax_rule(p_rule uuid, p_source_url text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.tax_rules;
begin
  select * into r from public.tax_rules where id = p_rule;
  if not found or r.org_id is null or not public.is_org_admin(r.org_id) then raise exception 'No autorizado'; end if;
  if coalesce(length(trim(p_source_url)),0) < 8 then raise exception 'Indique la fuente oficial consultada'; end if;
  update public.tax_rules set validation_status = 'verificada', source_url = p_source_url, source_note = p_note,
         validated_by = auth.uid(), validated_at = now() where id = p_rule;
  update public.obligations set date_confirmed = true where rule_id = p_rule and due_date is not null;
end $$;

create or replace function public.nit_matches(p_nit text, p_pattern text) returns boolean
language plpgsql immutable as $$
declare d text; lo int; hi int; last2 int;
begin
  if p_pattern = '*' then return true; end if;
  d := regexp_replace(coalesce(p_nit,''), '[^0-9]', '', 'g');
  if d = '' then return false; end if;
  if position('-' in p_pattern) > 0 then
    lo := split_part(p_pattern,'-',1)::int; hi := split_part(p_pattern,'-',2)::int;
    last2 := right(d, 2)::int;
    return last2 between lo and hi;
  end if;
  return right(d, length(p_pattern)) = p_pattern;
end $$;

create or replace function public.generate_obligations(p_client uuid, p_rule uuid, p_year int) returns int
language plpgsql security definer set search_path = public as $$
declare c public.clients; r public.tax_rules; n int := 0;
begin
  select * into c from public.clients where id = p_client;
  if not found or not public.can_client_action(p_client,'tributario','crear') then raise exception 'No autorizado'; end if;
  select * into r from public.tax_rules where id = p_rule and org_id = c.org_id;
  if not found then raise exception 'Regla no encontrada en la organización'; end if;
  insert into public.obligations(client_id, org_id, rule_id, name, period_label, due_date, date_confirmed)
  select p_client, c.org_id, r.id, r.name || ' ' || d.period_label, d.period_label, d.due_date, r.validation_status = 'verificada'
    from public.tax_rule_dates d
   where d.rule_id = r.id and d.period_label like p_year::text || '%' and public.nit_matches(c.id_number, d.nit_digits)
  on conflict (client_id, rule_id, period_label) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Disparadores de automatización ----------
create or replace function public.tg_document_received() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.automation_rules; v_client text;
begin
  select name into v_client from public.clients where id = new.client_id;
  insert into public.document_events(org_id, document_id, user_id, event) values (new.org_id, new.id, new.uploaded_by, 'subido');
  select * into r from public.automation_rules where org_id = new.org_id and event = 'documento_recibido' and is_active;
  if found then
    insert into public.tasks(org_id, client_id, task_type, title, description, assignee_id, priority, document_id, dedupe_key, due_date)
    values (new.org_id, new.client_id, 'revision_documento', 'Revisar: '||left(new.title,80), 'Documento recibido de '||v_client,
            r.default_assignee_id, r.priority, new.id, 'doc:'||new.id, current_date + 2)
    on conflict do nothing;
  end if;
  perform public.notify_staff(new.org_id, new.client_id, 'documento_recibido', 'Documento recibido', v_client||': '||left(new.title,80),
          '/app/documentos?cliente='||new.client_id, 'doc:'||new.id);
  -- Marca solicitudes pendientes del mismo periodo como recibidas (si las hay y el cliente subió)
  if new.source = 'cliente' then
    update public.document_requests set status = 'recibido', fulfilled_document_id = new.id
     where id = (select id from public.document_requests where client_id = new.client_id and status = 'pendiente'
                 and (period is null or period = new.period) order by due_date nulls last limit 1);
  end if;
  return null;
end $$;
create trigger documents_received after insert on public.documents for each row execute function public.tg_document_received();

create or replace function public.tg_document_request_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_client_users(new.client_id, 'documento_solicitado', 'Documento solicitado', left(new.title,120), '/portal', 'req:'||new.id);
  return null;
end $$;
create trigger docreq_created after insert on public.document_requests for each row execute function public.tg_document_request_created();

create or replace function public.tg_voucher_returned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'devuelto' and old.status <> 'devuelto' then
    perform public.notify_user(new.org_id, new.prepared_by, 'comprobante_devuelto', 'Comprobante devuelto',
            left(coalesce(new.return_reason,''),200), '/app/contabilidad?comprobante='||new.id, 'ret:'||new.id||':'||md5(coalesce(new.return_reason,'')));
    if exists (select 1 from public.automation_rules where org_id = new.org_id and event = 'comprobante_devuelto' and is_active) then
      insert into public.tasks(org_id, client_id, task_type, title, description, assignee_id, priority, voucher_id, dedupe_key, status)
      values (new.org_id, new.client_id, 'correccion', 'Corregir comprobante devuelto', new.return_reason, new.prepared_by, 'alta', new.id,
              'ret:'||new.id||':'||md5(coalesce(new.return_reason,'')), 'devuelta')
      on conflict do nothing;
    end if;
  end if;
  return null;
end $$;
create trigger vouchers_returned after update of status on public.vouchers for each row execute function public.tg_voucher_returned();

create or replace function public.tg_task_assigned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.notify_user(new.org_id, new.assignee_id, 'tarea_asignada', 'Nueva tarea asignada', left(new.title,120), '/app/tareas', 'task:'||new.id||':'||new.assignee_id);
  end if;
  return null;
end $$;
create trigger tasks_assigned after insert or update of assignee_id on public.tasks for each row execute function public.tg_task_assigned();

create or replace function public.tg_extraction_failed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'error' and old.status is distinct from 'error' then
    perform public.notify_staff(new.org_id, new.client_id, 'procesamiento_fallido', 'Procesamiento fallido', left(coalesce(new.error,'Error de extracción'),200),
            '/app/documentos', 'fail:'||new.id||':'||new.attempts);
  end if;
  return null;
end $$;
create trigger extractions_failed after update of status on public.extractions for each row execute function public.tg_extraction_failed();

-- Trabajo programado: vencimientos próximos, obligaciones vencidas, solicitudes atrasadas
create or replace function public.run_automations() returns int
language plpgsql security definer set search_path = public as $$
declare o record; n int := 0; v_days int; v_resp uuid;
begin
  update public.obligations set status = 'vencida' where due_date < current_date and status in ('pendiente','en_preparacion');
  for o in
    select ob.*, ar.days_before, ar.default_assignee_id, ar.is_active from public.obligations ob
    left join public.automation_rules ar on ar.org_id = ob.org_id and ar.event = 'vencimiento_proximo'
    where ob.status in ('pendiente','en_preparacion') and ob.due_date is not null
      and ob.due_date between current_date and current_date + coalesce(ar.days_before, 5)
  loop
    continue when o.is_active is false;
    v_resp := coalesce(o.responsible_id, o.default_assignee_id);
    if v_resp is not null then
      perform public.notify_user(o.org_id, v_resp, 'vencimiento_proximo', 'Vencimiento próximo: '||left(o.name,80),
              'Vence el '||to_char(o.due_date,'DD/MM/YYYY')||case when not o.date_confirmed then ' (fecha por confirmar)' else '' end,
              '/app/calendario', 'obl:'||o.id||':'||o.due_date);
    else
      perform public.notify_staff(o.org_id, o.client_id, 'vencimiento_proximo', 'Vencimiento próximo: '||left(o.name,80),
              'Vence el '||to_char(o.due_date,'DD/MM/YYYY'), '/app/calendario', 'obl:'||o.id||':'||o.due_date);
    end if;
    insert into public.tasks(org_id, client_id, task_type, title, assignee_id, priority, due_date, obligation_id, dedupe_key)
    values (o.org_id, o.client_id, 'obligacion', 'Preparar '||left(o.name,90), v_resp, 'alta', o.due_date, o.id, 'obl:'||o.id)
    on conflict do nothing;
    n := n + 1;
  end loop;
  for o in select * from public.document_requests where status = 'pendiente' and due_date < current_date loop
    perform public.notify_client_users(o.client_id, 'documento_pendiente', 'Documento pendiente', left(o.title,120), '/portal', 'reqlate:'||o.id);
    perform public.notify_staff(o.org_id, o.client_id, 'documento_pendiente', 'Documento faltante', left(o.title,120), '/app/documentos', 'reqlate:'||o.id);
  end loop;
  insert into public.job_runs(job, status, detail) values ('run_automations','ok', n||' vencimientos procesados');
  return n;
exception when others then
  insert into public.job_runs(job, status, detail) values ('run_automations','error', sqlerrm);
  return -1;
end $$;

-- ---------- Sitio público (anónimo) ----------
create or replace function public.get_public_firm(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'org_id', o.id, 'slug', o.slug, 'commercial_name', f.commercial_name, 'accountant_name', f.accountant_name,
    'headline', f.headline, 'description', f.description, 'services', f.services, 'phone', f.phone, 'whatsapp', f.whatsapp,
    'email', f.email, 'address', f.address, 'map_url', f.map_url, 'hours', f.hours, 'socials', f.socials,
    'logo_url', f.logo_url, 'photo_url', f.photo_url, 'color_primary', f.color_primary, 'color_secondary', f.color_secondary,
    'color_accent', f.color_accent)
  from public.organizations o join public.firm_profiles f on f.org_id = o.id
  where o.slug = lower(p_slug) and o.status = 'activa' and f.is_published $$;

create or replace function public.track_card_visit(p_slug text, p_ref text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select o.id into v_org from public.organizations o join public.firm_profiles f on f.org_id = o.id
   where o.slug = lower(p_slug) and f.is_published and o.status = 'activa';
  if v_org is null then return; end if;
  if p_ref is not null and p_ref !~ '^[A-Za-z0-9_-]{1,40}$' then p_ref := null; end if;
  insert into public.card_visits(org_id, card_ref) values (v_org, p_ref);
end $$;

create or replace function public.request_appointment(p_slug text, p_name text, p_phone text, p_email text, p_message text, p_date date, p_ref text, p_consent boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select o.id into v_org from public.organizations o join public.firm_profiles f on f.org_id = o.id
   where o.slug = lower(p_slug) and f.is_published and o.status = 'activa';
  if v_org is null then raise exception 'Firma no disponible'; end if;
  if not coalesce(p_consent,false) then raise exception 'Debe autorizar el tratamiento de datos'; end if;
  if (select count(*) from public.appointment_requests where org_id = v_org and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Demasiadas solicitudes. Intente más tarde';
  end if;
  insert into public.appointment_requests(org_id, name, phone, email, message, preferred_date, card_ref, consent)
  values (v_org, trim(p_name), nullif(trim(p_phone),''), nullif(trim(p_email),''), nullif(trim(p_message),''), p_date,
          case when p_ref ~ '^[A-Za-z0-9_-]{1,40}$' then p_ref end, true);
  perform public.notify_staff(v_org, null, 'cita_solicitada', 'Nueva solicitud de cita', left(trim(p_name),80), '/app/configuracion#citas', null);
end $$;

create or replace function public.submit_data_request(p_slug text, p_name text, p_email text, p_id_number text, p_type text, p_description text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select o.id into v_org from public.organizations o join public.firm_profiles f on f.org_id = o.id
   where o.slug = lower(p_slug) and o.status = 'activa';
  if v_org is null then raise exception 'Firma no disponible'; end if;
  if (select count(*) from public.data_subject_requests where org_id = v_org and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Demasiadas solicitudes. Intente más tarde';
  end if;
  insert into public.data_subject_requests(org_id, requester_name, requester_email, requester_id_number, request_type, description, due_date)
  values (v_org, trim(p_name), trim(p_email), nullif(trim(p_id_number),''), p_type, trim(p_description),
          -- Plazo de referencia: consultas 10 días hábiles, reclamos 15 días hábiles (verificar con la norma vigente)
          current_date + case when p_type = 'consulta' then 14 else 21 end);
  perform public.notify_staff(v_org, null, 'solicitud_titular', 'Solicitud de titular de datos', p_type, '/app/configuracion#privacidad', null);
end $$;

-- ---------- Superadministración ----------
create or replace function public.admin_list_orgs()
returns table(id uuid, name text, slug text, status public.org_status, plan_code text, users bigint, clients bigint, documents bigint, storage_mb numeric, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.slug::text, o.status, p.code,
    (select count(*) from public.memberships m where m.org_id = o.id),
    (select count(*) from public.clients c where c.org_id = o.id),
    (select count(*) from public.documents d where d.org_id = o.id),
    round(coalesce((select sum(size_bytes) from public.documents d where d.org_id = o.id),0) / 1048576.0, 2),
    o.created_at
  from public.organizations o left join public.plans p on p.id = o.plan_id
  where public.is_superadmin()
  order by o.created_at desc $$;

create or replace function public.admin_set_org(p_org uuid, p_status public.org_status, p_plan_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin() then raise exception 'No autorizado'; end if;
  update public.organizations set status = p_status,
         plan_id = coalesce((select id from public.plans where code = p_plan_code), plan_id)
   where id = p_org;
end $$;

-- Uso de recursos de la organización (para el administrador de la firma)
create or replace function public.org_usage(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_org_admin(p_org) then null else jsonb_build_object(
    'users', (select count(*) from public.memberships where org_id = p_org and role <> 'cliente'),
    'clients', (select count(*) from public.clients where org_id = p_org),
    'documents_month', (select count(*) from public.documents where org_id = p_org and created_at >= date_trunc('month', now())),
    'storage_mb', round(coalesce((select sum(size_bytes) from public.documents where org_id = p_org),0)/1048576.0, 2),
    'plan', (select to_jsonb(p) from public.plans p join public.organizations o on o.plan_id = p.id where o.id = p_org)
  ) end $$;
