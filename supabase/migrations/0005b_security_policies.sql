-- 0005b · Políticas de módulos
-- Documentos
create policy docs_select on public.documents for select to authenticated using (public.can_read_document(id));
create policy docs_insert on public.documents for insert to authenticated with check (
  uploaded_by = auth.uid() and (
    (source = 'firma' and public.can_client_action(client_id,'documentos','crear'))
    or (source = 'cliente' and public.is_client_user(client_id))));
create policy docs_update on public.documents for update to authenticated
  using (public.can_client_action(client_id,'documentos','editar')) with check (public.can_client_action(client_id,'documentos','editar'));
create policy docs_delete on public.documents for delete to authenticated using (public.is_org_admin(org_id));
revoke update on public.documents from authenticated;
grant update (title, period, doc_type, tags, status, visible_to_client) on public.documents to authenticated;

create policy docev_select on public.document_events for select to authenticated using (public.is_org_admin(org_id));
create policy docev_insert on public.document_events for insert to authenticated
  with check (user_id = auth.uid() and event in ('consultado','descargado') and public.can_read_document(document_id));
create or replace function public.tg_docevent_org() returns trigger language plpgsql security definer set search_path = public as $$
begin select org_id into new.org_id from public.documents where id = new.document_id; return new; end $$;
create trigger docev_org before insert on public.document_events for each row execute function public.tg_docevent_org();

create policy docreq_select on public.document_requests for select to authenticated using (public.can_client_action(client_id,'documentos','ver') or public.is_client_user(client_id));
create policy docreq_write on public.document_requests for all to authenticated
  using (public.can_client_action(client_id,'documentos','crear')) with check (public.can_client_action(client_id,'documentos','crear'));

create policy extr_select on public.extractions for select to authenticated using (public.can_client_action(client_id,'documentos','ver'));
create policy extr_insert on public.extractions for insert to authenticated with check (public.can_client_action(client_id,'documentos','crear'));
create policy extr_update on public.extractions for update to authenticated
  using (public.can_client_action(client_id,'documentos','editar')) with check (public.can_client_action(client_id,'documentos','editar'));
revoke update on public.extractions from authenticated;
grant update (fields, status, issues, reviewed_by, reviewed_at, voucher_id, attempts, error, provider) on public.extractions to authenticated;

-- Contabilidad
create policy acc_select on public.accounts for select to authenticated using (public.can_client_action(client_id,'contabilidad','ver'));
create policy acc_write on public.accounts for all to authenticated
  using (public.can_client_action(client_id,'contabilidad','editar')) with check (public.can_client_action(client_id,'contabilidad','crear'));
create policy tp_select on public.third_parties for select to authenticated using (public.can_client_action(client_id,'contabilidad','ver') or public.can_client_action(client_id,'cartera','ver'));
create policy tp_write on public.third_parties for all to authenticated
  using (public.can_client_action(client_id,'contabilidad','editar')) with check (public.can_client_action(client_id,'contabilidad','crear'));
create policy cc_select on public.cost_centers for select to authenticated using (public.can_client_action(client_id,'contabilidad','ver'));
create policy cc_write on public.cost_centers for all to authenticated
  using (public.can_client_action(client_id,'contabilidad','editar')) with check (public.can_client_action(client_id,'contabilidad','crear'));
create policy per_select on public.periods for select to authenticated using (public.can_client_action(client_id,'contabilidad','ver'));
revoke insert, update, delete on public.periods from authenticated;

create policy v_select on public.vouchers for select to authenticated using (public.can_client_action(client_id,'contabilidad','ver'));
create policy v_insert on public.vouchers for insert to authenticated with check (public.can_client_action(client_id,'contabilidad','crear'));
create policy v_update on public.vouchers for update to authenticated
  using (public.can_client_action(client_id,'contabilidad','editar')) with check (public.can_client_action(client_id,'contabilidad','editar'));
create policy v_delete on public.vouchers for delete to authenticated using (public.can_client_action(client_id,'contabilidad','editar') and status in ('borrador','devuelto'));
revoke update on public.vouchers from authenticated;
grant update (voucher_type, date, description, status, document_id) on public.vouchers to authenticated;

create policy vl_select on public.voucher_lines for select to authenticated using (public.can_client_action(client_id,'contabilidad','ver'));
create policy vl_write on public.voucher_lines for all to authenticated
  using (public.can_client_action(client_id,'contabilidad','editar'))
  with check (public.can_client_action((select v.client_id from public.vouchers v where v.id = voucher_id),'contabilidad','crear'));

-- Conciliación
create policy ba_select on public.bank_accounts for select to authenticated using (public.can_client_action(client_id,'conciliacion','ver'));
create policy ba_write on public.bank_accounts for all to authenticated
  using (public.can_client_action(client_id,'conciliacion','editar')) with check (public.can_client_action(client_id,'conciliacion','crear'));
create policy st_select on public.bank_statements for select to authenticated using (public.can_client_action(client_id,'conciliacion','ver'));
create policy st_insert on public.bank_statements for insert to authenticated with check (public.can_client_action(client_id,'conciliacion','crear') and status = 'en_proceso');
create policy st_update on public.bank_statements for update to authenticated
  using (public.can_client_action(client_id,'conciliacion','editar') and status <> 'aprobada')
  with check (public.can_client_action(client_id,'conciliacion','editar') and status in ('en_proceso','en_revision'));
create policy bl_select on public.bank_lines for select to authenticated using (public.can_client_action(client_id,'conciliacion','ver'));
create policy bl_insert on public.bank_lines for insert to authenticated with check (public.can_client_action(client_id,'conciliacion','crear') and status = 'sin_conciliar');
create policy bl_update on public.bank_lines for update to authenticated
  using (public.can_client_action(client_id,'conciliacion','editar')) with check (public.can_client_action(client_id,'conciliacion','editar'));
revoke update on public.bank_lines from authenticated;
grant update (category) on public.bank_lines to authenticated;
create policy rm_select on public.reconciliation_matches for select to authenticated using (public.can_client_action(client_id,'conciliacion','ver'));
revoke insert, update, delete on public.reconciliation_matches from authenticated;

-- Cartera
create policy invc_select on public.invoices for select to authenticated using (public.can_client_action(client_id,'cartera','ver'));
create policy invc_write on public.invoices for all to authenticated
  using (public.can_client_action(client_id,'cartera','editar')) with check (public.can_client_action(client_id,'cartera','crear'));
create policy pay_select on public.payments for select to authenticated using (public.can_client_action(client_id,'cartera','ver'));
create policy pay_insert on public.payments for insert to authenticated with check (public.can_client_action(client_id,'cartera','crear') and not confirmed);
create policy pay_update on public.payments for update to authenticated
  using (public.can_client_action(client_id,'cartera','editar') and not confirmed) with check (not confirmed);
create policy pay_delete on public.payments for delete to authenticated using (public.can_client_action(client_id,'cartera','editar') and not confirmed);
revoke update on public.payments from authenticated;
grant update (date, amount, method, reference) on public.payments to authenticated;

-- Tributario
create policy tr_select on public.tax_rules for select to authenticated using (org_id is null or public.is_org_member(org_id));
create policy tr_insert on public.tax_rules for insert to authenticated with check (public.is_org_admin(org_id) and validation_status = 'sin_verificar');
create policy tr_update on public.tax_rules for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy tr_delete on public.tax_rules for delete to authenticated using (public.is_org_admin(org_id));
revoke update on public.tax_rules from authenticated;
grant update (code, name, authority, periodicity, applies_to, responsibility_code, source_url, source_note, version, valid_from, valid_to) on public.tax_rules to authenticated;
-- Modificar una regla verificada la devuelve a "sin verificar"
create or replace function public.tg_tax_rule_revalidate() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.voucher_proc', true),'') <> 'on' and old.validation_status = 'verificada'
     and (new.name, new.periodicity, new.version, new.valid_from, new.valid_to) is distinct from (old.name, old.periodicity, old.version, old.valid_from, old.valid_to) then
    new.validation_status := 'sin_verificar'; new.validated_by := null; new.validated_at := null;
  end if;
  return new;
end $$;
create trigger tax_rule_revalidate before update on public.tax_rules for each row execute function public.tg_tax_rule_revalidate();

create policy trd_select on public.tax_rule_dates for select to authenticated using (public.is_org_member(org_id));
create policy trd_write on public.tax_rule_dates for all to authenticated using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id) and exists (select 1 from public.tax_rules r where r.id = rule_id and r.org_id = tax_rule_dates.org_id));
create or replace function public.tg_trd_unverify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.tax_rules set validation_status = 'sin_verificar', validated_by = null, validated_at = null
   where id = coalesce(new.rule_id, old.rule_id) and validation_status = 'verificada';
  update public.obligations set date_confirmed = false where rule_id = coalesce(new.rule_id, old.rule_id);
  return null;
end $$;
create trigger trd_unverify after insert or update or delete on public.tax_rule_dates for each row execute function public.tg_trd_unverify();

create policy obl_select on public.obligations for select to authenticated using (public.can_client_action(client_id,'tributario','ver'));
create policy obl_write on public.obligations for all to authenticated
  using (public.can_client_action(client_id,'tributario','editar')) with check (public.can_client_action(client_id,'tributario','crear'));
revoke update on public.obligations from authenticated;
grant update (responsible_id, status, amount, presented_at, paid_at, support_document_id, notes, due_date) on public.obligations to authenticated;
create or replace function public.tg_obl_date_change() returns trigger language plpgsql as $$
begin
  if new.due_date is distinct from old.due_date then new.date_confirmed := false; end if;
  return new;
end $$;
create trigger obl_date_change before update on public.obligations for each row execute function public.tg_obl_date_change();

-- Tareas
create policy tasks_select on public.tasks for select to authenticated using (
  public.is_org_staff(org_id) and (assignee_id = auth.uid() or client_id is null and public.is_org_admin(org_id) or client_id is null and created_by = auth.uid()
                                   or (client_id is not null and public.can_client_action(client_id,'tareas','ver'))));
create policy tasks_insert on public.tasks for insert to authenticated with check (
  public.is_org_staff(org_id) and (client_id is null or public.can_client_action(client_id,'tareas','crear')));
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_org_staff(org_id) and (assignee_id = auth.uid() or public.is_org_admin(org_id) or (client_id is not null and public.can_client_action(client_id,'tareas','editar'))))
  with check (public.is_org_staff(org_id) and (status not in ('aprobada') or public.is_org_admin(org_id)));
create policy tasks_delete on public.tasks for delete to authenticated using (public.is_org_admin(org_id));
create policy taskev_select on public.task_events for select to authenticated using (public.is_org_staff(org_id));
revoke insert, update, delete on public.task_events from authenticated;

create policy auto_select on public.automation_rules for select to authenticated using (public.is_org_staff(org_id));
create policy auto_update on public.automation_rules for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
revoke insert, delete on public.automation_rules from authenticated;

create policy jobs_select on public.job_runs for select to authenticated using (public.is_superadmin());
revoke insert, update, delete on public.job_runs from authenticated;

-- Notificaciones
create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy chan_select on public.channel_settings for select to authenticated using (public.is_org_admin(org_id));
create policy chan_update on public.channel_settings for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
revoke insert, update, delete on public.channel_settings from authenticated;
grant update (enabled, max_per_hour, allowed_kinds, provider) on public.channel_settings to authenticated;
create policy out_select on public.outbound_messages for select to authenticated using (public.is_org_admin(org_id));
revoke insert, update, delete on public.outbound_messages from authenticated;

-- Privacidad
create policy pp_select on public.privacy_policies for select to authenticated using (public.is_org_member(org_id));
create policy pp_write on public.privacy_policies for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy cons_select on public.consents for select to authenticated using (user_id = auth.uid() or public.is_org_admin(org_id));
create policy cons_insert on public.consents for insert to authenticated with check (user_id = auth.uid() and public.is_org_member(org_id));
create policy cons_update on public.consents for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update, delete on public.consents from authenticated;
grant update (revoked_at) on public.consents to authenticated;
create policy dsr_select on public.data_subject_requests for select to authenticated using (public.is_org_admin(org_id));
create policy dsr_update on public.data_subject_requests for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
revoke insert, delete on public.data_subject_requests from authenticated;

-- Público
create policy appt_select on public.appointment_requests for select to authenticated using (public.is_org_staff(org_id));
create policy appt_update on public.appointment_requests for update to authenticated using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));
revoke insert, delete on public.appointment_requests from authenticated;
revoke update on public.appointment_requests from authenticated;
grant update (status) on public.appointment_requests to authenticated;
create policy visits_select on public.card_visits for select to authenticated using (public.is_org_admin(org_id));
revoke insert, update, delete on public.card_visits from authenticated;

create policy sag_select on public.support_access_grants for select to authenticated using (public.is_org_admin(org_id) or superadmin_id = auth.uid());
create or replace function public.user_is_superadmin(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_superadmin from public.profiles where id = p_user), false) $$;
create policy sag_insert on public.support_access_grants for insert to authenticated with check (
  public.is_org_admin(org_id) and granted_by = auth.uid() and public.user_is_superadmin(superadmin_id));
create policy sag_delete on public.support_access_grants for delete to authenticated using (public.is_org_admin(org_id));
revoke update on public.support_access_grants from authenticated;

