-- 0006 · Asignación de clientes a auxiliares
create or replace function public.set_client_assignments(p_membership uuid, p_clients uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from public.memberships where id = p_membership;
  if not found or not public.is_org_admin(m.org_id) then raise exception 'No autorizado'; end if;
  if m.role <> 'auxiliar' then raise exception 'Solo se asignan clientes a auxiliares'; end if;
  delete from public.client_assignments where membership_id = p_membership and not (client_id = any(p_clients));
  insert into public.client_assignments(membership_id, client_id, org_id)
  select p_membership, c, m.org_id from unnest(p_clients) c on conflict do nothing;
end $$;

grant execute on function public.set_client_assignments(uuid, uuid[]) to authenticated;
