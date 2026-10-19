/**
 * Development/test secret rotation without any secret leaving the server process or the database (Directive 06B close-out).
 *
 * 1. begin():    this server process generates an ephemeral RSA-2048 key pair and publishes only the modulus.
 * 2. Operator (SQL, test project): mrv_private.rotate_executor_key / rotate_user_password (db/supabase/0004) draw a random
 *    R < n inside the database, derive the new secret from R, store it (executor key / bcrypt password, sessions revoked)
 *    and return only c = R^65537 mod n (RSA-KEM ciphertext; public).
 * 3. complete(): the server decrypts R, derives the same secrets, VERIFIES them against Supabase (new key accepted, old key
 *    rejected, new password signs in, old password refused) and only then writes them to .env.local and process.env.
 * Responses contain booleans and key ids only.
 */
import { constants, createHash, generateKeyPairSync, privateDecrypt, type KeyObject } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { signExecutorRequest, type ExecutorKey } from "@/lib/mrv/executorSign";

const PROTOCOL = "trace-rotate/v1";
const USERS = { A: "MRV_E2E_A", B: "MRV_E2E_B", C: "MRV_E2E_C", REVOKED: "MRV_E2E_REVOKED" } as const;
type UserLabel = keyof typeof USERS;

const state = globalThis as unknown as { __mrvRotation?: { key: KeyObject; n: bigint; created: number } };

export function beginRotation() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 65537 });
  const n = BigInt("0x" + Buffer.from(publicKey.export({ format: "jwk" }).n as string, "base64url").toString("hex"));
  state.__mrvRotation = { key: privateKey, n, created: Date.now() };
  return { n: n.toString(10), e: 65537, expiresInSeconds: 900 };
}

function unwrap(c: string): bigint {
  const s = state.__mrvRotation;
  if (!s || Date.now() - s.created > 900_000) throw new Error("no active rotation (call begin first)");
  if (!/^[0-9]{1,700}$/.test(c)) throw new Error("ciphertext must be a decimal integer");
  const ci = BigInt(c);
  if (ci <= BigInt(1) || ci >= s.n) throw new Error("ciphertext out of range");
  const buf = Buffer.from(ci.toString(16).padStart(512, "0"), "hex");
  return BigInt("0x" + privateDecrypt({ key: s.key, padding: constants.RSA_NO_PADDING }, buf).toString("hex"));
}

const derive = (label: string, r: bigint) => createHash("sha256").update(`${PROTOCOL}|${label}|${r.toString(10)}`, "utf8").digest();

async function writeEnv(values: Record<string, string>) {
  const path = join(process.cwd(), ".env.local");
  const lines = (await readFile(path, "utf8")).split("\n");
  for (const [k, v] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.splice(lines.length && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length, 0, `${k}=${v}`);
    process.env[k] = v;
  }
  await writeFile(path, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
}

const errText = (e: unknown) => (e ? `${(e as { message?: string }).message ?? String(e)}` : "");

export interface CompleteRequest {
  executor?: { keyId: string; c: string };
  passwords?: { label: UserLabel; userId: string; c: string }[];
}

export async function completeRotation(body: CompleteRequest) {
  const env = process.env;
  const url = env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const client = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const report: Record<string, unknown> = {};
  const updates: Record<string, string> = {};

  // Passwords first: the executor checks need a signed-in user.
  const newPw: Partial<Record<UserLabel, string>> = {};
  for (const p of body.passwords ?? []) {
    if (!(p.label in USERS) || !/^[0-9a-f-]{36}$/.test(p.userId)) throw new Error("invalid password entry");
    const prefix = USERS[p.label];
    const email = env[`${prefix}_EMAIL`];
    const oldPw = env[`${prefix}_PASSWORD`];
    const pw = derive(`password|${p.userId}`, unwrap(p.c)).toString("hex");
    const fresh = await client().auth.signInWithPassword({ email: email!, password: pw });
    const old = oldPw ? await client().auth.signInWithPassword({ email: email!, password: oldPw }) : null;
    const ok = !fresh.error && fresh.data.user?.id === p.userId;
    report[`password_${p.label}`] = { newAccepted: ok, oldRejected: !!old?.error, detail: ok ? undefined : errText(fresh.error) };
    if (ok) {
      updates[`${prefix}_PASSWORD`] = pw;
      newPw[p.label] = pw;
    }
  }

  if (body.executor) {
    const { keyId, c } = body.executor;
    if (!/^[a-z0-9_-]{1,40}$/.test(keyId)) throw new Error("invalid key id");
    const fresh: ExecutorKey = { keyId, secret: derive(`executor|${keyId}`, unwrap(c)) };
    const old: ExecutorKey | null = env.MRV_EXECUTOR_KEY_ID && env.MRV_EXECUTOR_KEY ? { keyId: env.MRV_EXECUTOR_KEY_ID, secret: Buffer.from(env.MRV_EXECUTOR_KEY, "hex") } : null;
    const db = client();
    const signIn = await db.auth.signInWithPassword({ email: env.MRV_E2E_A_EMAIL!, password: newPw.A ?? env.MRV_E2E_A_PASSWORD! });
    if (signIn.error || !signIn.data.user) throw new Error(`verification login failed: ${errText(signIn.error)}`);
    const uid = signIn.data.user.id;
    const t = (await db.from("tenant").select("id").eq("name", "SYNTHETIC E2E Org A").single()).data?.id as string;
    const f = (await db.from("facility").select("id").eq("tenant_id", t).eq("code", "E1").single()).data?.id as string;
    // A deliberately empty body: a valid signature gets past verify_executor and fails on the body ("invalid run body").
    const probe = (k: ExecutorKey) => db.rpc("mrv_finalize_run", { p_tenant: t, p_facility: f, p_body: "{}", p_auth: signExecutorRequest(k, "run", { userId: uid, tenantId: t, facilityId: f }, "{}") });
    const n = await probe(fresh);
    const o = old ? await probe(old) : null;
    const newAccepted = /invalid run body/.test(errText(n.error));
    const oldRejected = !!o && /trusted executor authorization required/.test(errText(o.error));
    report.executor = { keyId, newAccepted, oldKeyId: old?.keyId ?? null, oldRejected, detail: newAccepted ? undefined : errText(n.error) };
    if (newAccepted) {
      updates.MRV_EXECUTOR_KEY_ID = keyId;
      updates.MRV_EXECUTOR_KEY = fresh.secret.toString("hex");
    }
    await db.auth.signOut();
  }

  if (Object.keys(updates).length) await writeEnv(updates);
  report.envUpdated = Object.keys(updates);
  delete state.__mrvRotation;
  return report;
}
