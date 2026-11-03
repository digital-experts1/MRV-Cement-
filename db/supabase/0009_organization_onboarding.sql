-- Atomic onboarding: identity comes exclusively from auth.uid(). Existing tenant RLS remains authoritative.
alter table public.tenant add column profile jsonb not null default '{}'::jsonb;

create table mrv_private.onboarding_request (
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  details jsonb not null,
  tenant_id uuid not null references public.tenant(id),
  primary key (user_id, request_id)
);
alter table mrv_private.onboarding_request enable row level security;
revoke all on mrv_private.onboarding_request from public, anon, authenticated;

create function public.mrv_onboard_organization(p_request uuid, p_details jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid(); t uuid; f uuid; previous jsonb; start_date date; end_date date;
  required_key text;
begin
  if u is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_request is null or p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'invalid onboarding request' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_details) k where k not in
    ('name','country','organizationType','registrationNumber','facilityCode','facilityName','timezone','synthetic','start','end')) then
    raise exception 'unknown onboarding field' using errcode = '22023';
  end if;
  foreach required_key in array array['name','country','organizationType','registrationNumber','facilityCode','facilityName','timezone','start','end'] loop
    if jsonb_typeof(p_details->required_key) is distinct from 'string' then
      raise exception 'missing or invalid field %', required_key using errcode = '22023';
    end if;
  end loop;
  if length(btrim(p_details->>'name')) not between 2 and 120
    or length(btrim(p_details->>'country')) not between 2 and 80
    or length(p_details->>'registrationNumber') > 80
    or p_details->>'organizationType' not in ('Cement manufacturer','Cement grinding operator','Cement group')
    or length(btrim(p_details->>'facilityName')) not between 2 and 120
    or btrim(p_details->>'facilityCode') !~ '^[A-Za-z0-9_-]{1,20}$'
    or jsonb_typeof(p_details->'synthetic') is distinct from 'boolean'
    or not exists (select 1 from pg_catalog.pg_timezone_names where name=p_details->>'timezone')
    or p_details->>'start' !~ '^\d{4}-\d{2}-\d{2}$' or p_details->>'end' !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'invalid organization or factory details' using errcode = '22023';
  end if;
  start_date := (p_details->>'start')::date; end_date := (p_details->>'end')::date;
  if start_date < date '2000-01-01' or end_date > date '2100-12-31' or start_date > end_date then
    raise exception 'invalid reporting dates' using errcode = '22023';
  end if;
  -- Serialize retries for this user; a dropped HTTP response must not create another organization.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text, 91009));
  select tenant_id, details into t, previous from mrv_private.onboarding_request where user_id=u and request_id=p_request;
  if t is not null then
    if previous <> p_details then raise exception 'request already used with different details' using errcode = '22023'; end if;
    if not mrv_auth.has_permission(t, null, 'members.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  else
    t := public.mrv_create_organization(p_details->>'name',p_details->>'facilityCode',p_details->>'facilityName',p_details->>'timezone',(p_details->>'synthetic')::boolean);
    update public.tenant set profile = jsonb_build_object('country',btrim(p_details->>'country'),
      'organizationType',p_details->>'organizationType','registrationNumber',btrim(p_details->>'registrationNumber'),
      'initialReportingPeriod',jsonb_build_object('start',p_details->>'start','end',p_details->>'end')) where id=t;
    insert into mrv_private.onboarding_request values(u,p_request,p_details,t);
  end if;
  select id into f from public.facility where tenant_id=t order by created_at,id limit 1;
  perform public.mrv_save_preference(t,f,jsonb_build_object('preset','custom','start',p_details->>'start','end',p_details->>'end'));
  return t;
end $$;
revoke all on function public.mrv_onboard_organization(uuid,jsonb) from public,anon;
grant execute on function public.mrv_onboard_organization(uuid,jsonb) to authenticated;
