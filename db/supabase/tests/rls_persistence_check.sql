-- Real-database check for 0001/0002 (Directive 05). SYNTHETIC users/orgs only.
-- Runs entirely inside one DO block that always ends with RAISE EXCEPTION, so the transaction is rolled back and
-- nothing persists. The exception message carries the PASS/FAIL report.
do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  ta uuid; tb uuid; fa uuid; fb uuid;
  res jsonb; v_run uuid; rid uuid; n int; ok boolean;
  report text := '';
  r1 jsonb := '{"section":"production","series_key":"production|kiln 1|cem","record_key":"production|kiln 1|cem|2025-01-31|#1","observed_on":"2025-01-31","interval_start":"2025-01-01","interval_end":"2025-01-31","granularity":"month","payload":{"Date":"2025-01-31","Clinker Produced t":100},"content_hash":"h1"}';
  r2 jsonb := '{"section":"electricity","series_key":"electricity|m-01","record_key":"electricity|m-01|2025-01-31|#1","observed_on":"2025-01-31","interval_start":"2025-01-01","interval_end":"2025-01-31","granularity":"month","payload":{"Date":"2025-01-31","Grid MWh":10},"content_hash":"h2"}';
  docs jsonb := '[{"kind":"setup","content":{"Selected calcination method":"Method B"},"content_hash":"c1"}]';
begin
  insert into auth.users (id, email, aud, role) values (ua, 'synthetic-a@example.invalid', 'authenticated', 'authenticated'),
                                                        (ub, 'synthetic-b@example.invalid', 'authenticated', 'authenticated');

  -- act as user A
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ua::text, true);
  execute 'set local role authenticated';
  ta := public.mrv_create_organization('SYNTHETIC Org A', 'A1', 'Synthetic Plant A1', 'Africa/Cairo', true);
  select id into fa from public.facility where tenant_id = ta;
  report := report || format(E'\nT01 org+facility visible to creator: %s', case when fa is not null then 'PASS' else 'FAIL' end);

  res := public.mrv_record_import(ta, fa, '{"origin":"workbook","status":"accepted","filename":"q1.xlsx","sha256":"s1"}', jsonb_build_array(r1, r2), docs);
  report := report || format(E'\nT02 first import inserted=2: %s (%s)', case when (res->>'inserted')::int = 2 then 'PASS' else 'FAIL' end, res);

  res := public.mrv_record_import(ta, fa, '{"origin":"workbook","status":"accepted","filename":"q1.xlsx","sha256":"s1"}', jsonb_build_array(r1, r2), docs);
  report := report || format(E'\nT03 identical file → duplicate, no new readings: %s (%s)', case when res->>'status' = 'duplicate' and (select count(*) from public.activity_reading where tenant_id = ta) = 2 then 'PASS' else 'FAIL' end, res->>'status');

  res := public.mrv_record_import(ta, fa, '{"origin":"manual","status":"accepted"}', jsonb_build_array(r1, r2), docs);
  report := report || format(E'\nT04 same records re-sent → unchanged=2: %s', case when (res->>'unchanged')::int = 2 and (res->>'inserted')::int = 0 then 'PASS' else 'FAIL' end);

  select id into rid from public.activity_reading where tenant_id = ta and section = 'production';
  v_run := public.mrv_record_run(ta, fa, '{"range_start":"2025-01-01","range_end":"2025-03-31","range_label":"Q1","timezone":"Africa/Cairo","engine_version":"e","methodology_version":"m","input_snapshot":{},"input_sha256":"x","results":{},"results_fingerprint":"f","qa_overall":"INCOMPLETE"}',
    array(select id from public.activity_reading where tenant_id = ta), array(select id from public.config_document where tenant_id = ta), '[]');
  report := report || format(E'\nT05 run recorded with pinned inputs: %s', case when (select count(*) from public.calculation_run_input where run_id = v_run) = 2 then 'PASS' else 'FAIL' end);

  res := public.mrv_record_import(ta, fa, '{"origin":"manual","status":"accepted"}', jsonb_build_array(jsonb_set(jsonb_set(r1, '{content_hash}', '"h1b"'), '{payload,Clinker Produced t}', '101')), '[]');
  select count(*) into n from public.activity_reading where tenant_id = ta and section = 'production';
  report := report || format(E'\nT06 correction → revision 2, old kept: %s', case when (res->>'revised')::int = 1 and n = 2
    and (select revision from public.activity_reading where tenant_id = ta and section = 'production' and is_current) = 2 then 'PASS' else 'FAIL' end);
  report := report || format(E'\nT07 affected run marked stale: %s', case when exists (select 1 from public.run_invalidation where run_id = v_run) then 'PASS' else 'FAIL' end);
  report := report || format(E'\nT08 superseded reading still pinned by old run: %s', case when exists (select 1 from public.calculation_run_input where run_id = v_run and reading_id = rid) then 'PASS' else 'FAIL' end);

  begin
    update public.activity_reading set payload = '{}' where id = rid;
    report := report || E'\nT09 direct UPDATE of readings denied: FAIL';
  exception when insufficient_privilege then report := report || E'\nT09 direct UPDATE of readings denied: PASS';
  end;
  begin
    insert into public.activity_reading (tenant_id, facility_id, source_id, batch_id, section, series_key, record_key, observed_on, interval_start, interval_end, granularity, payload, content_hash, revision, created_by)
      select tenant_id, facility_id, source_id, batch_id, section, series_key, 'x', observed_on, interval_start, interval_end, granularity, payload, 'h', 9, ua from public.activity_reading where id = rid;
    report := report || E'\nT10 direct INSERT bypassing RPC denied: FAIL';
  exception when insufficient_privilege then report := report || E'\nT10 direct INSERT bypassing RPC denied: PASS';
  end;
  begin
    res := public.mrv_record_import(ta, fa, '{"origin":"workbook","status":"accepted"}', jsonb_build_array(jsonb_set(r1, '{observed_on}', '"not-a-date"')), '[]');
    report := report || E'\nT11 invalid date rejected atomically: FAIL';
  exception when others then report := report || format(E'\nT11 invalid date rejected atomically: %s', case when (select count(*) from public.import_batch where tenant_id = ta) = 4 then 'PASS' else 'FAIL' end);
  end;

  -- act as user B
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ub::text, true);
  execute 'set local role authenticated';
  tb := public.mrv_create_organization('Org B', 'B1', 'Plant B1', 'UTC', false);
  select id into fb from public.facility where tenant_id = tb;
  report := report || format(E'\nT12 B sees no A tenant/facility/readings/runs/batches/files: %s', case when
    (select count(*) from public.tenant where id = ta) = 0 and (select count(*) from public.facility where tenant_id = ta) = 0
    and (select count(*) from public.activity_reading where tenant_id = ta) = 0 and (select count(*) from public.calculation_run where tenant_id = ta) = 0
    and (select count(*) from public.import_batch where tenant_id = ta) = 0 and (select count(*) from public.config_document where tenant_id = ta) = 0
    and (select count(*) from public.audit_event where tenant_id = ta) = 0 then 'PASS' else 'FAIL' end);
  begin
    res := public.mrv_record_import(ta, fa, '{"origin":"workbook","status":"accepted"}', jsonb_build_array(r1), '[]');
    report := report || E'\nT13 B import into A denied: FAIL';
  exception when insufficient_privilege then report := report || E'\nT13 B import into A denied: PASS';
  end;
  begin
    res := public.mrv_record_import(tb, fa, '{"origin":"workbook","status":"accepted"}', jsonb_build_array(r1), '[]');
    report := report || E'\nT14 B own tenant + A facility id denied: FAIL';
  exception when insufficient_privilege then report := report || E'\nT14 B own tenant + A facility id denied: PASS';
  end;
  begin
    v_run := public.mrv_record_run(tb, fb, '{"range_start":"2025-01-01","range_end":"2025-03-31","range_label":"Q1","timezone":"UTC","engine_version":"e","methodology_version":"m","input_snapshot":{},"input_sha256":"x","results":{},"results_fingerprint":"f","qa_overall":"X"}',
      array[rid], '{}', '[]');
    report := report || E'\nT15 B run pinning A readings denied: FAIL';
  exception when insufficient_privilege then report := report || E'\nT15 B run pinning A readings denied: PASS';
  end;
  begin
    res := public.mrv_record_import(tb, fb, '{"origin":"demo","status":"accepted"}', jsonb_build_array(r1), '[]');
    report := report || E'\nT16 demo data into non-synthetic org denied: FAIL';
  exception when invalid_parameter_value then report := report || E'\nT16 demo data into non-synthetic org denied: PASS';
  end;
  begin
    perform public.mrv_save_preference(ta, fa, '{"preset":"today"}');
    report := report || E'\nT17 B cannot save preference pointing at A facility: FAIL';
  exception when insufficient_privilege then report := report || E'\nT17 B cannot save preference pointing at A facility: PASS';
  end;
  report := report || format(E'\nT18 storage policy: B cannot write/read A paths: %s', case when not mrv_auth.has_permission(ta, fa, 'upload.create') and not mrv_auth.has_permission(ta, fa, 'facility.read') then 'PASS' else 'FAIL' end);
  report := report || format(E'\nT19 cross-tenant facility/tenant mismatch denied: %s', case when not mrv_auth.has_permission(tb, fa, 'facility.read') then 'PASS' else 'FAIL' end);

  -- revoke A's membership: access disappears immediately
  execute 'reset role';
  update public.tenant_membership set status = 'revoked', revoked_at = now() where tenant_id = ta and user_id = ua;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ua::text, true);
  execute 'set local role authenticated';
  report := report || format(E'\nT20 revoked member sees nothing: %s', case when (select count(*) from public.activity_reading where tenant_id = ta) = 0 and (select count(*) from public.tenant where id = ta) = 0 then 'PASS' else 'FAIL' end);

  -- anonymous role
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  begin
    perform count(*) from public.activity_reading;
    report := report || E'\nT21 anon cannot read tables: FAIL';
  exception when insufficient_privilege then report := report || E'\nT21 anon cannot read tables: PASS';
  end;
  begin
    perform public.mrv_create_organization('x', 'X', 'xx', 'UTC', false);
    report := report || E'\nT22 anon cannot call RPCs: FAIL';
  exception when insufficient_privilege then report := report || E'\nT22 anon cannot call RPCs: PASS';
  end;

  -- immutability even for the owner role
  execute 'reset role';
  begin
    update public.calculation_run set results = '{"tampered":true}' where tenant_id = ta;
    report := report || E'\nT23 runs immutable for owner: FAIL';
  exception when insufficient_privilege then report := report || E'\nT23 runs immutable for owner: PASS';
  end;
  begin
    delete from public.activity_reading where tenant_id = ta;
    report := report || E'\nT24 readings cannot be deleted: FAIL';
  exception when insufficient_privilege then report := report || E'\nT24 readings cannot be deleted: PASS';
  end;

  raise exception 'ROLLBACK-REPORT:%', report;
end $$;
