-- Pruebas de seguridad y contabilidad. Todo se ejecuta en una transacción
-- que termina con un error controlado, así NO queda ningún dato de prueba.
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uc uuid := gen_random_uuid(); ucl uuid := gen_random_uuid();
  org_a uuid; org_b uuid; cli_a uuid := gen_random_uuid(); cli_a2 uuid := gen_random_uuid(); cli_b uuid := gen_random_uuid();
  m_c uuid; v1 uuid := gen_random_uuid(); acc_caja uuid; acc_ing uuid; n int; ok text[] := '{}'; fail text[] := '{}'; r public.vouchers;
begin
  insert into auth.users(id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data)
  values (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@test.local',now(),'{"full_name":"Admin A"}'),
         (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@test.local',now(),'{"full_name":"Admin B"}'),
         (uc,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','c@test.local',now(),'{"full_name":"Auxiliar C"}'),
         (ucl,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','cl@test.local',now(),'{"full_name":"Cliente"}');

  -- ===== Admin A crea su firma y clientes =====
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  set local role authenticated;
  org_a := public.create_organization('Firma A','firma-a-test');
  insert into public.clients(id, org_id, name, id_number) values (cli_a, org_a, 'Cliente A1', '900111222');
  insert into public.clients(id, org_id, name, id_number) values (cli_a2, org_a, 'Cliente A2', '900333444');
  n := public.load_puc_template(cli_a);
  if n > 50 then ok := array_append(ok, ('PUC cargado')::text); else fail := array_append(fail, (('PUC '||n))::text); end if;
  perform public.invite_member(org_a, 'c@test.local', 'auxiliar');
  perform public.invite_member(org_a, 'cl@test.local', 'cliente', cli_a);
  reset role;

  -- ===== Auxiliar C y cliente aceptan invitación =====
  perform set_config('request.jwt.claims', json_build_object('sub',uc,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.accept_invitations();
  select count(*) into n from public.clients;
  if n = 0 then ok := array_append(ok, ('Auxiliar sin asignar no ve clientes')::text); else fail := array_append(fail, ('Auxiliar ve clientes sin asignación')::text); end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',ucl,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.accept_invitations();
  select count(*) into n from public.clients;
  if n = 1 then ok := array_append(ok, ('Cliente ve solo su propia ficha')::text); else fail := array_append(fail, (('Cliente ve '||n||' clientes'))::text); end if;
  select count(*) into n from public.accounts;
  if n = 0 then ok := array_append(ok, ('Cliente no ve la contabilidad interna')::text); else fail := array_append(fail, ('Cliente ve cuentas')::text); end if;
  reset role;

  -- Asignar cliente A1 al auxiliar (como sistema, ya que la función de asignación está pendiente de aprobar)
  select id into m_c from public.memberships where user_id = uc and org_id = org_a;
  insert into public.client_assignments(membership_id, client_id, org_id) values (m_c, cli_a, org_a);

  -- ===== Auxiliar prepara comprobante =====
  perform set_config('request.jwt.claims', json_build_object('sub',uc,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.clients;
  if n = 1 then ok := array_append(ok, ('Auxiliar ve solo el cliente asignado')::text); else fail := array_append(fail, (('Auxiliar ve '||n))::text); end if;
  select id into acc_caja from public.accounts where client_id = cli_a and code = '110505';
  select id into acc_ing from public.accounts where client_id = cli_a and code = '4135';
  insert into public.vouchers(id, client_id, org_id, date, description) values (v1, cli_a, org_a, current_date, 'Venta de contado');
  insert into public.voucher_lines(voucher_id, client_id, org_id, line_no, account_id, debit) values (v1, cli_a, org_a, 1, acc_caja, 100000);
  insert into public.voucher_lines(voucher_id, client_id, org_id, line_no, account_id, credit) values (v1, cli_a, org_a, 2, acc_ing, 90000);
  begin
    perform public.post_voucher(v1);
    fail := array_append(fail, ('Auxiliar pudo aprobar')::text);
  exception when others then ok := array_append(ok, ('Auxiliar no puede aprobar (permiso)')::text); end;
  update public.vouchers set status = 'en_revision' where id = v1;
  reset role;

  -- ===== Admin A revisa =====
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.post_voucher(v1);
    fail := array_append(fail, ('Se contabilizó un comprobante descuadrado')::text);
  exception when others then
    if sqlerrm like 'Partida doble%' then ok := array_append(ok, ('Partida doble bloquea descuadre')::text); else fail := array_append(fail, (('Error inesperado: '||sqlerrm))::text); end if;
  end;
  perform public.return_voucher(v1, 'Revisar el valor del ingreso');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',uc,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.notifications where kind = 'comprobante_devuelto';
  if n = 1 then ok := array_append(ok, ('Auxiliar notificado de devolución')::text); else fail := array_append(fail, ('Sin notificación de devolución')::text); end if;
  update public.vouchers set status = 'borrador' where id = v1;
  update public.voucher_lines set credit = 100000 where voucher_id = v1 and line_no = 2;
  update public.vouchers set status = 'en_revision' where id = v1;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  set local role authenticated;
  r := public.post_voucher(v1);
  if r.status = 'contabilizado' and r.number = 1 then ok := array_append(ok, ('Contabilización con numeración')::text); else fail := array_append(fail, ('Contabilización falló')::text); end if;
  begin
    update public.vouchers set description = 'cambio' where id = v1;
    fail := array_append(fail, ('Se modificó un comprobante contabilizado')::text);
  exception when others then ok := array_append(ok, ('Comprobante contabilizado inmutable')::text); end;
  begin
    update public.voucher_lines set debit = 1 where voucher_id = v1;
    fail := array_append(fail, ('Se modificaron líneas contabilizadas')::text);
  exception when others then ok := array_append(ok, ('Líneas contabilizadas inmutables')::text); end;
  r := public.reverse_voucher(v1, 'Prueba de reverso');
  if r.status = 'contabilizado' and r.reversal_of = v1 then ok := array_append(ok, ('Reverso trazable')::text); else fail := array_append(fail, ('Reverso falló')::text); end if;
  select count(*) into n from public.report_trial_balance(cli_a, date_trunc('month',current_date)::date, current_date) where closing <> 0;
  if n = 0 then ok := array_append(ok, ('Balance de prueba cuadra tras reverso')::text); else fail := array_append(fail, ('Balance no cuadra')::text); end if;
  perform public.set_period_status(cli_a, extract(year from current_date)::int, extract(month from current_date)::int, 'cerrado');
  begin
    insert into public.vouchers(client_id, org_id, date, description) values (cli_a, org_a, current_date, 'En periodo cerrado');
    fail := array_append(fail, ('Se registró en periodo cerrado')::text);
  exception when others then ok := array_append(ok, ('Periodo cerrado bloquea registros')::text); end;
  reset role;

  -- ===== Admin B (otra firma) intenta acceder a datos de A =====
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true);
  set local role authenticated;
  org_b := public.create_organization('Firma B','firma-b-test');
  insert into public.clients(id, org_id, name, id_number) values (cli_b, org_b, 'Cliente B1', '800555666');
  select count(*) into n from public.clients where org_id = org_a;
  if n = 0 then ok := array_append(ok, ('Firma B no ve clientes de A')::text); else fail := array_append(fail, ('FUGA: B ve clientes de A')::text); end if;
  select count(*) into n from public.vouchers;
  if n = 0 then ok := array_append(ok, ('Firma B no ve comprobantes de A')::text); else fail := array_append(fail, ('FUGA: B ve comprobantes')::text); end if;
  select count(*) into n from public.audit_log where org_id = org_a;
  if n = 0 then ok := array_append(ok, ('Firma B no ve auditoría de A')::text); else fail := array_append(fail, ('FUGA: B ve auditoría de A')::text); end if;
  begin
    insert into public.clients(org_id, name, id_number) values (org_a, 'Intruso', '123456');
    fail := array_append(fail, ('FUGA: B creó cliente en A')::text);
  exception when others then ok := array_append(ok, ('B no puede crear clientes en A (cambio de org_id)')::text); end;
  begin
    insert into public.vouchers(client_id, org_id, date, description) values (cli_a, org_b, current_date, 'intruso');
    fail := array_append(fail, ('FUGA: B creó comprobante en cliente de A')::text);
  exception when others then ok := array_append(ok, ('B no puede usar client_id de A')::text); end;
  begin
    perform public.post_voucher(v1);
    fail := array_append(fail, ('FUGA: B ejecutó post_voucher en A')::text);
  exception when others then ok := array_append(ok, ('RPC contable rechaza otra firma')::text); end;
  begin
    perform public.invite_member(org_a, 'x@test.local', 'admin');
    fail := array_append(fail, ('FUGA: B invitó en A')::text);
  exception when others then ok := array_append(ok, ('B no puede invitar en A (acceso vertical)')::text); end;
  if not public.storage_can_upload(org_a||'/'||cli_a||'/x.pdf') then ok := array_append(ok, ('Almacenamiento bloquea ruta de A')::text); else fail := array_append(fail, ('FUGA: storage')::text); end if;
  if not public.storage_can_upload(org_b||'/'||cli_a||'/x.pdf') then ok := array_append(ok, ('Almacenamiento bloquea ruta mezclada')::text); else fail := array_append(fail, ('FUGA: storage mezclado')::text); end if;
  update public.clients set name = 'Hackeado' where id = cli_a;
  get diagnostics n = row_count;
  if n = 0 then ok := array_append(ok, ('B no puede editar clientes de A')::text); else fail := array_append(fail, ('FUGA: B editó A')::text); end if;
  begin
    update public.memberships set role = 'admin' where user_id = ub;
    get diagnostics n = row_count;
    if n = 0 then ok := array_append(ok, ('Membresías no editables directamente')::text); else fail := array_append(fail, ('Membresía editable')::text); end if;
  exception when others then ok := array_append(ok, ('Membresías no editables directamente')::text); end;
  begin
    update public.profiles set is_superadmin = true where id = ub;
    fail := array_append(fail, ('Usuario se hizo superadmin')::text);
  exception when others then ok := array_append(ok, ('No se puede auto-asignar superadmin')::text); end;
  begin
    update public.audit_log set action = 'x';
    fail := array_append(fail, ('Auditoría modificable')::text);
  exception when others then ok := array_append(ok, ('Auditoría inmodificable')::text); end;
  reset role;

  -- ===== Anónimo =====
  set local role anon;
  begin
    perform count(*) from public.clients;
    fail := array_append(fail, ('Anónimo lee clientes')::text);
  exception when others then ok := array_append(ok, ('Anónimo sin acceso a tablas')::text); end;
  if public.get_public_firm('firma-a-test') is null then ok := array_append(ok, ('Tarjeta no publicada no se expone')::text); else fail := array_append(fail, ('Tarjeta no publicada visible')::text); end if;
  reset role;

  raise exception 'RESULTADO|OK=%|FALLAS=%|%|%', coalesce(array_length(ok,1),0), coalesce(array_length(fail,1),0), array_to_string(fail,' ; '), array_to_string(ok,' ; ');
end $$;
