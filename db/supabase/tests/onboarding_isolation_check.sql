-- Run as database owner. The intentional final exception rolls back ALL synthetic fixtures.
-- Success is exactly ONBOARDING_ISOLATION_PASS_ROLLED_BACK; any other error is a failure.
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); request uuid := gen_random_uuid();
  t uuid; f uuid; retry uuid; blocked boolean := false;
  details jsonb := '{"name":"SYNTHETIC onboarding smoke","country":"Egypt","organizationType":"Cement manufacturer","registrationNumber":"","facilityCode":"SMOKE","facilityName":"Synthetic factory","timezone":"Africa/Cairo","synthetic":true,"start":"2026-01-01","end":"2026-12-31"}';
begin
  insert into auth.users(id,email) values(a,a::text||'@example.invalid'),(b,b::text||'@example.invalid');
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  t := public.mrv_onboard_organization(request,details);
  retry := public.mrv_onboard_organization(request,details);
  if retry <> t then raise exception 'duplicate organization on retry'; end if;
  select id into f from public.facility where tenant_id=t;
  if f is null or not exists(select 1 from public.workspace_preference where tenant_id=t and facility_id=f and range->>'start'='2026-01-01') then raise exception 'workspace preference missing'; end if;
  if not exists(select 1 from public.tenant where id=t and profile->>'country'='Egypt') then raise exception 'profile missing'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.tenant where id=t) or exists(select 1 from public.facility where tenant_id=t)
    or exists(select 1 from public.tenant_membership where tenant_id=t) or exists(select 1 from public.audit_event where tenant_id=t) then
    raise exception 'cross-tenant read leak';
  end if;
  begin
    perform public.mrv_save_preference(t,f,'{"preset":"today"}');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'cross-tenant preference permitted'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  execute 'set local role anon';
  blocked := false;
  begin
    perform public.mrv_onboard_organization(request,details);
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'anonymous onboarding permitted'; end if;
  raise exception 'ONBOARDING_ISOLATION_PASS_ROLLED_BACK';
end $$;
