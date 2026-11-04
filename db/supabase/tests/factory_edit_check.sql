-- Owner-run synthetic test. Expected final exception rolls back all fixtures and edits.
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); t uuid; f uuid; blocked boolean;
 d jsonb:='{"name":"SYNTHETIC edited factory","country":"Egypt","city":"Cairo","address":"TEST ONLY","siteType":"Integrated cement plant","registrationNumber":"TEST"}';
begin
 insert into auth.users(id,email) values(a,a::text||'@example.invalid'),(b,b::text||'@example.invalid');
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 t:=public.mrv_create_organization('SYNTHETIC factory edit test','TEST','Synthetic factory','UTC',true);
 select id into f from public.facility where tenant_id=t;
 perform public.mrv_update_factory(t,f,d,1);
 if not exists(select 1 from public.facility where id=f and name=d->>'name' and profile->>'city'='Cairo' and profile_version=2 and code='TEST' and timezone='UTC') then raise exception 'save failed'; end if;
 if not exists(select 1 from public.audit_event where tenant_id=t and facility_id=f and action='factory.updated' and actor_id=a) then raise exception 'audit missing'; end if;
 blocked:=false;
 begin perform public.mrv_update_factory(t,f,d,1); exception when sqlstate 'MRV09' then blocked:=true; end;
 if not blocked then raise exception 'stale overwrite allowed'; end if;
 blocked:=false;
 begin perform public.mrv_update_factory(t,f,d||'{"tenant_id":"forged"}',2); exception when invalid_parameter_value then blocked:=true; end;
 if not blocked then raise exception 'unknown field allowed'; end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 blocked:=false;
 begin perform public.mrv_update_factory(t,f,d,2); exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'cross-tenant edit allowed'; end if;
 execute 'reset role';
 raise exception 'FACTORY_EDIT_PASS_ROLLED_BACK';
end $$;
