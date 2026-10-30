"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { TivorLogo } from "@/components/brand";
import { isLoggedIn, login, resetPasskey } from "@/lib/admin-auth";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [passkey, setPasskey] = useState("");
  const [recovery, setRecovery] = useState("");
  const [newKey, setNewKey] = useState("");
  const [confirmKey, setConfirmKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => { if (isLoggedIn()) router.replace("/"); }, [router]);

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

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newKey !== confirmKey) return fail("The two passkeys do not match");
    setBusy(true);
    const err = await resetPasskey(recovery, newKey);
    setBusy(false);
    if (err) return fail(err);
    setMode("login");
    setPasskey("");
    setError(null);
    setNotice("Passkey updated. Sign in with your new passkey.");
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4">
      <div className="login-glow pointer-events-none absolute inset-0" />
      <div className="relative w-full max-w-[400px] animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <TivorLogo size={44} className="animate-logo-in mb-4" />
          <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.2em] text-muted">Tivor – Altiq</p>
          <h1 className="text-xl font-semibold">{mode === "login" ? "Admin sign in" : "Reset passkey"}</h1>
          <p className="mt-1 text-sm text-muted">{mode === "login" ? "Enter the admin passkey to continue" : "Use your recovery code to set a new passkey"}</p>
        </div>

        <div className={cn("rounded-xl border bg-card p-6 shadow-pop", shake && "animate-shake")}>
          {mode === "login" ? (
            <form onSubmit={submitLogin} className="space-y-4" key="login">
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
              <button type="submit" disabled={!passkey || busy}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-fg shadow-soft transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
              </button>
              <button type="button" onClick={() => { setMode("forgot"); setError(null); setNotice(null); }}
                className="w-full text-center text-sm text-muted transition hover:text-fg">Forgot passkey?</button>
            </form>
          ) : (
            <form onSubmit={submitReset} className="space-y-4 animate-fade-up" key="forgot">
              <Field label="Recovery code"><input value={recovery} onChange={(e) => setRecovery(e.target.value)} autoFocus className={inputCls} placeholder="XXXX-XXXX-XXXX" /></Field>
              <Field label="New passkey (6–20 digits)"><input type="password" inputMode="numeric" value={newKey} onChange={(e) => setNewKey(e.target.value)} className={inputCls} /></Field>
              <Field label="Confirm new passkey"><input type="password" inputMode="numeric" value={confirmKey} onChange={(e) => setConfirmKey(e.target.value)} className={inputCls} /></Field>
              {error && <p className="animate-slide-down st st-AB rounded-lg px-3 py-2 text-[13px]">{error}</p>}
              <button type="submit" disabled={busy || !recovery || !newKey}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-fg shadow-soft transition hover:opacity-90 disabled:opacity-50">
                <ShieldCheck className="h-4 w-4" /> Set new passkey
              </button>
              <button type="button" onClick={() => { setMode("login"); setError(null); }} className="flex w-full items-center justify-center gap-1.5 text-sm text-muted hover:text-fg">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </button>
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
