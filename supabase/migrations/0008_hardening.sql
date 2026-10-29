-- 0008 · Endurecimiento: search_path fijo y funciones de disparador no invocables vía API
alter function public.tg_audit_immutable() set search_path = public;
alter function public.audit_sanitize(jsonb) set search_path = public;
alter function public.default_perm(public.member_role, text, text) set search_path = public;
alter function public.tg_lock_org_id() set search_path = public;
alter function public.bank_category(text) set search_path = public;
alter function public.nit_matches(text, text) set search_path = public;
alter function public.tg_tax_rule_revalidate() set search_path = public;
alter function public.tg_obl_date_change() set search_path = public;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'tg\_%' loop
    execute format('revoke execute on function %s from authenticated, anon, public', f.sig);
  end loop;
end $$;
