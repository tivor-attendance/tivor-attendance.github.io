"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import { TivorLogo } from "@/components/brand";
import { RESET_EMAIL_MASKED, isLoggedIn, login, requestResetCode, secondsUntilResend, setNewPasskey, verifyResetCode } from "@/lib/admin-auth";
import { cn } from "@/lib/utils";

type Step = "login" | "send" | "code" | "new";

const HEADINGS: Record<Step, [string, string]> = {
  login: ["Admin sign in", "Enter the admin passkey to continue"],
  send: ["Forgot passkey?", "We'll email a 6-digit code to the admin"],
  code: ["Check your email", `Enter the 6-digit code sent to ${RESET_EMAIL_MASKED}`],
  new: ["Set a new passkey", "Choose a passkey of 6–20 digits"],
};

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("login");
  const [passkey, setPasskey] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [newKey, setNewKey] = useState("");
  const [confirmKey, setConfirmKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { if (isLoggedIn()) router.replace("/"); }, [router]);
  useEffect(() => {
    if (step !== "code") return;
    setResendIn(secondsUntilResend());
    const t = setInterval(() => setResendIn(secondsUntilResend()), 1000);
    return () => clearInterval(t);
  }, [step]);

  const go = (s: Step) => { setStep(s); setError(null); };
  const fail = (msg: string) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 450);
  };

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ok = await login(passkey);
    setBusy(false);
    if (ok) router.replace("/");
    else fail("Incorrect passkey. Please try again.");
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const r = await requestResetCode();
    setBusy(false);
    if (!r.ok) {
      if (r.activation) { setNotice(r.error); return; }
      return fail(r.error);
    }
    setDigits(Array(6).fill(""));
    go("code");
    setTimeout(() => boxes.current[0]?.focus(), 50);
  };

  const verify = async (code: string) => {
    setBusy(true);
    const err = await verifyResetCode(code);
    setBusy(false);
    if (err) {
      setDigits(Array(6).fill(""));
      setTimeout(() => boxes.current[0]?.focus(), 50);
      return fail(err);
    }
    go("new");
  };

  const setDigit = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      // Pasted the whole code
      const next = clean.slice(0, 6).split("").concat(Array(6).fill("")).slice(0, 6);
      setDigits(next);
      boxes.current[Math.min(clean.length, 5)]?.focus();
      if (clean.length >= 6) void verify(clean.slice(0, 6));
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    setError(null);
    if (clean && i < 5) boxes.current[i + 1]?.focus();
    if (next.every(Boolean)) void verify(next.join(""));
  };

  const saveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newKey !== confirmKey) return fail("The two passkeys do not match");
    setBusy(true);
    const err = await setNewPasskey(newKey);
    setBusy(false);
    if (err) return fail(err);
    setPasskey("");
    setNewKey("");
    setConfirmKey("");
    go("login");
    setNotice("Passkey updated. Sign in with your new passkey.");
  };

  const [title, subtitle] = HEADINGS[step];

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4">
      <div className="login-glow pointer-events-none absolute inset-0" />
      <div className="relative w-full max-w-[400px] animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <TivorLogo size={44} className="animate-logo-in mb-4" />
          <p className="mb-1.5 text-xs font-medium tracking-[0.12em] text-muted">Tivor altIQ Attendance</p>
          <h1 key={title} className="animate-fade-in text-xl font-semibold">{title}</h1>
          <p key={subtitle} className="mt-1 animate-fade-in text-sm text-muted">{subtitle}</p>
        </div>

        <div className={cn("rounded-xl border bg-card p-6 shadow-pop", shake && "animate-shake")}>
          {step !== "login" && (
            <div className="mb-5 flex items-center gap-1.5">
              {(["send", "code", "new"] as Step[]).map((s, i) => (
                <span key={s} className={cn("h-1 flex-1 rounded-full transition-colors duration-500", ["send", "code", "new"].indexOf(step) >= i ? "bg-fg" : "bg-border")} />
              ))}
            </div>
          )}

          {step === "login" && (
            <form onSubmit={submitLogin} className="space-y-4 animate-fade-in" key="login">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted">Admin passkey</span>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input type="password" inputMode="numeric" autoComplete="current-password" autoFocus value={passkey}
                    onChange={(e) => { setPasskey(e.target.value); setError(null); }}
                    className="h-10 w-full rounded-lg border border-border-strong bg-card pl-10 pr-3 text-sm tracking-[0.3em] shadow-soft outline-none transition focus:border-fg/40 focus:ring-4 focus:ring-[var(--ring)]"
                    placeholder="••••••••••" />
                </div>
              </label>
              {notice && !error && <p className="animate-slide-down st st-P rounded-lg px-3 py-2 text-[13px]">{notice}</p>}
              {error && <p className="animate-slide-down st st-AB rounded-lg px-3 py-2 text-[13px]">{error}</p>}
              <PrimaryButton disabled={!passkey || busy} busy={busy}>Sign in</PrimaryButton>
              <button type="button" onClick={() => { go("send"); setNotice(null); }}
                className="w-full text-center text-sm text-muted transition hover:text-fg">Forgot passkey?</button>
            </form>
          )}

          {step === "send" && (
            <div className="space-y-4 animate-fade-in" key="send">
              <div className="flex items-center gap-3 rounded-lg border bg-subtle px-3 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-card"><Mail className="h-4 w-4 text-fg-2" /></div>
                <div className="leading-tight">
                  <p className="text-xs text-muted">Code will be sent to</p>
                  <p className="text-sm font-medium">{RESET_EMAIL_MASKED}</p>
                </div>
              </div>
              {notice && <p className="animate-slide-down st st-HD rounded-lg px-3 py-2 text-[13px]">{notice}</p>}
              {error && <p className="animate-slide-down st st-AB rounded-lg px-3 py-2 text-[13px]">{error}</p>}
              <PrimaryButton type="button" onClick={sendCode} disabled={busy} busy={busy}>Send 6-digit code</PrimaryButton>
              <BackLink onClick={() => { go("login"); setNotice(null); }} />
            </div>
          )}

          {step === "code" && (
            <div className="space-y-4 animate-fade-in" key="code">
              <div className="flex justify-between gap-2" onPaste={(e) => { e.preventDefault(); setDigit(0, e.clipboardData.getData("text")); }}>
                {digits.map((d, i) => (
                  <input key={i} ref={(el) => { boxes.current[i] = el; }} value={d} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                    aria-label={`Digit ${i + 1}`} disabled={busy}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Backspace" && !digits[i] && i > 0) boxes.current[i - 1]?.focus(); }}
                    style={{ animationDelay: `${i * 40}ms` }}
                    className={cn("h-12 w-full animate-fade-up rounded-lg border border-border-strong bg-card text-center text-lg font-semibold tabular-nums shadow-soft outline-none transition focus:border-fg/50 focus:ring-4 focus:ring-[var(--ring)]",
                      d && "border-fg/40")} />
                ))}
              </div>
              {error && <p className="animate-slide-down st st-AB rounded-lg px-3 py-2 text-[13px]">{error}</p>}
              <PrimaryButton type="button" onClick={() => verify(digits.join(""))} disabled={busy || digits.some((d) => !d)} busy={busy}>Verify code</PrimaryButton>
              <div className="flex items-center justify-between text-sm">
                <BackLink onClick={() => go("send")} label="Back" />
                <button type="button" disabled={resendIn > 0 || busy} onClick={sendCode}
                  className="text-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-60">
                  {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                </button>
              </div>
            </div>
          )}

          {step === "new" && (
            <form onSubmit={saveNew} className="space-y-4 animate-fade-in" key="new">
              <p className="st st-P flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]"><ShieldCheck className="h-4 w-4" />Code verified</p>
              <Field label="New passkey (6–20 digits)"><input type="password" inputMode="numeric" autoFocus value={newKey} onChange={(e) => setNewKey(e.target.value)} className={inputCls} /></Field>
              <Field label="Confirm new passkey"><input type="password" inputMode="numeric" value={confirmKey} onChange={(e) => setConfirmKey(e.target.value)} className={inputCls} /></Field>
              {error && <p className="animate-slide-down st st-AB rounded-lg px-3 py-2 text-[13px]">{error}</p>}
              <PrimaryButton disabled={busy || !newKey || !confirmKey} busy={busy}>Save new passkey</PrimaryButton>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

const inputCls = "h-10 w-full rounded-lg border border-border-strong bg-card px-3 text-sm shadow-soft outline-none transition focus:border-fg/40 focus:ring-4 focus:ring-[var(--ring)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-muted">{label}</span>{children}</label>;
}

function PrimaryButton({ children, busy, type = "submit", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button type={type} {...p}
      className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-fg shadow-soft transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50">
      {busy && <Loader2 className="h-4 w-4 animate-spin" />} {children}
    </button>
  );
}

function BackLink({ onClick, label = "Back to sign in" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center justify-center gap-1.5 text-sm text-muted transition hover:text-fg data-[full]:w-full">
      <ArrowLeft className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
