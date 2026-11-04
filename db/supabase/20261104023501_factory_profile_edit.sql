-- Atomic profile edits only. Stable factory identity and reporting settings are not editable here.
alter table public.facility add column profile jsonb not null default '{}'::jsonb check (jsonb_typeof(profile)='object');
alter table public.facility add column profile_version integer not null default 1;
create function public.mrv_update_factory(p_tenant uuid, p_facility uuid, p_details jsonb, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare old_row public.facility; new_profile jsonb; k text;
begin
  if auth.uid() is null or not mrv_auth.has_permission(p_tenant,null,'members.manage')
    or not mrv_auth.has_permission(p_tenant,p_facility,'facility.read') then
    raise exception 'Only organization administrators can edit factory details' using errcode='42501';
  end if;
  if p_details is null or jsonb_typeof(p_details)<>'object' then raise exception 'Invalid factory details' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_details) key where key not in ('name','country','city','address','siteType','registrationNumber')) then raise exception 'Unknown factory field' using errcode='22023'; end if;
  foreach k in array array['name','country','city','address','siteType','registrationNumber'] loop
    if jsonb_typeof(p_details->k) is distinct from 'string' then raise exception 'Invalid field %',k using errcode='22023'; end if;
  end loop;
  if length(btrim(p_details->>'name')) not between 2 and 120
    or length(p_details->>'country')>80 or length(p_details->>'city')>120 or length(p_details->>'address')>300
    or length(p_details->>'registrationNumber')>80
    or p_details->>'siteType' not in ('','Integrated cement plant','Clinker plant','Cement grinding plant','Other') then
    raise exception 'Invalid factory details' using errcode='22023';
  end if;
  select * into old_row from public.facility where tenant_id=p_tenant and id=p_facility for update;
  if not found then raise exception 'Factory not available' using errcode='42501'; end if;
  if p_version is null or old_row.profile_version is distinct from p_version then
    raise exception 'Factory details changed. Close and reopen the editor before saving.' using errcode='MRV09';
  end if;
  new_profile := old_row.profile;
  foreach k in array array['country','city','address','siteType','registrationNumber'] loop
    new_profile := new_profile || jsonb_build_object(k,btrim(p_details->>k));
  end loop;
  update public.facility set name=btrim(p_details->>'name'),profile=new_profile,profile_version=profile_version+1
    where tenant_id=p_tenant and id=p_facility;
  insert into public.audit_event(tenant_id,facility_id,actor_id,action,target,detail)
    values(p_tenant,p_facility,auth.uid(),'factory.updated',p_facility::text,
      jsonb_build_object('before',jsonb_build_object('name',old_row.name,'profile',old_row.profile),
      'after',jsonb_build_object('name',btrim(p_details->>'name'),'profile',new_profile)));
end $$;
revoke all on function public.mrv_update_factory(uuid,uuid,jsonb,integer) from public,anon;
grant execute on function public.mrv_update_factory(uuid,uuid,jsonb,integer) to authenticated;
