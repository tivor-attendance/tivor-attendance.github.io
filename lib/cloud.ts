"use client";

// Supabase (free tier) as the shared online store + admin sign-in, used from the static site.
// Talks to Supabase's REST endpoints directly, so no extra packages are needed.
// The anon key is public by design: the `kv` table only allows signed-in users (row-level security).

export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const CLOUD_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const ADMIN_EMAIL = "pranay@altiq.one";

const SESSION_KEY = "tivor-cloud-session";
interface Session { access_token: string; refresh_token: string; expires_at: number }

export class CloudError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const OFFLINE = "Can't reach the online database. Check your internet connection and try again.";

function readSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null"); } catch { return null; }
}
function writeSession(s: Session | null) {
  try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

async function call(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("apikey", SUPABASE_ANON_KEY);
  headers.set("Authorization", `Bearer ${init.token ?? SUPABASE_ANON_KEY}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  try {
    return await fetch(`${SUPABASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new CloudError(0, OFFLINE);
  }
}

function toSession(j: { access_token: string; refresh_token: string; expires_in: number }): Session {
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000 };
}

// ------------------------------------------------------------------ Auth

/** Signs the admin in with the passkey (= the Supabase password). Returns an error message or null. */
export async function cloudSignIn(password: string): Promise<string | null> {
  const res = await call("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: ADMIN_EMAIL, password }) }).catch((e: CloudError) => e);
  if (res instanceof CloudError) return res.message;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return res.status === 400 || res.status === 401 ? "Incorrect passkey. Please try again." : j.error_description || j.msg || "Sign-in failed. Please try again.";
  writeSession(toSession(j));
  return null;
}

export function cloudHasSession(): boolean {
  return Boolean(readSession()?.refresh_token);
}

export function cloudSignOut() {
  const s = readSession();
  writeSession(null);
  if (s) void call("/auth/v1/logout", { method: "POST", token: s.access_token }).catch(() => {});
}

/** A valid access token, refreshing it when it is about to expire. */
export async function accessToken(): Promise<string> {
  const s = readSession();
  if (!s) throw new CloudError(401, "Please sign in again.");
  if (s.expires_at - Date.now() > 60_000) return s.access_token;
  const res = await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: s.refresh_token }) });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) writeSession(null);
    throw new CloudError(401, "Your session has expired. Please sign in again.");
  }
  const next = toSession(await res.json());
  writeSession(next);
  return next.access_token;
}

/** Emails a password-reset link to the admin; the link opens /login/ to set a new passkey. */
export async function cloudSendReset(redirectTo: string): Promise<string | null> {
  const res = await call(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: "POST", body: JSON.stringify({ email: ADMIN_EMAIL }) }).catch((e: CloudError) => e);
  if (res instanceof CloudError) return res.message;
  if (res.status === 429) return "Too many reset emails were requested. Please wait a few minutes and try again.";
  if (!res.ok) { const j = await res.json().catch(() => ({})); return j.msg || j.error_description || "The reset email couldn't be sent. Please try again."; }
  return null;
}

/** Sets a new passkey using the one-time token from the emailed reset link. */
export async function cloudSetPassword(recoveryToken: string, password: string): Promise<string | null> {
  const res = await call("/auth/v1/user", { method: "PUT", token: recoveryToken, body: JSON.stringify({ password }) }).catch((e: CloudError) => e);
  if (res instanceof CloudError) return res.message;
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return res.status === 401 || res.status === 403 ? "This reset link has expired. Request a new one." : j.msg || j.error_description || "Couldn't update the passkey.";
  }
  return null;
}

// ------------------------------------------------------------------ Data (kv table)

export interface KvRow { key: string; value: unknown }

async function rest(path: string, init: RequestInit = {}) {
  const res = await call(`/rest/v1/${path}`, { ...init, token: await accessToken() });
  if (res.status === 401) { writeSession(null); throw new CloudError(401, "Your session has expired. Please sign in again."); }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new CloudError(res.status, j.message ? `Online database error: ${j.message}` : `Online database error (${res.status})`);
  }
  return res;
}

export async function kvLoadAll(): Promise<KvRow[]> {
  const out: KvRow[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await rest("kv?select=key,value&order=key", { headers: { "Range-Unit": "items", Range: `${from}-${from + 999}` } });
    const page = (await res.json()) as KvRow[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

export async function kvUpsert(rows: KvRow[]) {
  for (let i = 0; i < rows.length; i += 500) {
    await rest("kv?on_conflict=key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: new Date().toISOString() }))),
    });
  }
}

export async function kvDelete(keys: string[]) {
  for (let i = 0; i < keys.length; i += 100) {
    const list = keys.slice(i, i + 100).map((k) => `"${k.replace(/"/g, '\\"')}"`).join(",");
    await rest(`kv?key=in.(${encodeURIComponent(list)})`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }
}
