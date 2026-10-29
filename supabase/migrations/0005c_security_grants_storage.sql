-- 0005c · Privilegios de funciones, almacenamiento y plantillas
-- ---------- Ejecución de funciones ----------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Funciones internas: solo el sistema
revoke execute on function public.enqueue_message(uuid,uuid,text,text,text,text) from authenticated;
revoke execute on function public.notify_user(uuid,uuid,text,text,text,text,text) from authenticated;
revoke execute on function public.notify_staff(uuid,uuid,text,text,text,text,text) from authenticated;
revoke execute on function public.notify_client_users(uuid,text,text,text,text,text) from authenticated;
revoke execute on function public.run_automations() from authenticated;
revoke execute on function public.ensure_period_open(uuid,date) from authenticated;
-- Funciones públicas del sitio (sin sesión)
grant execute on function public.get_public_firm(text) to anon;
grant execute on function public.track_card_visit(text,text) to anon;
grant execute on function public.request_appointment(text,text,text,text,text,date,text,boolean) to anon;
grant execute on function public.submit_data_request(text,text,text,text,text,text) to anon;
grant execute on function public.get_privacy_policy(text) to anon;

-- ---------- Almacenamiento ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
 ('documentos','documentos', false, 26214400, array[
   'application/pdf','image/jpeg','image/png','application/xml','text/xml','text/csv',
   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/zip']),
 ('marca','marca', true, 3145728, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do nothing;

create policy "docs_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and public.storage_can_upload(name));
create policy "docs_read" on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and public.storage_can_read(name));
create policy "docs_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and public.branding_can_write(name));
create policy "brand_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'marca' and public.branding_can_write(name));
create policy "brand_update" on storage.objects for update to authenticated
  using (bucket_id = 'marca' and public.branding_can_write(name));
create policy "brand_read" on storage.objects for select using (bucket_id = 'marca');

-- ---------- Plantillas tributarias globales (sin fechas: deben cargarse y verificarse) ----------
insert into public.tax_rules(org_id, code, name, authority, periodicity, applies_to, responsibility_code, source_url, source_note) values
 (null,'IVA_BIM','Declaración de IVA bimestral','DIAN','bimestral','Responsables de IVA con periodicidad bimestral','48','https://www.dian.gov.co','Cargar fechas del calendario tributario vigente y verificar'),
 (null,'IVA_CUAT','Declaración de IVA cuatrimestral','DIAN','cuatrimestral','Responsables de IVA con periodicidad cuatrimestral','48','https://www.dian.gov.co','Cargar fechas del calendario tributario vigente y verificar'),
 (null,'RTE_FTE','Retención en la fuente','DIAN','mensual','Agentes de retención en la fuente','07','https://www.dian.gov.co','Cargar fechas del calendario tributario vigente y verificar'),
 (null,'RENTA_PJ','Renta personas jurídicas','DIAN','anual','Personas jurídicas contribuyentes del régimen ordinario','05','https://www.dian.gov.co','Cargar fechas y número de cuotas vigentes y verificar'),
 (null,'RENTA_PN','Renta personas naturales','DIAN','anual','Personas naturales obligadas a declarar','05','https://www.dian.gov.co','Cargar fechas vigentes y verificar los topes de obligación'),
 (null,'RST','Régimen Simple de Tributación','DIAN','bimestral','Contribuyentes inscritos en el Régimen Simple (anticipos y declaración anual)','47','https://www.dian.gov.co','Cargar fechas vigentes y verificar'),
 (null,'EXOGENA','Información exógena','DIAN','anual','Obligados a reportar información según resolución vigente','14','https://www.dian.gov.co','Verificar resolución y topes del año gravable'),
 (null,'ICA','Industria y comercio','Municipio','bimestral','Según el municipio donde se realiza la actividad','', null,'La periodicidad y fechas dependen de cada municipio: configurar y verificar');
