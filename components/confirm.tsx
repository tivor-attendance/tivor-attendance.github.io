"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button, Dialog } from "./ui";

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

const Ctx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(v: boolean) => void>(undefined);
  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);
  const close = (v: boolean) => {
    resolver.current?.(v);
    setOpts(null);
  };
  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Dialog open={!!opts} onClose={() => close(false)} title={opts?.title ?? ""}
        footer={<>
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button variant={opts?.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>{opts?.confirmLabel ?? "Confirm"}</Button>
        </>}>
        <div className="text-sm text-muted">{opts?.body}</div>
      </Dialog>
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
