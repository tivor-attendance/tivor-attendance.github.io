"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";
import { ConfirmProvider } from "./confirm";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <ConfirmProvider>
        {children}
        <Toaster position="bottom-right" closeButton toastOptions={{ style: { borderRadius: 14, fontFamily: "var(--font-geist)" } }} />
      </ConfirmProvider>
    </SessionProvider>
  );
}
