-- 0004b · Comprobantes, informes y cartera
-- ---------- Comprobantes ----------
create or replace function public.tg_voucher_lock() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.voucher_proc', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if new.status not in ('borrador','en_revision') or new.number is not null or new.approved_by is not null then
      raise exception 'Los comprobantes se crean como borrador; la contabilización la hace el sistema';
    end if;
    if exists (select 1 from public.periods where client_id = new.client_id and year = extract(year from new.date)
               and month = extract(month from new.date) and status = 'cerrado') then
      raise exception 'El periodo de la fecha % está cerrado', new.date;
    end if;
    new.prepared_by := auth.uid();
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status in ('contabilizado','anulado') then raise exception 'Un comprobante contabilizado no se puede eliminar; use un reverso'; end if;
    return old;
  end if;
  if old.status in ('contabilizado','anulado') then
    raise exception 'Un comprobante contabilizado no se puede modificar; use un reverso o ajuste';
  end if;
  if new.number is distinct from old.number or new.approved_by is distinct from old.approved_by
     or new.prepared_by is distinct from old.prepared_by or new.reversal_of is distinct from old.reversal_of then
    raise exception 'Campos de control asignados por el sistema';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'borrador' and new.status = 'en_revision') or
       (old.status = 'devuelto' and new.status in ('borrador','en_revision'))) then
    raise exception 'Cambio de estado % → % no permitido directamente', old.status, new.status;
  end if;
  return new;
end $$;
-- El trigger vouchers_lock (update/delete) ya existe; se añade la validación de inserción
create trigger vouchers_insert_guard before insert on public.vouchers for each row execute function public.tg_voucher_lock();

create or replace function public.ensure_period_open(p_client uuid, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.periods
   where client_id = p_client and year = extract(year from p_date) and month = extract(month from p_date);
  if v_status = 'cerrado' then raise exception 'El periodo %-% está cerrado', extract(year from p_date), lpad(extract(month from p_date)::text,2,'0'); end if;
  if v_status is null then
    insert into public.periods(client_id, org_id, year, month) values (p_client, public.client_org(p_client), extract(year from p_date), extract(month from p_date))
    on conflict do nothing;
  end if;
end $$;

create or replace function public.post_voucher(p_voucher uuid) returns public.vouchers
language plpgsql security definer set search_path = public as $$
declare v public.vouchers; v_seg boolean; v_lines int; v_d numeric; v_c numeric; v_bad int; v_n int;
begin
  select * into v from public.vouchers where id = p_voucher for update;
  if not found then raise exception 'Comprobante no encontrado'; end if;
  if not public.can_client_action(v.client_id,'contabilidad','aprobar') then raise exception 'No tiene permiso para aprobar comprobantes'; end if;
  if v.status not in ('borrador','en_revision') then raise exception 'El estado % no permite contabilizar', v.status; end if;
  select require_segregation into v_seg from public.organizations where id = v.org_id;
  if v_seg and v.prepared_by = auth.uid() and v.source <> 'reverso' then
    raise exception 'Separación de funciones: quien preparó el comprobante no puede aprobarlo';
  end if;
  perform public.ensure_period_open(v.client_id, v.date);
  select count(*), coalesce(sum(debit),0), coalesce(sum(credit),0) into v_lines, v_d, v_c
    from public.voucher_lines where voucher_id = p_voucher;
  if v_lines < 2 then raise exception 'El comprobante debe tener al menos dos líneas'; end if;
  if v_d = 0 then raise exception 'El comprobante no tiene valores'; end if;
  if v_d <> v_c then raise exception 'Partida doble: débitos (%) y créditos (%) no coinciden', v_d, v_c; end if;
  select count(*) into v_bad from public.voucher_lines l join public.accounts a on a.id = l.account_id
   where l.voucher_id = p_voucher and (not a.is_active or not a.accepts_movements
         or (a.requires_third_party and l.third_party_id is null)
         or (a.requires_cost_center and l.cost_center_id is null));
  if v_bad > 0 then raise exception '% línea(s) usan cuentas inactivas o de título, o les falta tercero/centro de costos', v_bad; end if;

  perform pg_advisory_xact_lock(hashtext(v.client_id::text || v.voucher_type));
  select coalesce(max(number),0) + 1 into v_n from public.vouchers where client_id = v.client_id and voucher_type = v.voucher_type;
  perform set_config('app.voucher_proc','on', true);
  update public.vouchers set status = 'contabilizado', number = v_n, approved_by = auth.uid(), approved_at = now(),
         total_debit = v_d, total_credit = v_c
   where id = p_voucher returning * into v;
  perform set_config('app.voucher_proc','off', true);
  if v.extraction_id is not null then
    update public.extractions set status = 'aprobado', approved_by = auth.uid(), approved_at = now(), voucher_id = v.id where id = v.extraction_id;
  end if;
  return v;
end $$;

create or replace function public.return_voucher(p_voucher uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.vouchers;
begin
  select * into v from public.vouchers where id = p_voucher for update;
  if not found or not public.can_client_action(v.client_id,'contabilidad','aprobar') then raise exception 'No autorizado'; end if;
  if v.status <> 'en_revision' then raise exception 'Solo se devuelven comprobantes en revisión'; end if;
  if coalesce(length(trim(p_reason)),0) < 5 then raise exception 'Indique el motivo de la devolución'; end if;
  perform set_config('app.voucher_proc','on', true);
  update public.vouchers set status = 'devuelto', return_reason = p_reason where id = p_voucher;
  perform set_config('app.voucher_proc','off', true);
end $$;

create or replace function public.reverse_voucher(p_voucher uuid, p_reason text, p_date date default current_date)
returns public.vouchers language plpgsql security definer set search_path = public as $$
declare v public.vouchers; r public.vouchers; v_n int;
begin
  select * into v from public.vouchers where id = p_voucher for update;
  if not found or not public.can_client_action(v.client_id,'contabilidad','aprobar') then raise exception 'No autorizado'; end if;
  if v.status <> 'contabilizado' or v.reversed_by is not null or v.reversal_of is not null then
    raise exception 'Solo se reversan comprobantes contabilizados que no hayan sido reversados';
  end if;
  if coalesce(length(trim(p_reason)),0) < 5 then raise exception 'Indique el motivo del reverso'; end if;
  perform public.ensure_period_open(v.client_id, p_date);
  perform set_config('app.voucher_proc','on', true);
  insert into public.vouchers(client_id, org_id, voucher_type, date, description, status, source, reversal_of, prepared_by)
  values (v.client_id, v.org_id, v.voucher_type, p_date, 'Reverso de '||v.voucher_type||'-'||v.number||': '||p_reason, 'borrador', 'reverso', v.id, auth.uid())
  returning * into r;
  insert into public.voucher_lines(voucher_id, client_id, org_id, line_no, account_id, third_party_id, cost_center_id, description, debit, credit)
  select r.id, v.client_id, v.org_id, line_no, account_id, third_party_id, cost_center_id, 'Reverso: '||coalesce(description,''), credit, debit
    from public.voucher_lines where voucher_id = v.id;
  perform pg_advisory_xact_lock(hashtext(v.client_id::text || v.voucher_type));
  select coalesce(max(number),0) + 1 into v_n from public.vouchers where client_id = v.client_id and voucher_type = v.voucher_type;
  update public.vouchers set status = 'contabilizado', number = v_n, approved_by = auth.uid(), approved_at = now(),
         total_debit = v.total_credit, total_credit = v.total_debit where id = r.id returning * into r;
  update public.vouchers set reversed_by = r.id where id = v.id;
  perform set_config('app.voucher_proc','off', true);
  insert into public.audit_log(org_id,user_id,action,entity,entity_id,reason) values (v.org_id, auth.uid(), 'reverso', 'vouchers', v.id::text, p_reason);
  return r;
end $$;

create or replace function public.set_period_status(p_client uuid, p_year int, p_month int, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_client_action(p_client,'contabilidad','aprobar') then raise exception 'No autorizado'; end if;
  if p_status not in ('abierto','cerrado') then raise exception 'Estado inválido'; end if;
  if p_status = 'abierto' and not public.is_org_admin(public.client_org(p_client)) then raise exception 'Solo el administrador reabre periodos'; end if;
  if p_status = 'abierto' and coalesce(length(trim(p_reason)),0) < 5 then raise exception 'Indique el motivo de la reapertura'; end if;
  insert into public.periods(client_id, org_id, year, month, status, closed_by, closed_at)
  values (p_client, public.client_org(p_client), p_year, p_month, p_status,
          case when p_status='cerrado' then auth.uid() end, case when p_status='cerrado' then now() end)
  on conflict (client_id, year, month) do update set status = excluded.status, closed_by = excluded.closed_by, closed_at = excluded.closed_at;
  if p_reason is not null then
    insert into public.audit_log(org_id,user_id,action,entity,entity_id,reason)
    values (public.client_org(p_client), auth.uid(), 'periodo_'||p_status, 'periods', p_year||'-'||p_month, p_reason);
  end if;
end $$;

-- ---------- Informes (RLS aplica: security invoker) ----------
create or replace function public.report_trial_balance(p_client uuid, p_from date, p_to date)
returns table(account_id uuid, code text, name text, account_type text, nature text, opening numeric, debit numeric, credit numeric, closing numeric)
language sql stable security invoker set search_path = public as $$
  with mov as (
    select l.account_id,
      sum(case when v.date < p_from then l.debit - l.credit else 0 end) as open_dc,
      sum(case when v.date >= p_from then l.debit else 0 end) as d,
      sum(case when v.date >= p_from then l.credit else 0 end) as c
    from public.voucher_lines l join public.vouchers v on v.id = l.voucher_id
    where v.client_id = p_client and v.status = 'contabilizado' and v.date <= p_to
    group by l.account_id)
  select a.id, a.code, a.name, a.account_type, a.nature,
    case when a.nature = 'debito' then m.open_dc else -m.open_dc end,
    m.d, m.c,
    case when a.nature = 'debito' then m.open_dc + m.d - m.c else -m.open_dc + m.c - m.d end
  from mov m join public.accounts a on a.id = m.account_id
  order by a.code $$;

create or replace view public.ledger_entries with (security_invoker = true) as
  select l.id as line_id, v.id as voucher_id, v.client_id, v.org_id, v.date, v.voucher_type, v.number, v.description as voucher_description,
         l.line_no, l.description, l.debit, l.credit, a.id as account_id, a.code as account_code, a.name as account_name,
         t.id as third_party_id, t.name as third_party_name, t.id_number as third_party_nit, cc.code as cost_center
  from public.voucher_lines l
  join public.vouchers v on v.id = l.voucher_id and v.status = 'contabilizado'
  join public.accounts a on a.id = l.account_id
  left join public.third_parties t on t.id = l.third_party_id
  left join public.cost_centers cc on cc.id = l.cost_center_id;

create or replace view public.invoice_balances with (security_invoker = true) as
  select i.*,
    coalesce((select sum(amount) from public.payments p where p.invoice_id = i.id and p.confirmed),0) as paid_confirmed,
    coalesce((select sum(amount) from public.payments p where p.invoice_id = i.id and not p.confirmed),0) as paid_unconfirmed,
    i.total - coalesce((select sum(amount) from public.payments p where p.invoice_id = i.id and p.confirmed),0) as balance,
    case when i.status in ('pagada','anulada') or i.due_date is null then 'n/a'
         when current_date <= i.due_date then 'al_dia'
         when current_date - i.due_date <= 30 then '1-30'
         when current_date - i.due_date <= 60 then '31-60'
         when current_date - i.due_date <= 90 then '61-90'
         else '>90' end as aging
  from public.invoices i;

-- ---------- Cartera ----------
create or replace function public.confirm_payment(p_payment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.payments; v_total numeric; v_paid numeric;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found or not public.can_client_action(p.client_id,'cartera','aprobar') then raise exception 'No autorizado'; end if;
  select total into v_total from public.invoices where id = p.invoice_id;
  select coalesce(sum(amount),0) into v_paid from public.payments where invoice_id = p.invoice_id and confirmed;
  if v_paid + p.amount > v_total then raise exception 'El pago supera el saldo de la factura'; end if;
  update public.payments set confirmed = true, confirmed_by = auth.uid(), confirmed_at = now() where id = p_payment;
end $$;

