"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { DatabaseBackup, LogOut, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOCAL_MODE, saveBlob } from "@/lib/client";
import { logout } from "@/lib/admin-auth";
import { todayIST } from "@/lib/dates";
import { useConfirm } from "./confirm";
import { TivorLogo } from "./brand";

const LINKS = [
  { href: "/", label: "Attendance" },
  { href: "/report", label: "Report" },
  { href: "/holidays", label: "Holidays" },
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const backup = async () => {
    const { exportDb } = await import("@/lib/local-api");
    saveBlob(new Blob([exportDb()], { type: "application/json" }), `tivor-attendance-backup-${todayIST()}.json`);
    toast.success("Backup downloaded");
  };
  const restore = async (file: File | undefined) => {
    if (!file) return;
    if (!(await confirm({ title: "Restore from backup?", body: "This replaces all attendance, employees and holidays in this browser with the backup file.", danger: true, confirmLabel: "Restore" }))) return;
    try {
      const { importDb } = await import("@/lib/local-api");
      importDb(await file.text());
      toast.success("Backup restored");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const iconBtn = "rounded-lg p-2 text-muted transition duration-200 hover:bg-subtle hover:text-fg active:scale-90";

  return (
    <header className="sticky top-0 z-40 animate-fade-in border-b bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:gap-8 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <TivorLogo size={30} className="animate-logo-in transition-transform duration-500 group-hover:rotate-[120deg]" />
          <span className="hidden leading-tight sm:block">
            <span className="block text-[15px] font-semibold tracking-tight">Tivor</span>
            <span className="block text-[11px] uppercase tracking-[0.18em] text-muted">Attendance</span>
          </span>
        </Link>
        <nav className="flex h-full items-stretch gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href}
                className={cn("relative flex items-center px-2.5 text-sm font-medium transition-colors sm:px-3", active ? "text-fg" : "text-muted hover:text-fg")}>
                {l.label}
                <span className={cn("absolute inset-x-2 -bottom-px h-[2px] origin-center rounded-full bg-fg transition-transform duration-300", active ? "scale-x-100" : "scale-x-0")} />
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          {LOCAL_MODE && (
            <>
              <button onClick={backup} className={iconBtn} title="Download backup" aria-label="Download backup"><DatabaseBackup className="h-4 w-4" /></button>
              <button onClick={() => fileRef.current?.click()} className={iconBtn} title="Restore backup" aria-label="Restore backup"><Upload className="h-4 w-4" /></button>
              <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ""; }} />
            </>
          )}
          <button onClick={() => { logout(); router.replace("/login"); }} className={cn(iconBtn, "flex items-center gap-1.5 text-sm")} title="Sign out">
            <LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
