"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/admin-auth";

/** Renders the app only after the admin has signed in with the passkey. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (isLoggedIn()) setOk(true);
    else router.replace("/login");
    const t = setInterval(() => { if (!isLoggedIn()) router.replace("/login"); }, 60_000);
    return () => clearInterval(t);
  }, [router]);
  if (!ok) return null;
  return <>{children}</>;
}
