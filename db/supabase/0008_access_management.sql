-- 0008_access_management — member invitations, role assignment and access revocation (owner-requested first version)
-- Additive only: one new table, read helpers and write RPCs that re-check `members.manage` inside every call.
-- Reuses the existing identity (Supabase Auth), tenant/membership/role tables and the role_permission matrix —
-- no new roles, no new permissions, no changes to existing tables, policies or data.
--
-- Guarantees:
--   * every mutation RPC requires the caller to hold `members.manage` in that tenant (tenant_admin only role granting it);
--   * `tenant_admin` may only be granted tenant-wide (existing role rule, re-checked here);
--   * the last active tenant administrator can never be demoted (role revoked) or removed (membership revoked);
--   * revoking access keeps the auth account, the membership row (status='revoked'), historical records and the
--     user's memberships in other tenants untouched;
--   * invitations are expiring (7 days) and single-use, bound to one email address, stored only as a SHA-256 hash;
--   * every change writes an audit_event row (append-only trail);
--   * `authenticated` keeps SELECT-only grants on tenant_invitation — all writes happen through the RPCs below.

-- ───────────────────────── Invitations ─────────────────────────
create table public.tenant_invitation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  email text not null check (length(btrim(email)) <= 160 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role text not null check (role in ('tenant_admin', 'facility_manager', 'contributor_production', 'contributor_utilities',
    'contributor_laboratory', 'mrv_analyst', 'reviewer', 'approver', 'auditor')),
  facility_id uuid, -- NULL = tenant-wide (forced for tenant_admin)
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days' check (expires_at > created_at),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  revoked_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, facility_id) references public.facility (tenant_id, id),
  check (role <> 'tenant_admin' or facility_id is null),
  check (accepted_at is null or accepted_by is not null)
);
create index tenant_invitation_open on public.tenant_invitation (tenant_id) where accepted_at is null and revoked_at is null;

alter table public.tenant_invitation enable row level security;
revoke all on table public.tenant_invitation from anon, authenticated;
grant select on table public.tenant_invitation to authenticated;
grant select, insert, update, delete on table public.tenant_invitation to service_role;
create policy tenant_invitation_read on public.tenant_invitation for select to authenticated
  using (mrv_auth.has_permission(tenant_id, null, 'members.manage'));

-- ───────────────────────── Helpers ─────────────────────────
-- Count of OTHER active tenant administrators (tenant-wide role, active membership). Used only inside the SECURITY
-- DEFINER RPCs below; never granted to any client role.
create function mrv_auth.active_tenant_admin_count(p_tenant uuid, p_exclude_membership uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*)
  from public.role_assignment a
  join public.tenant_membership m on m.tenant_id = a.tenant_id and m.id = a.membership_id and m.status = 'active'
  where a.tenant_id = p_tenant and a.role = 'tenant_admin' and a.facility_id is null and a.revoked_at is null
    and a.membership_id is distinct from p_exclude_membership
$$;
revoke all on function mrv_auth.active_tenant_admin_count(uuid, uuid) from public, anon, authenticated;

-- ───────────────────────── Listing (members.manage holders only) ─────────────────────────
create function public.mrv_list_members(p_tenant uuid)
returns table (membership_id uuid, user_id uuid, email text, status text, joined_at timestamptz, revoked_at timestamptz, roles jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not mrv_auth.has_permission(p_tenant, null, 'members.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select m.id, m.user_id, u.email, m.status, m.created_at, m.revoked_at,
      coalesce((
        select jsonb_agg(jsonb_build_object('role', a.role, 'facility_id', a.facility_id) order by a.role, a.facility_id nulls first)
        from public.role_assignment a
        where a.tenant_id = p_tenant and a.membership_id = m.id and a.revoked_at is null), '[]'::jsonb)
    from public.tenant_membership m
    join auth.users u on u.id = m.user_id
    where m.tenant_id = p_tenant;
end $$;

create function public.mrv_list_invitations(p_tenant uuid)
returns table (id uuid, email text, role text, facility_id uuid, created_at timestamptz, expires_at timestamptz,
               accepted_at timestamptz, revoked_at timestamptz, invited_by uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not mrv_auth.has_permission(p_tenant, null, 'members.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select i.id, i.email, i.role, i.facility_id, i.created_at, i.expires_at, i.accepted_at, i.revoked_at, i.invited_by
    from public.tenant_invitation i
    where i.tenant_id = p_tenant
    order by i.created_at desc, i.id;
end $$;

-- ───────────────────────── Invitation lifecycle ─────────────────────────
-- Returns the raw single-use token (shown once in the UI as a copyable "Not emailed" link). Only its SHA-256 hash is stored.
create function public.mrv_invite_member(p_tenant uuid, p_email text, p_role text, p_facility uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
  v_facility uuid := nullif(p_facility::text, '')::uuid;
begin
  if not mrv_auth.has_permission(p_tenant, null, 'members.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_role is null or not exists (select 1 from public.role_permission rp where rp.role = p_role) then
    raise exception 'unknown role' using errcode = '22023';
  end if;
  if p_role = 'tenant_admin' and v_facility is not null then
    raise exception 'tenant_admin can only be granted tenant-wide' using errcode = '22023';
  end if;
  if v_facility is not null and not exists (select 1 from public.facility f where f.tenant_id = p_tenant and f.id = v_facility) then
    raise exception 'unknown facility' using errcode = '22023';
  end if;
  if p_email is null or btrim(p_email) = '' or length(btrim(p_email)) > 160
     or btrim(p_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'a valid email address is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.tenant_membership m join auth.users u on u.id = m.user_id
    where m.tenant_id = p_tenant and m.status = 'active' and lower(u.email) = lower(btrim(p_email))) then
    raise exception 'this person is already an active member' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.tenant_invitation i
    where i.tenant_id = p_tenant and lower(i.email) = lower(btrim(p_email))
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) then
    raise exception 'an open invitation for this email already exists (revoke it first)' using errcode = '22023';
  end if;
  -- 256-bit token from two random UUIDs (no extension needed); only its SHA-256 hash is persisted.
  v_token := encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'utf8')), 'hex');
  insert into public.tenant_invitation (tenant_id, email, role, facility_id, token_hash, invited_by)
    values (p_tenant, lower(btrim(p_email)), p_role, v_facility, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), v_uid);
  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
    values (p_tenant, null, v_uid, 'access.invitation.create', p_email,
      jsonb_build_object('email', lower(btrim(p_email)), 'role', p_role, 'facility_id', v_facility));
  return v_token;
end $$;

-- What a token holder may learn BEFORE accepting: which organization, role and scope it grants, and its expiry.
-- Requires the (secret) token; returns no rows for revoked, used or expired invitations.
create function public.mrv_invitation_preview(p_token text)
returns table (tenant_id uuid, tenant_name text, email text, role text, facility_id uuid, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.tenant_id, t.name, i.email, i.role, i.facility_id, i.expires_at
  from public.tenant_invitation i
  join public.tenant t on t.id = i.tenant_id and t.status = 'active'
  where i.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
$$;

-- Accepts an invitation: binds to the signed-in account whose email matches, activates the membership (or reactivates
-- a previously revoked one) and grants the invited role. Single-use and expiring, enforced by the guarded UPDATE.
create function public.mrv_accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv record;
  v_membership uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid invitation' using errcode = '22023';
  end if;
  select u.email into v_email from auth.users u where u.id = v_uid;
  if v_email is null then raise exception 'your account has no email address' using errcode = '42501'; end if;
  select * into v_inv from public.tenant_invitation i
    where i.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now();
  if v_inv.id is null then
    raise exception 'the invitation is invalid, expired, revoked or already used' using errcode = '22023';
  end if;
  if lower(v_inv.email) <> lower(v_email) then
    raise exception 'this invitation was issued for a different email address' using errcode = '42501';
  end if;
  -- Single-use: the guarded UPDATE is the arbiter under concurrency.
  update public.tenant_invitation set accepted_at = now(), accepted_by = v_uid
    where id = v_inv.id and accepted_at is null and revoked_at is null and expires_at > now()
    returning id into v_inv.id;
  if v_inv.id is null then
    raise exception 'the invitation is invalid, expired, revoked or already used' using errcode = '22023';
  end if;
  select m.id into v_membership from public.tenant_membership m
    where m.tenant_id = v_inv.tenant_id and m.user_id = v_uid for update;
  if v_membership is null then
    insert into public.tenant_membership (tenant_id, user_id) values (v_inv.tenant_id, v_uid) returning id into v_membership;
  else
    update public.tenant_membership set status = 'active', revoked_at = null where id = v_membership;
  end if;
  if not exists (select 1 from public.role_assignment a
    where a.tenant_id = v_inv.tenant_id and a.membership_id = v_membership and a.role = v_inv.role
      and a.facility_id is not distinct from v_inv.facility_id and a.revoked_at is null) then
    insert into public.role_assignment (tenant_id, membership_id, role, facility_id, granted_by)
      values (v_inv.tenant_id, v_membership, v_inv.role, v_inv.facility_id, v_uid);
  end if;
  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
    values (v_inv.tenant_id, null, v_uid, 'access.invitation.accept', v_membership::text,
      jsonb_build_object('email', v_email, 'role', v_inv.role, 'facility_id', v_inv.facility_id));
  return v_inv.tenant_id;
end $$;

create function public.mrv_revoke_invitation(p_tenant uuid, p_invitation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if not mrv_auth.has_permission(p_tenant, null, 'members.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update public.tenant_invitation set revoked_at = now()
    where tenant_id = p_tenant and id = p_invitation and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'invitation not found or no longer open' using errcode = '22023';
  end if;
  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
    values (p_tenant, null, v_uid, 'access.invitation.revoke', p_invitation::text, '{}'::jsonb);
end $$;

-- ───────────────────────── Role assignment and access revocation ─────────────────────────
-- p_grant=true grants, p_grant=false revokes the (role, facility) assignment. NULL facility = tenant-wide.
create function public.mrv_set_member_role(p_tenant uuid, p_membership uuid, p_role text, p_facility uuid, p_grant boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_facility uuid := nullif(p_facility::text, '')::uuid;
  v_member record;
begin
  if not mrv_auth.has_permission(p_tenant, null, 'members.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_role is null or not exists (select 1 from public.role_permission rp where rp.role = p_role) then
    raise exception 'unknown role' using errcode = '22023';
  end if;
  select m.user_id, m.status into v_member from public.tenant_membership m
    where m.tenant_id = p_tenant and m.id = p_membership;
  if v_member.user_id is null then raise exception 'membership not found' using errcode = '22023'; end if;
  if p_role = 'tenant_admin' and v_facility is not null then
    raise exception 'tenant_admin can only be granted tenant-wide' using errcode = '22023';
  end if;
  if v_facility is not null and not exists (select 1 from public.facility f where f.tenant_id = p_tenant and f.id = v_facility) then
    raise exception 'unknown facility' using errcode = '22023';
  end if;
  if p_grant then
    if v_member.status <> 'active' then raise exception 'membership is revoked; re-invite the member first' using errcode = '22023'; end if;
    -- Idempotent: an identical active assignment is not duplicated.
    if not exists (select 1 from public.role_assignment a
      where a.tenant_id = p_tenant and a.membership_id = p_membership and a.role = p_role
        and a.facility_id is not distinct from v_facility and a.revoked_at is null) then
      insert into public.role_assignment (tenant_id, membership_id, role, facility_id, granted_by)
        values (p_tenant, p_membership, p_role, v_facility, v_uid);
      insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
        values (p_tenant, null, v_uid, 'access.role.grant', p_membership::text,
          jsonb_build_object('role', p_role, 'facility_id', v_facility));
    end if;
  else
    if p_role = 'tenant_admin' and mrv_auth.active_tenant_admin_count(p_tenant, p_membership) = 0 then
      raise exception 'the last active tenant administrator cannot be demoted' using errcode = '22023';
    end if;
    update public.role_assignment set revoked_at = now()
      where tenant_id = p_tenant and membership_id = p_membership and role = p_role
        and facility_id is not distinct from v_facility and revoked_at is null;
    if not found then
      raise exception 'this role is not assigned to this member' using errcode = '22023';
    end if;
    insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
      values (p_tenant, null, v_uid, 'access.role.revoke', p_membership::text,
        jsonb_build_object('role', p_role, 'facility_id', v_facility));
  end if;
end $$;

-- Revokes ALL tenant access for the member (membership + every role assignment) without deleting anything.
create function public.mrv_revoke_member_access(p_tenant uuid, p_membership uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if not mrv_auth.has_permission(p_tenant, null, 'members.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 500 then
    raise exception 'a reason (3–500 characters) is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenant_membership m where m.tenant_id = p_tenant and m.id = p_membership) then
    raise exception 'membership not found' using errcode = '22023';
  end if;
  if exists (select 1 from public.role_assignment a
    where a.tenant_id = p_tenant and a.membership_id = p_membership and a.role = 'tenant_admin'
      and a.facility_id is null and a.revoked_at is null)
    and mrv_auth.active_tenant_admin_count(p_tenant, p_membership) = 0 then
    raise exception 'the last active tenant administrator cannot be removed' using errcode = '22023';
  end if;
  update public.tenant_membership set status = 'revoked', revoked_at = now()
    where tenant_id = p_tenant and id = p_membership and status = 'active';
  if not found then raise exception 'membership is not active' using errcode = '22023'; end if;
  update public.role_assignment set revoked_at = now()
    where tenant_id = p_tenant and membership_id = p_membership and revoked_at is null;
  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
    values (p_tenant, null, v_uid, 'access.member.revoke', p_membership::text, jsonb_build_object('reason', btrim(p_reason)));
end $$;

-- ───────────────────────── Data API grants ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'mrv_list_members(uuid)',
    'mrv_list_invitations(uuid)',
    'mrv_invite_member(uuid, text, text, uuid)',
    'mrv_invitation_preview(text)',
    'mrv_accept_invitation(text)',
    'mrv_revoke_invitation(uuid, uuid)',
    'mrv_set_member_role(uuid, uuid, text, uuid, boolean)',
    'mrv_revoke_member_access(uuid, uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
