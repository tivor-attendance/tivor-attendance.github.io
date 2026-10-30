"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CLOUD_ENABLED, isLoggedIn, logout } from "@/lib/admin-auth";
import { TivorLogo } from "./brand";

export const DATA_CHANGED_EVENT = "tivor-data-changed";

/** Renders the app only after sign-in; in online mode also loads and keeps the shared data fresh. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/login"); return; }
    let cancelled = false;
    const toLogin = () => { logout(); router.replace("/login"); };

    const pull = async (initial: boolean) => {
      if (!CLOUD_ENABLED) return;
      const { syncFromCloud } = await import("@/lib/local-api");
      try {
        const changed = await syncFromCloud();
        if (changed && !initial) window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) return toLogin();
        if (initial) toast.error(`${(e as Error).message} Showing the last data saved on this device.`);
      }
    };

    (async () => {
      await pull(true);
      if (!cancelled) setReady(true);
    })();

    if (!CLOUD_ENABLED) {
      const t = setInterval(() => { if (!isLoggedIn()) router.replace("/login"); }, 60_000);
      return () => { cancelled = true; clearInterval(t); };
    }
    // Pick up changes made on other devices.
    const t = setInterval(() => { if (document.visibilityState === "visible") void pull(false); }, 20_000);
    const onFocus = () => void pull(false);
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <TivorLogo size={36} className="animate-logo-in" />
        <div className="h-1 w-40 overflow-hidden rounded-full bg-subtle"><div className="shimmer h-full w-full" /></div>
        <p className="animate-fade-in text-[13px] text-muted">{CLOUD_ENABLED ? "Loading your data…" : "Loading…"}</p>
      </div>
    );
  }
  return <>{children}</>;
}
