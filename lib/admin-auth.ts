"use client";

// Admin sign-in.
//  • Online mode (Supabase configured): the passkey is the password of the admin account
//    pranay@altiq.one — checked by Supabase, and "Forgot passkey?" emails a reset link.
//  • Offline fallback: passkey hash in this browser + emailed 6-digit code.
import { CLOUD_ENABLED, cloudHasSession, cloudSendReset, cloudSetPassword, cloudSignIn, cloudSignOut } from "./cloud";
export { CLOUD_ENABLED };
const PASSKEY_KEY = "attendance-passkey-hash";
const SESSION_KEY = "attendance-session";
const OTP_KEY = "attendance-reset-otp";
const SESSION_HOURS = 12;
export const DEFAULT_PASSKEY = "1234567890";

/** Where "Forgot passkey?" sends the one-time code. */
export const RESET_EMAIL = "pranay@altiq.one";
export const RESET_EMAIL_MASKED = RESET_EMAIL.replace(/^(.{2})[^@]*/, "$1••••");
const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const remove = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export async function checkPasskey(passkey: string): Promise<boolean> {
  const hash = await sha256(passkey.trim());
  return hash === (read(PASSKEY_KEY) ?? (await sha256(DEFAULT_PASSKEY)));
}

/** Returns null on success, otherwise an error message. */
export async function login(passkey: string): Promise<string | null> {
  if (CLOUD_ENABLED) return cloudSignIn(passkey.trim());
  if (!(await checkPasskey(passkey))) return "Incorrect passkey. Please try again.";
  write(SESSION_KEY, String(Date.now() + SESSION_HOURS * 3600_000));
  return null;
}

export function isLoggedIn(): boolean {
  if (CLOUD_ENABLED) return cloudHasSession();
  return Number(read(SESSION_KEY) ?? 0) > Date.now();
}

export function logout() {
  if (CLOUD_ENABLED) cloudSignOut();
  remove(SESSION_KEY);
}

/** Online mode: email a reset link to the admin. */
export function sendResetLink(): Promise<string | null> {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return cloudSendReset(`${window.location.origin}${base}/login/`);
}

/** Online mode: set the new passkey with the token from the reset link. */
export function setPasskeyFromLink(token: string, newPasskey: string): Promise<string | null> {
  if (!/^\d{6,20}$/.test(newPasskey.trim())) return Promise.resolve("Passkey must be 6–20 digits");
  return cloudSetPassword(token, newPasskey.trim());
}

// ------------------------------------------------------------------ Forgot passkey (email OTP)

interface OtpState { hash: string; salt: string; expires: number; sentAt: number; attempts: number; verified?: boolean }

const otpState = (): OtpState | null => {
  try { return JSON.parse(read(OTP_KEY) ?? "null"); } catch { return null; }
};

export function secondsUntilResend(): number {
  const s = otpState();
  return s ? Math.max(0, Math.ceil((s.sentAt + OTP_RESEND_SECONDS * 1000 - Date.now()) / 1000)) : 0;
}

/**
 * Web3Forms access key (public by design — it only allows sending to the email it was
 * created for). Get one free at https://web3forms.com with pranay@altiq.one.
 * Leave empty to fall back to FormSubmit.
 */
export const WEB3FORMS_ACCESS_KEY = "";

type SendResult = { ok: true } | { ok: false; error: string; activation?: boolean };
const UNREACHABLE = "The email service isn't responding right now (this isn't your connection). Please try again in a few minutes.";

async function sendViaWeb3Forms(code: string, when: string): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: WEB3FORMS_ACCESS_KEY,
        subject: `Tivor altIQ Attendance — passkey reset code ${code}`,
        from_name: "Tivor altIQ Attendance",
        "Reset code": code,
        "Valid for": "10 minutes",
        Requested: `${when} IST`,
        Note: "Someone clicked “Forgot passkey?” on the attendance site. If this wasn't you, ignore this email — the passkey stays unchanged.",
      }),
    });
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
  return body.success ? { ok: true } : { ok: false, error: body.message || "The code couldn't be sent. Please try again." };
}

async function sendViaFormSubmit(code: string, when: string): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch(`https://formsubmit.co/ajax/${RESET_EMAIL}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: `Tivor altIQ Attendance — passkey reset code ${code}`,
        _template: "box",
        _captcha: "false",
        "Reset code": code,
        "Valid for": "10 minutes",
        Requested: `${when} IST`,
        Note: "Someone clicked “Forgot passkey?” on the attendance site. If this wasn't you, ignore this email — the passkey stays unchanged.",
      }),
    });
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
  if (res.status >= 500) return { ok: false, error: UNREACHABLE };
  const body = (await res.json().catch(() => ({}))) as { success?: string | boolean; message?: string };
  if (body.success === true || body.success === "true") return { ok: true };
  const activation = /activat/i.test(body.message ?? "");
  return {
    ok: false,
    activation,
    error: activation
      ? `First-time setup: an “Activate Form” email was sent to ${RESET_EMAIL_MASKED}. Open it, click Activate, then request the code again.`
      : body.message || "The code couldn't be sent. Please try again.",
  };
}

/**
 * Creates a 6-digit code, stores only its salted hash, and emails the code to the admin.
 * Uses Web3Forms when an access key is configured, otherwise FormSubmit.
 */
export async function requestResetCode(): Promise<SendResult> {
  const wait = secondsUntilResend();
  if (wait > 0) return { ok: false, error: `Please wait ${wait}s before requesting another code.` };

  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = String(n).padStart(6, "0");
  const salt = crypto.getRandomValues(new Uint32Array(4)).join("-");
  const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

  const sent = WEB3FORMS_ACCESS_KEY ? await sendViaWeb3Forms(code, when) : await sendViaFormSubmit(code, when);
  if (!sent.ok) return sent;
  write(OTP_KEY, JSON.stringify({ hash: await sha256(`${salt}:${code}`), salt, expires: Date.now() + OTP_TTL_MS, sentAt: Date.now(), attempts: 0 } satisfies OtpState));
  return { ok: true };
}

/** Checks the emailed code. Returns null when correct, otherwise an error message. */
export async function verifyResetCode(code: string): Promise<string | null> {
  const s = otpState();
  if (!s) return "Request a code first.";
  if (Date.now() > s.expires) { remove(OTP_KEY); return "This code has expired. Request a new one."; }
  if (s.attempts >= OTP_MAX_ATTEMPTS) { remove(OTP_KEY); return "Too many wrong attempts. Request a new code."; }
  if ((await sha256(`${s.salt}:${code.trim()}`)) !== s.hash) {
    s.attempts += 1;
    write(OTP_KEY, JSON.stringify(s));
    const left = OTP_MAX_ATTEMPTS - s.attempts;
    return left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Request a new code.";
  }
  s.verified = true;
  write(OTP_KEY, JSON.stringify(s));
  return null;
}

/** Sets a new passkey — only after the emailed code was verified. */
export async function setNewPasskey(newPasskey: string): Promise<string | null> {
  const s = otpState();
  if (!s?.verified || Date.now() > s.expires) return "Your code has expired. Start again.";
  if (!/^\d{6,20}$/.test(newPasskey.trim())) return "Passkey must be 6–20 digits";
  if (!write(PASSKEY_KEY, await sha256(newPasskey.trim()))) return "Could not save — browser storage is blocked";
  remove(OTP_KEY);
  remove(SESSION_KEY);
  return null;
}
