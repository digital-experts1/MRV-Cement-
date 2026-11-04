-- Additive administrator-only profile editing. No factory or report data is changed.
alter table public.tenant add column profile_version integer not null default 1;
create function public.mrv_update_organization(p_tenant uuid, p_details jsonb, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare old_row public.tenant; k text; new_profile jsonb;
begin
  if auth.uid() is null or not mrv_auth.has_permission(p_tenant, null, 'members.manage') then
    raise exception 'Only organization administrators can edit details' using errcode='42501';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then raise exception 'Invalid details' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_details) key where key not in ('name','country','organizationType','registrationNumber')) then raise exception 'Unknown field' using errcode='22023'; end if;
  foreach k in array array['name','country','organizationType','registrationNumber'] loop
    if jsonb_typeof(p_details->k) is distinct from 'string' then raise exception 'Invalid field %',k using errcode='22023'; end if;
  end loop;
  if length(btrim(p_details->>'name')) not between 2 and 120 or length(btrim(p_details->>'country')) not between 2 and 80
    or length(p_details->>'registrationNumber') > 80 or p_details->>'organizationType' not in ('Cement manufacturer','Cement grinding operator','Cement group') then
    raise exception 'Invalid organization details' using errcode='22023';
  end if;
  select * into old_row from public.tenant where id=p_tenant for update;
  if p_version is null or old_row.profile_version is distinct from p_version then
    raise exception 'Organization details changed. Close and reopen the editor before saving.' using errcode='MRV09';
  end if;
  new_profile := old_row.profile || jsonb_build_object('country',btrim(p_details->>'country'),'organizationType',p_details->>'organizationType','registrationNumber',btrim(p_details->>'registrationNumber'));
  update public.tenant set name=btrim(p_details->>'name'), profile=new_profile, profile_version=profile_version+1 where id=p_tenant;
  insert into public.audit_event(tenant_id,actor_id,action,target,detail) values(p_tenant,auth.uid(),'organization.updated',p_tenant::text,
    jsonb_build_object('before',jsonb_build_object('name',old_row.name,'profile',old_row.profile),'after',jsonb_build_object('name',btrim(p_details->>'name'),'profile',new_profile)));
end $$;
revoke all on function public.mrv_update_organization(uuid,jsonb,integer) from public,anon;
grant execute on function public.mrv_update_organization(uuid,jsonb,integer) to authenticated;
