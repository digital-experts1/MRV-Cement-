-- 0004 — Secret rotation for the designated TEST project (Directive 06B close-out). Additive; operator-only.
--
-- Secrets are generated INSIDE the database and leave it only RSA-encrypted (RSA-KEM, e = 65537) to the ephemeral public
-- key of the development server process (lib/server/dev/secretRotation.ts). Neither the operator console nor any log sees
-- a secret. Derivation (must match the server): sha256('trace-rotate/v1|<label>|' || R::text), R uniform-ish below n.
--   executor key:  label 'executor|<key_id>'   → 32-byte HMAC key; all other keys deactivated (retired_at set)
--   user password: label 'password|<user id>'  → hex(sha256) as the password, bcrypt-stored; existing sessions revoked
-- All functions live in mrv_private (no USAGE for anon/authenticated/service_role) and are executable by the owner only.
--
-- Procedure: POST /api/dev/secret-rotation {"action":"begin"} → n;
--   select mrv_private.rotate_executor_key(<n>, 'exec-N'), mrv_private.rotate_user_password(<n>, '<uid>'), …;
--   POST {"action":"complete", executor:{keyId,c}, passwords:[{label,userId,c}]} → server verifies, then writes .env.local.
-- STATUS: applied to vbxvhbnhstdfbkgjuzgs (test) 2026-10-20. Not for production projects.

create or replace function mrv_private.modpow(p_base numeric, p_exp numeric, p_mod numeric) returns numeric
language plpgsql immutable strict set search_path = '' as $$
declare
  r numeric := 1;
  x numeric := mod(p_base, p_mod);
  k numeric := p_exp;
begin
  while k > 0 loop
    if mod(k, 2) = 1 then r := mod(r * x, p_mod); end if;
    x := mod(x * x, p_mod);
    k := div(k, 2);
  end loop;
  return r;
end $$;

create or replace function mrv_private.rsa_kem_secret(p_n numeric) returns numeric
language plpgsql volatile set search_path = '' as $$
declare
  b bytea := extensions.gen_random_bytes(320);
  acc numeric := 0;
  i integer;
begin
  if p_n is null or p_n < power(2::numeric, 2040) or mod(p_n, 2) = 0 then
    raise exception 'RSA modulus must be an odd integer of at least 2040 bits' using errcode = '22023';
  end if;
  for i in 0..319 loop acc := acc * 256 + get_byte(b, i); end loop;
  return mod(acc, p_n);
end $$;

create or replace function mrv_private.rotate_executor_key(p_n numeric, p_key_id text) returns text
language plpgsql volatile set search_path = '' as $$
declare r numeric := mrv_private.rsa_kem_secret(p_n);
begin
  insert into mrv_private.executor_key (key_id, secret)
    values (p_key_id, sha256(convert_to('trace-rotate/v1|executor|' || p_key_id || '|' || r::text, 'UTF8')));
  update mrv_private.executor_key set active = false, retired_at = now() where key_id <> p_key_id and active;
  return mrv_private.modpow(r, 65537, p_n)::text;
end $$;

create or replace function mrv_private.rotate_user_password(p_n numeric, p_user uuid) returns text
language plpgsql volatile set search_path = '' as $$
declare
  r numeric := mrv_private.rsa_kem_secret(p_n);
  pw text := encode(sha256(convert_to('trace-rotate/v1|password|' || p_user::text || '|' || r::text, 'UTF8')), 'hex');
begin
  update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'user not found' using errcode = '22023'; end if;
  delete from auth.sessions where user_id = p_user;
  delete from auth.refresh_tokens where user_id = p_user::text;
  return mrv_private.modpow(r, 65537, p_n)::text;
end $$;

revoke all on function mrv_private.modpow(numeric, numeric, numeric) from public;
revoke all on function mrv_private.rsa_kem_secret(numeric) from public;
revoke all on function mrv_private.rotate_executor_key(numeric, text) from public;
revoke all on function mrv_private.rotate_user_password(numeric, uuid) from public;
