/**
 * Evidence upload-registration vs. deletion race, and concurrent replacements — proven with SEPARATE CONCURRENT
 * TRANSACTIONS on a real multi-process PostgreSQL server (embedded-postgres: a throwaway local cluster in the OS temp
 * directory, deleted afterwards). PGlite cannot do this: it is a single connection, so it can only run sequential cases.
 *
 * Two databases are built in the same cluster from the real migrations:
 *   - `prefix`: 0001–0006 + tests/mrv/fixtures/0007_pre_race_fix.sql (0007 as of commit cc4009c) — must REPRODUCE the race;
 *   - `fixed` : 0001–0007 from db/supabase — must PREVENT it.
 * Supabase's auth/storage schemas are a minimal stand-in (see SCHEMA_SHIM, incl. the real protect_delete trigger). Two
 * Storage API delete flows are modelled: `direct` (DELETE … RETURNING under the caller's role, older Storage API) and
 * `locked` (superuser FOR UPDATE row lock, then a caller-role DELETE probe in a rolled-back savepoint, then the superuser
 * delete — the current upstream storage-api order). Neither is the hosted Storage API itself.
 *
 * Interleavings are forced, not hoped for: a monitor connection polls pg_stat_activity until the second transaction is
 * actually waiting on a lock before the first one commits. SYNTHETIC data only.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { signExecutorRequest, type ExecutorKey } from "@/lib/mrv/executorSign";

export interface ConcurrencyCheck {
  label: string;
  pass: boolean;
  detail?: string;
}

const ROLES = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
`;

const SCHEMA_SHIM = `
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text,
  created_at timestamptz not null default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create function storage.protect_delete() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.' using errcode = '42501';
  end if;
  return null;
end $$;
create trigger protect_objects_delete before delete on storage.objects for each statement execute function storage.protect_delete();
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
`;

const USERS = {
  A: "aaaaaaaa-0000-4000-8000-0000000000a1",
  B: "bbbbbbbb-0000-4000-8000-0000000000b2",
};
const BUCKET = "mrv-private";

type Flow = "direct" | "locked";
type Client = pg.Client;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return `${x.code ?? "?"}: ${x.message ?? String(e)}`;
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function sqlFile(...parts: string[]) {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

export async function runConcurrencyCases(): Promise<{ passed: number; total: number; checks: ConcurrencyCheck[]; server?: string }> {
  const checks: ConcurrencyCheck[] = [];
  const check = (label: string, pass: boolean, detail?: unknown) =>
    checks.push({ label, pass, detail: detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail) });

  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const password = randomBytes(18).toString("hex");
  const port = await freePort();
  const cluster = new EmbeddedPostgres({
    databaseDir: mkdtempSync(join(tmpdir(), "mrv-concurrency-")),
    port,
    user: "postgres",
    password,
    persistent: false,
    postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories=", "-c", "max_connections=40"],
    onLog: () => {},
    onError: () => {},
  });
  const open: Client[] = [];
  const connect = async (database: string) => {
    const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password, database, statement_timeout: 20_000 });
    c.on("error", () => {});
    await c.connect();
    open.push(c);
    return c;
  };
  let server: string | undefined;

  try {
    await cluster.initialise();
    await cluster.start();
    const root = await connect("postgres");
    server = (await root.query<{ v: string }>("select version() as v")).rows[0].v;
    await root.query(ROLES);
    await root.query("create database prefix");
    await root.query("create database fixed");
    check("real PostgreSQL server started (separate backend process per connection)", true, server);

    // ── Build one database from the real migrations ──
    const build = async (database: string, migration0007: string) => {
      const admin = await connect(database);
      await admin.query(SCHEMA_SHIM);
      for (const f of ["0001_mrv_persistence.sql", "0002_mrv_rpc_storage.sql", "0003_mrv_trusted_execution.sql", "0005_dataset_archive.sql", "0006_evidence_documents.sql"]) {
        await admin.query(sqlFile("db", "supabase", f));
      }
      await admin.query(migration0007);
      for (const [k, id] of Object.entries(USERS)) await admin.query("insert into auth.users (id, email) values ($1, $2)", [id, `${k.toLowerCase()}@synthetic.test`]);
      const keyRow = (await admin.query<{ key_id: string; hex: string }>("select key_id, encode(secret, 'hex') as hex from mrv_private.executor_key where active")).rows[0];
      const key: ExecutorKey = { keyId: keyRow.key_id, secret: Buffer.from(keyRow.hex, "hex") };

      const asUser = async (c: Client, uid: string, isolation = "read committed") => {
        await c.query(`begin isolation level ${isolation}`);
        await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
        await c.query("set local role authenticated");
      };
      const tx = async <T,>(uid: string, fn: (c: Client) => Promise<T>) => {
        await asUser(admin, uid);
        try {
          const r = await fn(admin);
          await admin.query("commit");
          return r;
        } catch (e) {
          await admin.query("rollback");
          throw e;
        }
      };
      const tA = await tx(USERS.A, async (c) => (await c.query<{ id: string }>("select public.mrv_create_organization('Synthetic Org A', 'A1', 'Synthetic Factory A1', 'UTC', true) as id")).rows[0].id);
      const fA = (await admin.query<{ id: string }>("select id from public.facility where tenant_id = $1", [tA])).rows[0].id;
      await tx(USERS.B, (c) => c.query("select public.mrv_create_organization('Synthetic Org B', 'B1', 'Synthetic Factory B1', 'UTC', true)"));

      const body = (id: string, path: string, replaces: string | null = null, evidenceId = "EV-C") =>
        JSON.stringify({
          id, evidence_id: evidenceId, category: "electricity", coverage_start: "2025-01-01", coverage_end: "2025-01-31",
          filename: `synthetic-${id.slice(0, 8)}.pdf`, mime: "application/pdf", size_bytes: 4096, sha256: "c".repeat(64), storage_path: path, replaces,
        });
      const newDoc = () => {
        const id = crypto.randomUUID();
        return { id, path: `${tA}/${fA}/evidence/${id}/synthetic.pdf` };
      };
      /** Storage upload: the caller's role inserts the object row (INSERT policy: upload.create) and commits. */
      const upload = (path: string, uid = USERS.A) =>
        tx(uid, (c) => c.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ($1, $2, $3::uuid, $4::text)", [BUCKET, path, uid, uid]));
      /** Trusted-executor RPC inside an already-open transaction on `c`. */
      const register = async (c: Client, id: string, path: string, replaces: string | null = null, uid = USERS.A) => {
        const b = body(id, path, replaces);
        const auth = signExecutorRequest(key, "evidence", { userId: uid, tenantId: tA, facilityId: fA }, b);
        return (await c.query<{ r: string }>("select public.mrv_store_evidence_document($1, $2, $3, $4::jsonb) as r", [tA, fA, b, JSON.stringify(auth)])).rows[0].r;
      };
      /** Opens the deleting transaction and runs the delete; returns the names actually deleted (transaction left open). */
      const deleteIn = async (c: Client, flow: Flow, path: string, uid = USERS.A, isolation = "read committed") => {
        if (flow === "direct") {
          await asUser(c, uid, isolation);
          await c.query("select set_config('storage.allow_delete_query', 'true', true)");
          return (await c.query<{ name: string }>("delete from storage.objects where bucket_id = $1 and name = any($2) returning name", [BUCKET, [path]])).rows.map((r) => r.name);
        }
        await c.query(`begin isolation level ${isolation}`);
        await c.query("select set_config('storage.allow_delete_query', 'true', true)");
        const locked = (await c.query<{ name: string }>("select name from storage.objects where bucket_id = $1 and name = any($2) for update", [BUCKET, [path]])).rows.map((r) => r.name);
        if (!locked.length) return [];
        await c.query("savepoint permission_probe");
        await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
        await c.query("set local role authenticated");
        const allowed = (await c.query<{ name: string }>("delete from storage.objects where bucket_id = $1 and name = any($2) returning name", [BUCKET, locked])).rows.map((r) => r.name);
        await c.query("rollback to savepoint permission_probe");
        if (!allowed.length) return [];
        return (await c.query<{ name: string }>("delete from storage.objects where bucket_id = $1 and name = any($2) returning name", [BUCKET, allowed])).rows.map((r) => r.name);
      };
      const state = async (id: string, path: string) => {
        const r = (await admin.query<{ meta: number; obj: number; audit: number }>(
          "select (select count(*)::int from public.evidence_document where id = $1::uuid) as meta, (select count(*)::int from storage.objects where bucket_id = $2 and name = $3) as obj, (select count(*)::int from public.audit_event where action = 'evidence.document' and target = $4::text) as audit",
          [id, BUCKET, path, id]
        )).rows[0];
        return { metadata: r.meta, file: r.obj, audit: r.audit, danglingMetadata: r.meta === 1 && r.obj === 0 };
      };
      return { database, admin, key, tA, fA, asUser, tx, register, upload, deleteIn, newDoc, state };
    };

    const prefix = await build("prefix", sqlFile("tests", "mrv", "fixtures", "0007_pre_race_fix.sql"));
    const fixed = await build("fixed", sqlFile("db", "supabase", "0007_evidence_replacement_order.sql"));
    check("migrations apply on real PostgreSQL: prefix = 0001–0006 + pre-fix 0007, fixed = 0001–0007", true);

    const mon = await connect("postgres");
    const pidOf = async (c: Client) => (await c.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
    /** Polls until backend `pid` is waiting on a heavyweight lock (proof the interleaving really happened). */
    const waitBlocked = async (pid: number, ms = 5000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const r = (await mon.query<{ t: string | null; e: string | null }>("select wait_event_type as t, wait_event as e from pg_stat_activity where pid = $1", [pid])).rows[0];
        if (r?.t === "Lock") return `${r.t}/${r.e}`;
        await sleep(15);
      }
      return null;
    };
    const settle = <T,>(p: Promise<T>) => p.then((value) => ({ ok: true as const, value }), (e) => ({ ok: false as const, error: errText(e) }));

    // ── Interleaving 1: DELETION WINS (delete holds the row, registration starts, delete commits first) ──
    const deletionWins = async (db: Awaited<ReturnType<typeof build>>, flow: Flow) => {
      const doc = db.newDoc();
      await db.upload(doc.path);
      const D = await connect(db.database);
      const R = await connect(db.database);
      const rPid = await pidOf(R);
      const deleted = await db.deleteIn(D, flow, doc.path);
      await db.asUser(R, USERS.A);
      const rp = settle(db.register(R, doc.id, doc.path));
      const blocked = await waitBlocked(rPid, 1500);
      await D.query("commit");
      const reg = await rp;
      await R.query(reg.ok ? "commit" : "rollback");
      const after = await db.state(doc.id, doc.path);
      await D.end();
      await R.end();
      return { deleted: deleted.length, registrationBlocked: blocked, registration: reg.ok ? "committed" : reg.error, after };
    };
    // ── Interleaving 2: REGISTRATION WINS (registration done but uncommitted, delete starts, registration commits first) ──
    const registrationWins = async (db: Awaited<ReturnType<typeof build>>, flow: Flow) => {
      const doc = db.newDoc();
      await db.upload(doc.path);
      const R = await connect(db.database);
      const D = await connect(db.database);
      const dPid = await pidOf(D);
      await db.asUser(R, USERS.A);
      const id = await db.register(R, doc.id, doc.path);
      const dp = settle(db.deleteIn(D, flow, doc.path));
      const blocked = await waitBlocked(dPid, 1500);
      await R.query("commit");
      const del = await dp;
      await D.query(del.ok ? "commit" : "rollback");
      const after = await db.state(doc.id, doc.path);
      await D.end();
      await R.end();
      return { registered: id === doc.id, deleteBlocked: blocked, deleted: del.ok ? del.value.length : del.error, after };
    };

    for (const flow of ["direct", "locked"] as Flow[]) {
      // Pre-fix: the race must be reproducible (metadata committed while its file was deleted).
      const p1 = await deletionWins(prefix, flow);
      check(`[pre-fix 0007, ${flow} delete] RACE REPRODUCED — deletion wins: registration is not blocked and commits metadata for a deleted file`,
        p1.deleted === 1 && p1.registrationBlocked === null && p1.registration === "committed" && p1.after.danglingMetadata, p1);
      const p2 = await registrationWins(prefix, flow);
      check(`[pre-fix 0007, ${flow} delete] RACE REPRODUCED — registration wins: the delete is not blocked, both commit, metadata references a deleted file`,
        p2.registered && p2.deleteBlocked === null && p2.deleted === 1 && p2.after.danglingMetadata, p2);

      // Fixed: both interleavings stay consistent.
      const f1 = await deletionWins(fixed, flow);
      check(`[fixed 0007, ${flow} delete] deletion wins: registration waits on the row lock, then fails; no metadata, no audit event, file gone`,
        f1.deleted === 1 && f1.registrationBlocked !== null && /uploaded file was not found/.test(f1.registration) && f1.after.metadata === 0 && f1.after.audit === 0 && f1.after.file === 0, f1);
      const f2 = await registrationWins(fixed, flow);
      check(`[fixed 0007, ${flow} delete] registration wins: the delete waits on the row lock, then deletes 0 rows; metadata and file both retained`,
        f2.registered && f2.deleteBlocked !== null && f2.deleted === 0 && f2.after.metadata === 1 && f2.after.file === 1, f2);
    }

    // ── Concurrent replacements of the same document (fixed) ──
    {
      const db = fixed;
      const x = db.newDoc();
      await db.upload(x.path);
      await db.tx(USERS.A, (c) => db.register(c, x.id, x.path));
      const y = db.newDoc();
      const z = db.newDoc();
      await db.upload(y.path);
      await db.upload(z.path);
      const R1 = await connect(db.database);
      const R2 = await connect(db.database);
      const r2Pid = await pidOf(R2);
      await db.asUser(R1, USERS.A);
      await db.register(R1, y.id, y.path, x.id);
      await db.asUser(R2, USERS.A);
      const r2p = settle(db.register(R2, z.id, z.path, x.id));
      const blocked = await waitBlocked(r2Pid, 1500);
      await R1.query("commit");
      const r2 = await r2p;
      await R2.query(r2.ok ? "commit" : "rollback");
      const rows = (await db.admin.query<{ id: string; is_current: boolean; superseded_by: string | null }>(
        "select id, is_current, superseded_by from public.evidence_document where id = any($1)", [[x.id, y.id, z.id]])).rows;
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      const current = Number((await db.admin.query<{ n: number }>("select count(*)::int as n from public.evidence_document where facility_id = $1 and evidence_id = 'EV-C' and is_current and id = any($2)", [db.fA, [x.id, y.id, z.id]])).rows[0].n);
      await R1.end();
      await R2.end();
      check("[fixed] two concurrent replacements of the same document (ordered): the second waits, then is refused; one successor, history intact",
        blocked !== null && !r2.ok && /no longer current/.test(r2.error) && byId[x.id]?.is_current === false && byId[x.id]?.superseded_by === y.id
          && byId[y.id]?.is_current === true && !byId[z.id] && current === 1,
        { blocked, r2: r2.ok ? "committed" : r2.error, rows, current });

      // Unordered: both fire at the same moment; each commits on success. Exactly one may win.
      const x2 = db.newDoc();
      await db.upload(x2.path);
      await db.tx(USERS.A, (c) => db.register(c, x2.id, x2.path));
      const y2 = db.newDoc();
      const z2 = db.newDoc();
      await db.upload(y2.path);
      await db.upload(z2.path);
      const S1 = await connect(db.database);
      const S2 = await connect(db.database);
      const attempt = async (c: Client, d: { id: string; path: string }) => {
        await db.asUser(c, USERS.A);
        try {
          await db.register(c, d.id, d.path, x2.id);
          await c.query("commit");
          return "committed";
        } catch (e) {
          await c.query("rollback");
          return errText(e);
        }
      };
      const [a1, a2] = await Promise.all([attempt(S1, y2), attempt(S2, z2)]);
      const winners = [a1, a2].filter((r) => r === "committed").length;
      const loserRefused = [a1, a2].some((r) => /no longer current/.test(r));
      const cur2 = (await db.admin.query<{ id: string }>("select id from public.evidence_document where id = any($1) and is_current", [[x2.id, y2.id, z2.id]])).rows.map((r) => r.id);
      const sup = (await db.admin.query<{ s: string | null }>("select superseded_by as s from public.evidence_document where id = $1", [x2.id])).rows[0].s;
      const winnerId = a1 === "committed" ? y2.id : z2.id;
      const loser = a1 === "committed" ? z2 : y2;
      await S1.end();
      await S2.end();
      check("[fixed] two concurrent replacements fired simultaneously: exactly one commits, the other is refused, exactly one current successor",
        winners === 1 && loserRefused && cur2.length === 1 && cur2[0] === winnerId && sup === winnerId, { a1, a2, cur2, sup });

      // The loser's file is an unregistered orphan: its uploader may remove it; the winner's file stays immutable.
      const C = await connect(db.database);
      const delLoser = await db.deleteIn(C, "direct", loser.path);
      await C.query("commit");
      const delWinner = await db.deleteIn(C, "direct", a1 === "committed" ? y2.path : z2.path);
      await C.query("commit");
      await C.end();
      check("[fixed] after the race the losing upload can be cleaned up by its uploader; the winning document's file cannot be deleted",
        delLoser.length === 1 && delWinner.length === 0, { delLoser: delLoser.length, delWinner: delWinner.length });
    }

    // ── Privilege model of the fixed helper/policy, as the authenticated role ──
    {
      const db = fixed;
      const a = db.admin;
      const priv = (await a.query<{ usage: boolean; exec_auth: boolean; exec_anon: boolean; exec_service: boolean; grantees: string[]; secdef: boolean; volatile: string; upd: boolean }>(
        `select has_schema_privilege('authenticated', 'mrv_private', 'USAGE') as usage,
           has_function_privilege('authenticated', 'mrv_private.evidence_file_deletable(text, text)', 'EXECUTE') as exec_auth,
           has_function_privilege('anon', 'mrv_private.evidence_file_deletable(text, text)', 'EXECUTE') as exec_anon,
           has_function_privilege('service_role', 'mrv_private.evidence_file_deletable(text, text)', 'EXECUTE') as exec_service,
           (select array_agg(coalesce(r.rolname, 'PUBLIC') order by 1) from pg_proc p cross join lateral aclexplode(p.proacl) x left join pg_roles r on r.oid = x.grantee
             where p.oid = 'mrv_private.evidence_file_deletable(text, text)'::regprocedure and x.privilege_type = 'EXECUTE') as grantees,
           (select prosecdef from pg_proc where oid = 'mrv_private.evidence_file_deletable(text, text)'::regprocedure) as secdef,
           (select provolatile::text from pg_proc where oid = 'mrv_private.evidence_file_deletable(text, text)'::regprocedure) as volatile,
           has_table_privilege('authenticated', 'storage.objects', 'UPDATE') as upd`
      )).rows[0];
      check("helper grants are minimal: EXECUTE only for authenticated (+ owner); no PUBLIC/anon/service_role; authenticated has NO USAGE on mrv_private",
        !priv.usage && priv.exec_auth && !priv.exec_anon && !priv.exec_service && !priv.grantees.includes("PUBLIC") && priv.secdef && priv.volatile === "v", priv);

      const c = await connect(db.database);
      await db.asUser(c, USERS.A);
      const direct = await settle(c.query("select mrv_private.evidence_file_deletable($1, $2)", [BUCKET, "x"]));
      await c.query("rollback");
      check("authenticated cannot call the helper by name (no schema USAGE) — the policy is its only entry point",
        !direct.ok && /42501/.test(direct.error) && /schema mrv_private/.test(direct.error), direct);

      // The policy expression runs as the QUERYING role: without EXECUTE for authenticated the DELETE itself errors.
      const orphan = db.newDoc();
      await db.upload(orphan.path);
      await a.query("begin");
      await a.query("revoke execute on function mrv_private.evidence_file_deletable(text, text) from authenticated");
      await a.query("select set_config('request.jwt.claim.sub', $1, true)", [USERS.A]);
      await a.query("set local role authenticated");
      await a.query("select set_config('storage.allow_delete_query', 'true', true)");
      const noExec = await settle(a.query("delete from storage.objects where bucket_id = $1 and name = $2", [BUCKET, orphan.path]));
      await a.query("rollback");
      check("policy expressions execute with the querying user's privileges: revoking EXECUTE from authenticated makes the DELETE fail (rolled back)",
        !noExec.ok && /42501/.test(noExec.error) && /evidence_file_deletable/.test(noExec.error), noExec);

      // The helper BODY runs as its owner: it row-locks storage.objects although authenticated holds no UPDATE there.
      const own = await db.deleteIn(c, "direct", orphan.path);
      await c.query("commit");
      check("SECURITY DEFINER body runs with the owner's privileges: the FOR UPDATE row lock succeeds although authenticated lacks UPDATE on storage.objects; uploader removes own orphan",
        !priv.upd && own.length === 1, { authenticatedHasUpdate: priv.upd, deleted: own.length });

      const rr = db.newDoc();
      await db.upload(rr.path);
      const rrDel = await db.deleteIn(c, "direct", rr.path, USERS.A, "repeatable read");
      await c.query("commit");
      check("fail-closed outside READ COMMITTED: a REPEATABLE READ delete of an unregistered file is refused", rrDel.length === 0, { deleted: rrDel.length });

      const bDel = await db.deleteIn(c, "direct", rr.path, USERS.B);
      await c.query("commit");
      const flowLocked = await db.deleteIn(c, "locked", rr.path, USERS.B);
      await c.query("commit");
      check("tenant isolation: user B (other organization) cannot delete A's orphan in either delete flow", bDel.length === 0 && flowLocked.length === 0, { bDel: bDel.length, flowLocked: flowLocked.length });
      await c.end();
    }
  } catch (e) {
    check("concurrency suite completed without an unexpected error", false, errText(e));
  } finally {
    for (const c of open) await c.end().catch(() => {});
    await cluster.stop().catch(() => {});
  }
  return { passed: checks.filter((c) => c.pass).length, total: checks.length, checks, server };
}
