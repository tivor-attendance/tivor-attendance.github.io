"use client";

// Admin passkey gate. NOTE: this runs entirely in the browser (the site can be hosted
// statically), so it keeps casual visitors out but is not server-grade security.
const PASSKEY_KEY = "attendance-passkey-hash";
const SESSION_KEY = "attendance-session";
const SESSION_HOURS = 12;
export const DEFAULT_PASSKEY = "1234567890";
export const RECOVERY_CODE = "ATTEND-RESET-2026";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function storedHash(): string | null {
  try { return localStorage.getItem(PASSKEY_KEY); } catch { return null; }
}

export async function checkPasskey(passkey: string): Promise<boolean> {
  const hash = await sha256(passkey.trim());
  return hash === (storedHash() ?? (await sha256(DEFAULT_PASSKEY)));
}

export async function login(passkey: string): Promise<boolean> {
  if (!(await checkPasskey(passkey))) return false;
  try { localStorage.setItem(SESSION_KEY, String(Date.now() + SESSION_HOURS * 3600_000)); } catch { /* storage blocked */ }
  return true;
}

export function isLoggedIn(): boolean {
  try { return Number(localStorage.getItem(SESSION_KEY) ?? 0) > Date.now(); } catch { return false; }
}

export function logout() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/** Forgot passkey: the recovery code lets the admin set a new passkey. */
export async function resetPasskey(recoveryCode: string, newPasskey: string): Promise<string | null> {
  if (recoveryCode.trim().toUpperCase() !== RECOVERY_CODE) return "That recovery code is not correct";
  if (!/^\d{6,20}$/.test(newPasskey.trim())) return "Passkey must be 6–20 digits";
  try { localStorage.setItem(PASSKEY_KEY, await sha256(newPasskey.trim())); } catch { return "Could not save — browser storage is blocked"; }
  return null;
}
